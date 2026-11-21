const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");
const tar = require("tar");
const Zip = require("pizzip");

async function main()
{
	const root = path.resolve(__dirname, "../../..");
	const dir = process.env.MD2GOST_PACKAGE_DIR || path.join(root, "out/e2e/packages");
	const version = require(path.join(root, "package.json")).version;
	const snapshot = require(path.join(root, "file-snapshot.json"));
	const tgzFiles = [];
	const tgz = path.join(dir, `md2gost-${version}.tgz`);
	await tar.list({ file: tgz, onentry: entry => tgzFiles.push(entry.path) });
	assert.deepEqual(tgzFiles.sort(), snapshot.tgzFiles);
	const vsix = new Zip(await fs.readFile(path.join(dir, `md2gost-${version}.vsix`)));
	assert.deepEqual(Object.keys(vsix.files).filter(name => !name.endsWith("/")).sort(), snapshot.vsixFiles);
	const unpack = await fs.mkdtemp(path.join(dir, "unpacked-"));
	await tar.x({ file: tgz, cwd: unpack });
	const installed = path.join(unpack, "package");
	const template = await fs.readFile(path.join(root, "assets/template.dotm"));
	assert.deepEqual(await fs.readFile(path.join(installed, "assets/template.dotm")), template);
	assert.deepEqual(vsix.file("extension/assets/template.dotm").asNodeBuffer(), template);
	const engine = await fs.readFile(path.join(root, "assets/macro_engine.py"));
	assert.deepEqual(await fs.readFile(path.join(installed, "assets/macro_engine.py")), engine);
	assert.deepEqual(vsix.file("extension/assets/macro_engine.py").asNodeBuffer(), engine);
	if (process.argv.includes("--assets-only"))
	{
		console.log("PACKAGE_ASSETS_OK npm=" + tgzFiles.length + " VSIX=" + snapshot.vsixFiles.length + " both archives contain current Word and LibreOffice assets");
		return;
	}
	if (process.env.MD2GOST_PACKAGE_DIR)
		await fs.symlink(path.join(root, "node_modules"), path.join(installed, "node_modules"), process.platform == "win32" ? "junction" : "dir");
	const input = path.join(unpack, "package.g.md");
	await fs.writeFile(input, "# Package smoke\n\nPACKAGE_ITEM_001\n\nTable\n| A | B |\n|---|---|\n| 1 | 2 |");
	const quiet = { info() {}, warn() {}, error() {} };
	const cjs = require(path.join(installed, "dist/index.js")).default;
	const esm = (await import(pathToFileURL(path.join(installed, "dist/index.mjs")).href)).default;
	for (const [name, api] of [["cjs", cjs], ["esm", esm]])
		await api({ input, output: path.join(unpack, name + ".docx"), disableMacros: true, logger: quiet });
	execFileSync(process.execPath, [path.join(installed, "dist/cli.js"), input, "--output", path.join(unpack, "cli.docx"), "--disable-macros"], { stdio: "pipe", cwd: unpack });
	for (const name of ["cjs", "esm", "cli"])
	{
		const doc = new Zip(await fs.readFile(path.join(unpack, name + ".docx")));
		assert.ok(doc.file("word/document.xml").asText().includes("PACKAGE_ITEM_001"));
		assert.ok(doc.file("word/styles.xml").asText().includes("Table_Caption"));
	}
	if (process.env.MD2GOST_TEST_LIBREOFFICE == "1")
	{
		for (const [name, api] of [["cjs", cjs], ["esm", esm]])
			await api({ input, output: path.join(unpack, name + ".pdf"), engine: "libreoffice", logger: quiet });
		execFileSync(process.execPath, [path.join(installed, "dist/cli.js"), input, "--output", path.join(unpack, "cli.pdf"), "--engine", "libreoffice"], { stdio: "pipe", timeout: 180000, cwd: unpack });
		for (const name of ["cjs", "esm", "cli"])
			assert.ok((await fs.stat(path.join(unpack, name + ".pdf"))).size > 1000);
	}
	console.log("PACKAGE_SMOKE_OK npm=" + tgzFiles.length + " VSIX=" + snapshot.vsixFiles.length + " CJS/ESM/CLI exports passed (workspace dependencies)");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
