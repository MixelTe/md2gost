import * as assert from "node:assert/strict";
import Module from "node:module";
import path from "node:path";
import type * as VSCode from "vscode";
import type * as Viewer from "../docxViewer";
import { parseDocx, type ParsedDocx } from "../antirender";

class Emitter<T>
{
	private listeners = new Set<(value: T) => void>();
	event = (listener: (value: T) => void) => { this.listeners.add(listener); return { dispose: () => this.listeners.delete(listener) }; };
	fire(value: T) { for (const listener of this.listeners) listener(value); }
	dispose() { this.listeners.clear(); }
}
function uri(file = "report.docx")
{
	const fsPath = path.resolve(file);
	return { scheme: "file", fsPath, toString: () => "file:" + fsPath } as VSCode.Uri;
}
const source = uri();
const empty: ParsedDocx = { nodes: [], images: [], warnings: [] };
const content = (text: string): ParsedDocx => ({ ...empty, nodes: [{ id: 1, type: "text", text: [{ text }] }] });
const neverCancelled = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) } as VSCode.CancellationToken;
const watchers: Watcher[] = [];
class Watcher
{
	change = new Emitter<VSCode.Uri>();
	create = new Emitter<VSCode.Uri>();
	delete = new Emitter<VSCode.Uri>();
	onDidChange = this.change.event;
	onDidCreate = this.create.event;
	onDidDelete = this.delete.event;
	disposed = false;
	dispose() { this.disposed = true; this.change.dispose(); this.create.dispose(); this.delete.dispose(); }
}
function panel()
{
	const closed = new Emitter<void>();
	return {
		active: true,
		webview: { html: "", options: {} as VSCode.WebviewOptions },
		onDidDispose: closed.event,
		dispose: () => closed.fire(),
	} as unknown as VSCode.WebviewPanel;
}
let provider: VSCode.CustomReadonlyEditorProvider;
let registration: unknown;
const commands = new Map<string, (uri?: VSCode.Uri) => Promise<void>>();
let parse: typeof parseDocx;
const errors: string[] = [];
const vscode = {
	EventEmitter: Emitter,
	CancellationError: class extends Error {},
	Uri: { joinPath: (base: VSCode.Uri, value: string) => uri(path.join(base.fsPath, value)) },
	RelativePattern: class { constructor(readonly baseUri: VSCode.Uri, readonly pattern: string) {} },
	workspace: { createFileSystemWatcher: () => { const watcher = new Watcher(); watchers.push(watcher); return watcher; } },
	window: { registerCustomEditorProvider(name: string, value: typeof provider, options: unknown)
	{
		registration = { name, options }; provider = value; return { dispose() {} };
	} },
	commands: { registerCommand(name: string, callback: (uri?: VSCode.Uri) => Promise<void>) { commands.set(name, callback); return { dispose: () => commands.delete(name) }; } },
};
const loader = Module as any;
const originalLoad = loader._load;
let viewer: typeof Viewer;
try
{
	loader._load = function (name: string, ...args: any[])
	{
		if (name == "vscode") return vscode;
		if (name == "./antirender") return { parseDocx: (...args: Parameters<typeof parseDocx>) => parse(...args) };
		return originalLoad.call(this, name, ...args);
	};
	viewer = require("../docxViewer");
}
finally { loader._load = originalLoad; }

