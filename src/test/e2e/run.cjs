const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const Zip = require("pizzip");
const { pathToFileURL } = require("node:url");
const root = path.resolve(__dirname, "../../..");
const work = process.env.MD2GOST_E2E_DIR || path.join(root, "out/e2e");
const { default: api, MDRenderError, reverseDocx, inspectDocx } = require(path.join(root, "dist/index.js"));
const exec = promisify(execFile);
const selected = process.argv.find(a => a.startsWith("--case="))?.slice(7);
const phases = process.argv.find(a => a.startsWith("--phase="))?.slice(8) || "api";
const reportPath = path.join(work, "results.json");
let report = {};

async function write(dir, name, content) 
{
	const file = path.join(dir, name);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, content);
	return file;
}
function readDoc(bytes) 
{
	const zip = new Zip(bytes);
	const xml = zip.file("word/document.xml").asText();
	const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/gs)].map(m => m[1]).join("");
	return { zip, xml, text };
}
async function run(name, fn) 
{
	if (selected && !name.includes(selected)) return;
	const start = Date.now();
	const dir = path.join(work, name);
	await fs.mkdir(dir, { recursive: true });
	try 
	{
		const details = await fn(dir);
		report[name] = { status: "passed", seconds: (Date.now() - start) / 1000, details };
		console.log(`PASS ${name}`);
	}
	catch (error) 
	{
		report[name] = { status: "failed", seconds: (Date.now() - start) / 1000, error: error.stack };
		console.error(`FAIL ${name}: ${error.message}`);
		process.exitCode = 1;
	}
	await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
}
async function render(input, output, extra = {}) 
{
	const logs = [];
	const result = await api({ input, output, disableMacros: true,
		logger: { info() {}, warn: m => logs.push(m), error: m => logs.push(m) }, ...extra });
	return { ...result, ...readDoc(await fs.readFile(result.filePath)), logs };
}

