const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const PizZip = require("pizzip");
const { default: api, MDRenderError } = require("../../../dist/index.js");
const { table, common } = require("./fixtures.cjs");
const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const os = require("node:os");
const execute = promisify(execFile);
const root = process.env.MD2GOST_E2E_DIR || path.resolve(__dirname, "../../../out/e2e/libreoffice-runtime");
const logger = { info() {}, warn() {}, error() {} };

async function cleanJobs(dir)
{
	assert.deepEqual((await fs.readdir(dir)).filter(name => name.startsWith(".md2gost-")), [], "Temporary jobs were not removed");
}

async function main()
{
	const profiles = new Set((await fs.readdir(os.tmpdir())).filter(name => name.startsWith("md2gost-profile-")));
	const cleanProfiles = async () => assert.deepEqual((await fs.readdir(os.tmpdir())).filter(name => name.startsWith("md2gost-profile-") && !profiles.has(name)), [], "Temporary office profiles were not removed");
	await fs.mkdir(root, { recursive: true });
	const input = path.join(root, "Документ (тест).g.md");
	await fs.writeFile(input, "# СОДЕРЖАНИЕ\n\n# [section] Раздел\n\nRUNTIME_MARKER [section].\n");
	const base = { input, logger };
	const python = process.env.UNO_PYTHON_PATH || (process.platform == "win32" ? path.join(process.env.ProgramFiles, "LibreOffice/program/python.exe") : "python3");
	await execute(python, [path.join(__dirname, "libreoffice_processes.py"), root, "--python", python], {
		windowsHide: true, timeout: 20000, env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" },
	});
	if (process.platform != "win32")
	{
		const processor = path.join(root, "failed-processor.py");
		await fs.writeFile(processor, "import subprocess, sys\nsubprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)'])\nsys.exit(7)\n");
		const previousProcessor = process.env.MACRO_ENGINE_PATH;
		process.env.MACRO_ENGINE_PATH = processor;
		try
		{
			// Without exit-group cleanup, the descendant keeps stderr open until timeout.
			await assert.rejects(api({ ...base, engine: "libreoffice", output: path.join(root, "failed.pdf"), abortSignal: AbortSignal.timeout(10000) }), error => error.code == "office");
		}
		finally
		{
			if (previousProcessor === undefined) delete process.env.MACRO_ENGINE_PATH;
			else process.env.MACRO_ENGINE_PATH = previousProcessor;
		}
		await cleanJobs(root);
		await cleanProfiles();
	}
	await assert.rejects(api({ ...base, engine: "invalid" }), TypeError);
	const auto = await api({ ...base, output: path.join(root, "автовыбор.pdf") });
	assert.equal(auto.warnings.length, 0);
	assert.ok((await fs.stat(auto.filePath)).size > 1000);
	const retained = await api({ ...base, engine: "libreoffice", output: path.join(root, "retained.pdf"), keepIntermediateDocx: true });
	assert.ok((await fs.stat(retained.intermediateDocxPath)).size > 1000);
	await api({ ...base, engine: "libreoffice", output: path.join(root, "retained.pdf") });
	await assert.rejects(fs.stat(retained.intermediateDocxPath), { code: "ENOENT" });
	const docx = await api({ ...base, output: path.join(root, "document.docx"), engine: "libreoffice" });
	assert.ok((await fs.stat(docx.filePath)).size > 1000);

	const previous = process.env.SOFFICE_PATH;
	const previousPython = process.env.UNO_PYTHON_PATH;
	process.env.SOFFICE_PATH = path.join(root, "missing-soffice");
	try
	{
		await assert.rejects(api({ ...base, engine: "libreoffice", output: path.join(root, "missing.pdf") }), error =>
		{
			assert.ok(error instanceof MDRenderError);
			assert.equal(error.code, "noOffice");
			assert.ok(Array.isArray(error.officeLog));
			assert.equal("powershellLog" in error, false);
			assert.ok(error.renderedFile.endsWith("missing.docx"));
			return true;
		});
		const broken = path.join(root, "broken-soffice");
		await fs.writeFile(broken, "Not an executable", { mode: 0o755 });
		process.env.SOFFICE_PATH = broken;
		process.env.UNO_PYTHON_PATH = python;
		await assert.rejects(api({ ...base, engine: "libreoffice", output: path.join(root, "startup.pdf") }), error =>
		{
			assert.equal(error.code, "noOffice");
			assert.match(error.message, /startup failed/);
			assert.match(error.officeLog.join(""), /Traceback/);
			return true;
		});
	}
	finally
	{
		if (previous === undefined) delete process.env.SOFFICE_PATH;
		else process.env.SOFFICE_PATH = previous;
		if (previousPython === undefined) delete process.env.UNO_PYTHON_PATH;
		else process.env.UNO_PYTHON_PATH = previousPython;
	}
	await cleanJobs(root);
	await cleanProfiles();
	if (process.platform != "win32")
		await assert.rejects(api({ ...base, engine: "word", output: path.join(root, "word.pdf") }), error => error.code == "noOffice");

	const controller = new AbortController();
	await assert.rejects(api({ ...base, engine: "libreoffice", output: path.join(root, "cancelled.pdf"), abortSignal: controller.signal,
		progress: percent => { if (percent >= 62) controller.abort(new Error("cancel-runtime-check")); },
	}), error => error.cause?.message == "cancel-runtime-check");
	assert.ok(controller.signal.aborted);
	await assert.rejects(fs.stat(path.join(root, "cancelled.pdf")), { code: "ENOENT" });
	await cleanJobs(root);
	await cleanProfiles();
	if (process.platform != "win32")
	{
		await new Promise((resolve, reject) =>
		{
			const child = spawn(process.execPath, [path.resolve(__dirname, "../../../dist/cli.js"), input, "--engine", "libreoffice", "--check-files-inside", root, "-o", path.join(root, "cli-cancelled.pdf")]);
			let interrupted = false;
			let stdout = "";
			let stderr = "";
			child.stdout.on("data", data =>
			{
				stdout += data;
				if (!interrupted && stdout.includes("[62%]")) { interrupted = true; child.kill("SIGINT"); }
			});
			child.stderr.on("data", data => stderr += data);
			const timeout = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("CLI cancellation timed out")); }, 90000);
			child.on("error", reject);
			child.on("close", code =>
			{
				clearTimeout(timeout);
				try { assert.equal(code, 130, stderr); assert.ok(interrupted); resolve(); }
				catch (error) { reject(error); }
			});
		});
		await cleanJobs(root);
		await cleanProfiles();
	}

	const pair = await Promise.all(["FIRST", "SECOND"].map(async marker =>
	{
		const file = path.join(root, marker + ".g.md");
		await fs.writeFile(file, "# СОДЕРЖАНИЕ\n\n# " + marker + "\n\nBODY_" + marker + "\n");
		return api({ input: file, output: path.join(root, marker + ".pdf"), engine: "libreoffice", keepIntermediateDocx: true, logger });
	}));
	for (let i = 0; i < pair.length; i++)
	{
		const xml = new PizZip(await fs.readFile(pair[i].intermediateDocxPath)).file("word/document.xml").asText();
		assert.ok(xml.includes(i == 0 ? "BODY_FIRST" : "BODY_SECOND"));
		assert.ok(!xml.includes(i == 0 ? "BODY_SECOND" : "BODY_FIRST"));
	}
	await cleanJobs(root);
	await cleanProfiles();

	const oversized = path.join(root, "oversized.g.md");
	await fs.writeFile(oversized, common + table("TX", 2, 2, row => row == 0 ? 70 : 1));
	await assert.rejects(api({ input: oversized, output: path.join(root, "oversized.pdf"), engine: "libreoffice", logger }), error =>
	{
		assert.equal(error.code, "office");
		assert.match(error.officeLog.join(""), /do not fit/);
		return true;
	});
	await cleanJobs(root);
	console.log("Runtime: auto selection, DOCX/PDF exports, errors, Unicode paths, cancellation, concurrency and oversized rows passed");
}

main().catch(error => { console.error(error); process.exitCode = 1; });