suite("DOCX viewer", () =>
{
	let subscriptions: VSCode.Disposable[];
	setup(() =>
	{
		subscriptions = []; watchers.length = errors.length = 0;
		parse = async () => content("Initial");
		viewer.registerDocxViewer({ subscriptions } as VSCode.ExtensionContext, { error: (message: string) => { errors.push(message); } } as VSCode.LogOutputChannel);
	});
	teardown(() => { for (const disposable of subscriptions.reverse()) disposable.dispose(); });
	async function open(token = neverCancelled)
	{
		return await provider.openCustomDocument(source, {} as VSCode.CustomDocumentOpenContext, token);
	}
	function resolve(doc: VSCode.CustomDocument)
	{
		const view = panel();
		provider.resolveCustomEditor(doc, view, neverCancelled);
		return view;
	}
	async function changed(watcher: Emitter<VSCode.Uri>)
	{
		watcher.fire(source);
		await new Promise(resolve => setTimeout(resolve, 220));
	}
	test("registers a readonly editor with split views and native search", () =>
	{
		assert.deepEqual(registration, { name: "md2gost.docxPreview", options: { supportsMultipleEditorsPerDocument: true, webviewOptions: { enableFindWidget: true } } });
		assert.ok(commands.has("md2gost.refresh_docx"));
		assert.equal("saveCustomDocument" in provider, false);
	});
	test("renders structure and escapes document content without scripts or external resources", () =>
	{
		const html = viewer.docxHtml({
			images: [{ id: "img", name: "picture.png", part: "word/media/picture.png", data: new Uint8Array([1, 2, 3]) }],
			warnings: [{ code: "test", block: 4, message: '<script>alert("warning")</script>' }],
			nodes: [
				{ id: 1, type: "title", level: 2, text: [{ text: "<Heading>" }] },
				{ id: 2, type: "text", text: [{ text: "bold & italic", bold: true, italic: true }, { text: "x < y", mono: true }, { text: "", image: "img", width: 100 }] },
				{ id: 3, type: "listItem", text: [{ text: "Item" }], level: 1, ordered: true, number: 4, label: "IV)", format: "upperRoman", simple: false, mark: ")" },
				{ id: 4, type: "code", text: "  <script>\n\t& code", inferred: true, fonts: [], title: [{ text: "Listing" }] },
				{ id: 5, type: "table", rows: [[[{ id: 6, type: "text", text: [{ text: "Cell" }] }]]], complex: false, title: [{ text: "Table" }] },
				{ id: 7, type: "image", image: "img", title: [{ text: "Picture" }] },
				{ id: 8, type: "pageBreak" }, { id: 9, type: "toc" },
				{ id: 10, type: "unsupported", kind: "OMML", text: "x < y" },
			],
		});
		assert.ok(html.includes('<h2 id="block-1">&lt;Heading&gt;</h2>'));
		assert.ok(html.includes("<strong><em>bold &amp; italic</em></strong><code>x &lt; y</code>"));
		assert.ok(html.includes("IV)</span>"));
		assert.ok(html.includes("<pre><code>  &lt;script&gt;\n\t&amp; code</code></pre>"));
		assert.ok(html.includes("<figcaption>Table</figcaption>"));
		assert.ok(html.includes('<td><p id="block-6">Cell</p></td>'));
		assert.ok(html.includes('src="data:image/png;base64,AQID"'));
		assert.ok(html.includes('width="100"'));
		assert.ok(html.includes("<figcaption>Picture</figcaption>"));
		assert.ok(html.includes("Разрыв страницы"));
		assert.ok(html.includes("Оглавление (поле Word)"));
		assert.ok(html.includes("[OMML] x &lt; y"));
		assert.ok(html.includes('href="#block-4"'));
		assert.ok(html.includes("&lt;script&gt;alert(&quot;warning&quot;)&lt;/script&gt;"));
		assert.ok(html.includes("default-src 'none'; img-src data:"));
		assert.doesNotMatch(html, /<script|src="https?:/);
	});
	test("keeps unsupported images and inline objects visible as placeholders", () =>
	{
		const html = viewer.docxHtml({ ...empty,
			images: [{ id: "emf", name: "drawing.emf", part: "media/drawing.emf", data: new Uint8Array([0]) }],
			nodes: [
				{ id: 1, type: "image", image: "missing" }, { id: 2, type: "image", image: "emf" },
				{ id: 3, type: "text", text: [{ text: "<x>", unsupported: 'math"' }] },
			],
		});
		assert.ok(html.includes("Изображение недоступно: missing"));
		assert.ok(html.includes("Изображение недоступно: drawing.emf"));
		assert.ok(html.includes('title="math&quot;"'));
		assert.ok(html.includes("&lt;x&gt;"));
		assert.doesNotMatch(html, /<img/);
	});
	test("views the existing sample with the actual parser", async () =>
	{
		const doc = await parseDocx(path.resolve("resources/gost_example.docx"));
		const html = viewer.docxHtml(doc);
		assert.ok(doc.images.length > 0);
		assert.ok(html.includes("data:image/"));
		assert.ok(html.includes("ВВЕДЕНИЕ"));
		assert.ok(html.includes("<table>"));
	});
	test("shares a parsed document across split views and coalesces external save events", async () =>
	{
		let reads = 0;
		parse = async () => content("Version " + ++reads);
		const doc = await open(); const first = resolve(doc); const second = resolve(doc);
		assert.equal(reads, 1);
		assert.equal(first.webview.html, second.webview.html);
		assert.deepEqual(first.webview.options, { enableScripts: false, localResourceRoots: [], enableCommandUris: false });
		watchers[0].change.fire(uri("other.docx"));
		watchers[0].change.fire(source);
		await changed(watchers[0].create);
		assert.equal(reads, 2);
		assert.ok(first.webview.html.includes("Version 2"));
		assert.equal(first.webview.html, second.webview.html);
		first.dispose();
		await commands.get("md2gost.refresh_docx")!();
		assert.ok(second.webview.html.includes("Version 3"));
		assert.ok(first.webview.html.includes("Version 2"));
	});
	test("refreshes the requested document and ignores stale reads", async () =>
	{
		const doc = await open(); const view = resolve(doc);
		let complete!: (doc: ParsedDocx) => void; let signal: AbortSignal | undefined;
		parse = (_, value) => { signal = value; return new Promise(resolve => complete = resolve); };
		const stale = commands.get("md2gost.refresh_docx")!(source);
		parse = async () => content("Newest");
		await commands.get("md2gost.refresh_docx")!(uri("other.docx"));
		assert.equal(signal?.aborted, false);
		await commands.get("md2gost.refresh_docx")!(source);
		assert.equal(signal?.aborted, true);
		complete(content("Outdated")); await stale;
		assert.ok(view.webview.html.includes("Newest"));
		assert.ok(!view.webview.html.includes("Outdated"));
	});
	test("reports a deleted or invalid file and recovers after replacement", async () =>
	{
		const doc = await open(); const view = resolve(doc);
		parse = async () => { throw new Error("<Invalid ZIP>"); };
		await changed(watchers[0].delete);
		assert.ok(view.webview.html.includes("Не удалось прочитать DOCX: &lt;Invalid ZIP&gt;"));
		assert.equal(errors.length, 1);
		parse = async () => content("Recovered");
		await changed(watchers[0].create);
		assert.ok(view.webview.html.includes("Recovered"));
		assert.ok(!view.webview.html.includes("Не удалось"));
	});
	test("cancels an opening document and releases its watcher", async () =>
	{
		const cancelled = new Emitter<void>();
		const token = { ...neverCancelled, isCancellationRequested: false, onCancellationRequested: cancelled.event };
		parse = (_, signal) => new Promise((_, reject) => signal!.addEventListener("abort", () => reject(new Error("Aborted"))));
		const opening = open(token);
		token.isCancellationRequested = true; cancelled.fire();
		await assert.rejects(opening, vscode.CancellationError);
		assert.equal(watchers[0].disposed, true);
		assert.deepEqual(errors, []);
	});
	test("disposal cancels reads and scheduled updates", async () =>
	{
		const doc = await open(); const view = resolve(doc); const html = view.webview.html;
		let complete!: (doc: ParsedDocx) => void; let signal: AbortSignal | undefined; let reads = 0;
		parse = (_, value) => { reads++; signal = value; return new Promise(resolve => complete = resolve); };
		const reading = commands.get("md2gost.refresh_docx")!(source);
		watchers[0].change.fire(source);
		doc.dispose();
		assert.equal(signal?.aborted, true);
		assert.equal(watchers[0].disposed, true);
		complete(content("Closed")); await reading;
		await new Promise(resolve => setTimeout(resolve, 220));
		assert.equal(reads, 1);
		assert.equal(view.webview.html, html);
	});
});
