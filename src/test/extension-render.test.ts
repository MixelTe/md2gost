import * as assert from "node:assert/strict";
import Module from "node:module";
import * as path from "node:path";
import type * as Extension from "../extension";
import type { render } from "../main";
import type * as Utilities from "../utils";
import type { MDReverseConfig, MDReverseResult } from "../antirender";

type Render = typeof render;
const disposable = { dispose() {} };
const document = { fileName: path.resolve("input.g.md"), uri: { fsPath: path.resolve("input.g.md") }, async save() { return true; } };
const output = path.resolve("recovered.docx");
const commands = new Map<string, (uri: typeof document.uri) => unknown>();
const notifications: { message: string, actions: string[] }[] = [];
const errors: string[] = [];
const opened: string[] = [];
const openedSources: string[] = [];
const reverseCalls: MDReverseConfig[] = [];
let saveReverse = true;
let reverseError: Error | undefined;
const reverseOutput = path.resolve("reversed.g.md");
const reports: { increment?: number, message?: string }[] = [];
const settings: Record<string, unknown> = {};
let pending: Promise<void> | undefined;
let cancelled = false;
let cancel: (() => void) | undefined;
let response: Awaited<ReturnType<Render>> = { fout: output };
let run: Render = async () => response;
const progress = { report: (value: typeof reports[number]) => reports.push(value) };
const token = {
	get isCancellationRequested() { return cancelled; },
	onCancellationRequested(listener: () => void) { cancel = listener; return disposable; },
};
const vscode = {
	Uri: { file: (file: string) => ({ fsPath: file }) },
	ProgressLocation: { Notification: 1 },
	EventEmitter: class { event = () => disposable; fire() {} },
	commands: { registerCommand(name: string, callback: (uri: typeof document.uri) => unknown) { commands.set(name, callback); return disposable; } },
	languages: new Proxy({}, { get: () => () => disposable }),
	workspace: {
		openTextDocument: async (fileName: string) => ({ fileName }),
		textDocuments: [document],
		getConfiguration: () => ({ get: (key: string, fallback?: unknown) => settings[key] ?? (key == "formatter.suppressDefaultPrompt" ? true : fallback) }),
		onDidChangeConfiguration: () => disposable,
		registerTextDocumentContentProvider: () => disposable,
	},
	window: {
		showOpenDialog: async () => [{ fsPath: path.resolve("source.docx") }],
		showSaveDialog: async () => saveReverse ? { fsPath: reverseOutput } : undefined,
		showTextDocument: async (source: { fileName: string }) => { openedSources.push(source.fileName); },
		showWarningMessage() {},
		activeTextEditor: { document },
		createOutputChannel: () => ({ info() {}, warn() {}, error() {} }),
		withProgress(_: unknown, callback: (reporter: typeof progress, cancellation: typeof token) => Promise<void>)
		{
			pending = callback(progress, token);
			return pending;
		},
		showErrorMessage(message: string) { errors.push(message); return Promise.resolve(undefined); },
		showInformationMessage(message: string, ...actions: string[])
		{
			notifications.push({ message, actions });
			return Promise.resolve("Open");
		},
	},
};

// Run the actual registered render command; replace only VS Code and adapter
// boundaries so notifications and Open can be checked without a GUI or Office.
const utilities = require("../utils") as typeof Utilities;
const adapters: Record<string, unknown> = {
	"./antirender": { reverseDocx: async (config: MDReverseConfig): Promise<MDReverseResult> =>
	{
		reverseCalls.push(config);
		config.abortSignal?.throwIfAborted();
		if (reverseError) throw reverseError;
		return { filePath: reverseOutput, images: [], warnings: [{ code: "OMML", message: "Review formula", block: 1 }] };
	} },
	vscode,
	"./main": { render: (options: Parameters<Render>[0]) => run(options) },
	"./utils": { ...utilities, openFile: (file: string) => opened.push(file) },
	"./formatter": {},
	"./intellisense": {
		addDiagnostic() {}, FileDropProvider: class {}, TableCodeLensProvider: class {},
		RenderDiagnosticCollection: class { clear() {} addWarning() {} addError() {} },
	},
	"./tableEditor": { onEditTableCommand: () => () => {} },
	"./markdownPlugin": {},
	"./markdownImageReplacePaste": { registerMarkdownImageReplacePaste() {} },
	"./docxViewer": { registerDocxViewer() {} },
};
const loader = Module as any;
const originalLoad = loader._load;
let extension: typeof Extension;
try
{
	loader._load = function (name: string, ...args: any[]) { return adapters[name] || originalLoad.call(this, name, ...args); };
	extension = require("../extension");
}
finally { loader._load = originalLoad; }

