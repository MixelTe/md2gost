import * as assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import * as fs from "node:fs/promises";
import Module from "node:module";
import * as path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import type * as Office from "../office";
import { withTempDir } from "./helpers/fixtures";

const probes: string[] = [];
const launches: { command: string, args: string[] }[] = [];
const subprocesses = {
	execFile: Object.assign(() => { throw new Error("Unexpected subprocess"); }, {
		[promisify.custom]: async (command: string) => { probes.push(command); return { stdout: "", stderr: "" }; },
	}),
	spawn(command: string, args: string[])
	{
		launches.push({ command, args });
		const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
		queueMicrotask(() =>
		{
			child.stdout.end();
			child.stderr.end();
			child.emit("exit", 0);
			child.emit("close", 0);
		});
		return child;
	},
};

// Keep executable discovery real; replace subprocesses so these tests need no
// Office installation. Preserve the module used by the renderer's other tests.
const loader = Module as any;
const originalLoad = loader._load;
const modulePath = require.resolve("../office");
const cached = require.cache[modulePath];
let office: typeof Office;
try
{
	delete require.cache[modulePath];
	loader._load = function (name: string, ...args: any[]) { return name == "node:child_process" ? subprocesses : originalLoad.call(this, name, ...args); };
	office = require("../office");
}
finally
{
	loader._load = originalLoad;
	if (cached) require.cache[modulePath] = cached;
	else delete require.cache[modulePath];
}

suite("LibreOffice runtime paths", () =>
{
	for (const mode of ["settings", "environment", "automatic", "missing office", "missing Python"] as const)
		test(mode, async () => withTempDir(async dir =>
		{
			const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
			const saved = { SOFFICE_PATH: process.env.SOFFICE_PATH, UNO_PYTHON_PATH: process.env.UNO_PYTHON_PATH, PATH: process.env.PATH, MACRO_ENGINE_PATH: process.env.MACRO_ENGINE_PATH };
			const soffice = path.join(dir, "soffice");
			const python = path.join(dir, "python3");
			const missing = path.join(dir, "missing");
			await fs.writeFile(soffice, "", { mode: 0o755 });
			await fs.writeFile(python, "", { mode: 0o755 });
			await fs.writeFile(path.join(dir, "macro_engine.py"), "");
			probes.length = launches.length = 0;
			try
			{
				Object.defineProperty(process, "platform", { ...descriptor, value: "linux" });
				process.env.PATH = dir;
				delete process.env.MACRO_ENGINE_PATH;
				process.env.SOFFICE_PATH = mode == "settings" ? missing : soffice;
				process.env.UNO_PYTHON_PATH = mode == "settings" ? missing : python;
				if (mode == "automatic")
				{
					delete process.env.SOFFICE_PATH;
					delete process.env.UNO_PYTHON_PATH;
				}
				const environment = { ...process.env };
				const run = office.runLibreOffice({
					assets: dir, cwd: dir, workdir: dir, input: path.join(dir, "input.docx"), output: path.join(dir, "output.docx"), renderPDF: false,
					sofficePath: mode == "missing office" ? missing : mode == "settings" ? soffice : "",
					unoPythonPath: mode == "missing Python" ? missing : mode == "settings" ? python : "",
					log() {}, logError() {}, progress() {},
				});
				if (mode == "missing office" || mode == "missing Python")
				{
					await assert.rejects(run, (error: unknown) => error instanceof office.OfficeError && error.code == "noOffice" && error.message.includes(missing));
					assert.deepEqual(launches, []);
					assert.deepEqual(probes, []);
				}
				else
				{
					await run;
					assert.deepEqual(probes, [python]);
					assert.equal(launches.length, 1);
					assert.equal(launches[0]!.command, python);
					const args = launches[0]!.args;
					assert.equal(args[args.indexOf("--soffice") + 1], soffice);
				}
				assert.deepEqual({ ...process.env }, environment);
			}
			finally
			{
				Object.defineProperty(process, "platform", descriptor);
				for (const [key, value] of Object.entries(saved))
					if (value === undefined) delete process.env[key];
					else process.env[key] = value;
			}
		}));
});