async function main() 
{
	await fs.mkdir(work, { recursive: true });
	report = JSON.parse(await fs.readFile(reportPath, "utf8").catch(() => "{}"));
	if (phases === "api") 
	{
		await run("api-docx-reverse-inspect", async dir =>
		{
			const input = await write(dir, "source.g.md", "# Reverse\n\nREVERSE_MARKER **bold**\n\n```text\n  CODE_MARKER\n```\n");
			const rendered = await render(input, path.join(dir, "source.docx"));
			const files = await fs.readdir(dir);
			const inspection = await inspectDocx({ input: rendered.filePath, format: "json" });
			assert.ok(JSON.parse(inspection.content).nodes.some(n => n.type === "code"));
			assert.deepEqual(await fs.readdir(dir), files);
			const reversed = await reverseDocx({ input: rendered.filePath, output: path.join(dir, "reversed.g.md") });
			const roundtrip = await render(reversed.filePath, path.join(dir, "roundtrip.docx"));
			assert.ok(roundtrip.text.includes("REVERSE_MARKER"));
			const cli = path.join(root, "dist/cli.js");
			const options = { cwd: dir, timeout: 30000 };
			const inspected = await exec(process.execPath, [cli, "inspect", rendered.filePath, "--format", "json"], options);
			assert.deepEqual(JSON.parse(inspected.stdout), JSON.parse(inspection.content));
			const output = path.join(dir, "cli.g.md");
			await exec(process.execPath, [cli, "reverse", rendered.filePath, "-o", output], options);
			await fs.writeFile(output, "KEEP_EXISTING");
			const refused = await exec(process.execPath, [cli, "reverse", rendered.filePath, "-o", output], options).then(() => null, error => error);
			assert.equal(refused.code, 1);
			assert.equal(await fs.readFile(output, "utf8"), "KEEP_EXISTING");
			await exec(process.execPath, [cli, "reverse", rendered.filePath, "-o", output, "--force"], options);
			assert.ok((await fs.readFile(output, "utf8")).includes("CODE_MARKER"));
			const esm = await import(pathToFileURL(path.join(root, "dist/index.mjs")).href);
			assert.equal(typeof esm.reverseDocx, "function");
			assert.equal(typeof esm.inspectDocx, "function");
			const bad = await exec(process.execPath, [cli, "inspect", rendered.filePath, "--format", "bad"], options).then(() => null, error => error);
			assert.equal(bad.code, 1);
			assert.equal(bad.stdout, "");
			return { entries: ["CJS", "ESM", "CLI"], roundtrip: true, preservesExisting: true };
		});
		await run("cli-metadata", async dir =>
		{
			const cliPath = path.join(root, "dist/cli.js");
			const options = { timeout: 30000, cwd: dir };
			const version = require(path.join(root, "package.json")).version;
			const versionResult = await exec(process.execPath, [cliPath, "--version"], options);
			assert.equal(versionResult.stdout.trim(), version);
			assert.equal(versionResult.stderr, "");
			const infoResult = await exec(process.execPath, [cliPath, "--skill-info"], options);
			assert.equal(infoResult.stderr, "");
			const info = JSON.parse(infoResult.stdout);
			assert.equal(info.version, version);
			assert.equal(info.skill.name, "md2gost-report");
			assert.equal(info.skill.path, path.join(root, "skills/md2gost-report/SKILL.md"));
			assert.match(info.skill.version, /^\d+\.\d+\.\d+/);
			const skill = await fs.readFile(info.skill.path, "utf8");
			assert.ok(skill.includes(`  version: "${info.skill.version}"`));
			assert.ok(skill.includes(`  md2gost-version: "${info.skill.md2gostVersion}"`));
			await fs.access(path.join(path.dirname(info.skill.path), "references/rendering.md"));
			assert.deepEqual(await fs.readdir(dir), []);
			const missingInput = await exec(process.execPath, [cliPath], options).then(() => null, error => error);
			assert.equal(missingInput.code, 1);
			assert.match(missingInput.stderr, /missing required argument 'input'/);
			return { version, skillVersion: info.skill.version, foreignWorkingDirectory: true };
		});
		await run("api-cjs-esm-cli", async dir => 
		{
			const input = await write(dir, "документ с пробелами.g.md", "# Заголовок\n\nE2E_MARKER_001 **полужирный** _курсив_ `code`\n");
			const cjs = await render(input, path.join(dir, "cjs.docx"));
			assert.ok(cjs.xml.includes("E2E_MARKER_001"));
			const esm = (await import(pathToFileURL(path.join(root, "dist/index.mjs")).href)).default;
			const result = await esm({ input, output: path.join(dir, "esm.docx"), disableMacros: true });
			assert.ok(readDoc(await fs.readFile(result.filePath)).xml.includes("E2E_MARKER_001"));
			const cli = await exec(process.execPath, [path.join(root, "dist/cli.js"), input, "-d", "-o", path.join(dir, "cli файл.docx")], { timeout: 30000, cwd: dir });
			assert.match(cli.stdout, /Successfully saved/);
			assert.ok(readDoc(await fs.readFile(path.join(dir, "cli файл.docx"))).xml.includes("E2E_MARKER_001"));
			return { entries: ["CJS", "ESM", "CLI"], unicodeAndSpaces: true };
		});
		await run("api-output-directories", async dir => 
		{
			const input = await write(dir, "report.g.md", "# Output\n\nE2E_MARKER_002");
			for (const name of ["folder", "folder.v1", "folder.docx"]) 
			{
				const target = path.join(dir, name);
				await fs.mkdir(target, { recursive: true });
				const result = await render(input, target);
				assert.equal(result.filePath, path.join(target, "report.docx"));
			}
			const trailing = await render(input, path.join(dir, "new.v2") + path.sep);
			assert.equal(trailing.filePath, path.join(dir, "new.v2", "report.docx"));
			const cliTarget = path.join(dir, "cli.v3");
			await fs.mkdir(cliTarget, { recursive: true });
			await exec(process.execPath, [path.join(root, "dist/cli.js"), input, "-d", "-o", cliTarget], { timeout: 30000, cwd: dir });
			await fs.stat(path.join(cliTarget, "report.docx"));
		});
		await run("api-template-includes", async dir => 
		{
			await write(dir, "blocks/child.g.md", "# {{title}}\n{{#for item in items}}\n\nITEM_{{item}}\n{{/for}}\n");
			const input = await write(dir, "template.g.md", '!!(blocks/child.g.md){"title":"Шаблон", "items":[1,2,3]}\n\n{{rootName}} {{missing || "fallback"}}');
			const result = await render(input, path.join(dir, "output.docx"), { variables: { rootName: "ROOT_VALUE" } });
			for (const value of ["ITEM_1", "ITEM_2", "ITEM_3", "ROOT_VALUE", "fallback"]) assert.ok(result.xml.includes(value), value);
			assert.equal(result.warnings.length, 0);
		});
		await run("api-format-controls", async dir => 
		{
			const input = await write(dir, "format.g.md", "!!rule link color 123ABC\n!!rule link underline off\n!!rule typography nbsp units off\n# [target] Ссылка\n\n[сайт](https://example.com/a_b?x=1&y=2) [target]\n\n5 кг и А. С. Пушкин. \\_escaped\\_ \\[literal]");
			const result = await render(input, path.join(dir, "output.docx"));
			assert.match(result.xml, /w:color w:val="123abc"/i);
			assert.ok(result.xml.includes('w:val="none"'));
			assert.ok(result.xml.includes("5 кг"));
			assert.ok(result.text.includes("_escaped_"));
			assert.ok(result.text.includes("[literal]"));
			assert.ok(result.zip.file("word/_rels/document.xml.rels").asText().includes("a_b?x=1&amp;y=2"));
		});
		await run("api-section-geometry", async dir => 
		{
			const sections = [
				"!!header\n| Header | Page [!page] |\n|---|---|\n!!endheader\n!!footer\n| Footer | Pages [!pages] |\n|---|---|\n!!endfooter\n",
				"!!section landscape\n",
			];
			const body = sections.map((s, i) => s + "\n# Section " + i + "\n\nTable\n| A | B |\n|---|---|\n| value | value |\n\n$$\nx = 1\n$$\n").join("\n");
			const input = await write(dir, "geometry.g.md", body);
			const result = await render(input, path.join(dir, "output.docx"));
			const allParts = Object.keys(result.zip.files).filter(n => /^word\/(document|header\d+|footer\d+)\.xml$/.test(n));
			const portraitWidth = 11906 - 1700 - 850;
			const landscapeWidth = 16838 - 1700 - 850;
			const widths = [];
			for (const part of allParts) 
			{
				const xml = result.zip.file(part).asText();
				for (const m of xml.matchAll(/<w:tblW w:type="dxa" w:w="([0-9]+)"\/>/g)) 
				{
					const width = Number(m[1]); widths.push({ part, width });
					assert.ok(width <= landscapeWidth, `${part}: table wider than landscape content area: ${width} > ${landscapeWidth}`);
				}
			}
			const docTables = [...result.xml.matchAll(/<w:tblW w:type="dxa" w:w="([0-9]+)"\/>/g)].map(m => Number(m[1]));
			assert.equal(docTables.length, 4);
			assert.ok(docTables[0] <= portraitWidth, `portrait table ${docTables[0]} > ${portraitWidth}`);
			assert.ok(docTables[1] <= portraitWidth, `portrait equation ${docTables[1]} > ${portraitWidth}`);
			for (const width of docTables.slice(2)) assert.ok(width <= landscapeWidth);
			return widths;
		});
		await run("api-errors-and-cancellation", async dir => 
		{
			const input = await write(dir, "valid.g.md", "# valid");
			for (const useLibreOffice of [true, false])
				await assert.rejects(() => api({ input, useLibreOffice }), error => error instanceof TypeError && /unknown properties.*useLibreOffice/.test(error.message));
			await assert.rejects(() => api({ input, format: "pdf", disableMacros: true }), /Office postprocessing must be enabled/);
			await assert.rejects(() => api({ input, output: path.join(dir, "bad.pdf"), format: "docx", disableMacros: true }), /extension must match/);
			await assert.rejects(() => api({ input: path.join(dir, "missing.g.md"), disableMacros: true }));
			const controller = new AbortController(); controller.abort();
			await assert.rejects(() => api({ input, output: path.join(dir, "aborted.docx"), disableMacros: true, abortSignal: controller.signal }));
			await assert.rejects(() => fs.stat(path.join(dir, "aborted.docx")), { code: "ENOENT" });
			const outside = await write(work, "outside.md", "outside");
			const boundary = await write(dir, "boundary.g.md", "!!(../outside.md){}");
			await assert.rejects(() => api({ input: boundary, disableMacros: true }), error =>
			{
				assert.ok(error instanceof MDRenderError);
				assert.equal(error.code, "userInput");
				assert.deepEqual(error.officeLog, []);
				assert.equal("powershellLog" in error, false);
				return true;
			});
			const allowed = await render(boundary, path.join(dir, "allowed.docx"), { checkFilesIsInsidePath: false });
			assert.ok(allowed.xml.includes("outside"));
			const cyclic = await write(dir, "cycle.g.md", "!!(cycle.g.md){}");
			await assert.rejects(() => api({ input: cyclic, disableMacros: true }), e => e.code === "userInput");
			const invalidCli = await exec(process.execPath, [path.join(root, "dist/cli.js"), input, "-d", "-f", "pdf"], { timeout: 30000, cwd: dir }).then(() => null, e => e);
			assert.equal(invalidCli.code, 1);
			assert.doesNotMatch(invalidCli.stdout, /Successfully saved/);
			assert.ok(outside);
		});
	}
}
main().catch(e => { console.error(e); process.exitCode = 1; });