function reset()
{
	openedSources.length = reverseCalls.length = 0;
	saveReverse = true;
	reverseError = undefined;
	for (const key of Object.keys(settings)) delete settings[key];
	notifications.length = errors.length = opened.length = reports.length = 0;
	pending = undefined;
	cancelled = false;
	cancel = undefined;
	response = { fout: output };
	run = async () => response;
}
async function execute()
{
	const command = commands.get("md2gost.render_docx");
	assert.ok(command);
	command(document.uri);
	assert.ok(pending);
	await pending;
	await Promise.resolve();
}

suite("render command notifications", () =>
{
	suiteSetup(() =>
	{
		extension.activate({
			subscriptions: [], extension: { packageJSON: { version: "test" } },
			globalState: { get() {}, update() {} },
			asAbsolutePath: (name: string) => path.resolve(name),
		} as unknown as Parameters<typeof extension.activate>[0]);
	});
	setup(reset);
	test("reverse opens the editable source even when conversion has warnings", async () =>
	{
		await commands.get("md2gost.reverse_docx")!({ fsPath: path.resolve("source.docx") });
		assert.deepEqual(openedSources, [reverseOutput]);
		assert.equal(reverseCalls[0]?.input, path.resolve("source.docx"));
		assert.equal(reverseCalls[0]?.overwrite, true);
		assert.deepEqual(errors, []);
	});
	test("reverse does not run after cancelling the destination dialog", async () =>
	{
		saveReverse = false;
		await commands.get("md2gost.reverse_docx")!(document.uri);
		assert.deepEqual(reverseCalls, []);
	});
	test("reverse reports errors and handles cancellation without opening a source", async () =>
	{
		reverseError = new Error("Invalid DOCX");
		await commands.get("md2gost.reverse_docx")!(document.uri);
		assert.match(errors[0]!, /Invalid DOCX/);
		assert.deepEqual(openedSources, []);
		reset();
		cancelled = true;
		await commands.get("md2gost.reverse_docx")!(document.uri);
		assert.deepEqual(errors, []);
		assert.deepEqual(openedSources, []);
	});
	test("passes configured office paths on each render and leaves empty paths unset", async () =>
	{
		settings["render.sofficePath"] = "  /custom/soffice  ";
		settings["render.unoPythonPath"] = "  /custom/python  ";
		const calls: Parameters<Render>[0][] = [];
		run = async options => { calls.push(options); return response; };
		await execute();
		assert.equal(calls[0]!.sofficePath, "/custom/soffice");
		assert.equal(calls[0]!.unoPythonPath, "/custom/python");
		settings["render.sofficePath"] = "";
		settings["render.unoPythonPath"] = "   ";
		await execute();
		assert.equal(calls[1]!.sofficePath, undefined);
		assert.equal(calls[1]!.unoPythonPath, undefined);
	});
	test("offers Open for the recovered DOCX after each postprocessing error", async () =>
	{
		for (const err of ["noOffice", "office", "inPS", "noPS", "vba", "pdf"] as const)
		{
			reset();
			response = { fout: output, err, errS: new Error("Postprocessing failed") };
			await execute();
			assert.equal(errors.length, 1, err);
			assert.deepEqual(notifications, [{ message: `DOCX сохранён с ограничениями: ${output}`, actions: ["Open"] }]);
			assert.deepEqual(opened, [output]);
			assert.ok(!reports.some(report => report.message == "Done!"));
		}
	});
	test("retains the success notification and Open action", async () =>
	{
		await execute();
		assert.deepEqual(errors, []);
		assert.deepEqual(notifications, [{ message: `File rendered to ${output}`, actions: ["Open"] }]);
		assert.deepEqual(opened, [output]);
		assert.ok(reports.some(report => report.message == "Done!"));
	});
	test("does not offer a file after cancellation", async () =>
	{
		run = async options =>
		{
			cancelled = true;
			cancel!();
			assert.ok(options.signal?.aborted);
			throw options.signal.reason;
		};
		await execute();
		assert.deepEqual(errors, []);
		assert.deepEqual(notifications, []);
		assert.deepEqual(opened, []);
	});
});
