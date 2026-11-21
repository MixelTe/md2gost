const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const root = path.resolve(__dirname, "../../..");
const work = path.join(root, "out/e2e/pdf-pipeline");
const selected = process.argv.find(x => x.startsWith("--case="))?.slice(7);

async function main() 
{
	const app = path.join(work, "source-app");
	await fs.mkdir(path.join(app, "dist"), { recursive:true });
	await fs.mkdir(path.join(app, "assets"), { recursive:true });
	for (const name of ["index.js", "index.mjs", "cli.js"]) await fs.copyFile(path.join(root, "dist", name), path.join(app, "dist", name));
	await fs.copyFile(path.join(root, "assets/styles.xml"), path.join(app, "assets/styles.xml"));
	const q = s => "'" + s.replaceAll("'", "''") + "'";
	await fs.writeFile(path.join(app, "assets/run.ps1"), `param([string]$InputDoc,[string]$OutputDoc,[string]$MacroTemplate,[switch]$RenderPDF)\n$ErrorActionPreference='Stop'\nWrite-Output 'E2E source runner; template is not modified or used'\n& ${q(path.join(root, "src/test/e2e/word-layout.ps1"))} -InputDoc $InputDoc -OutputDoc $OutputDoc -RenderPDF:$RenderPDF\n`);
	const sourceApi = require(path.join(app, "dist/index.js")).default;
	const ordinaryApi = require(path.join(root, "dist/index.js")).default;
	const resultsPath = path.join(root, "out/e2e/pdf-results.json");
	const results = JSON.parse(await fs.readFile(resultsPath, "utf8").catch(() => "{}"));
	for (const name of ["pdf-prefix-includes", "pdf-interleaved-includes"]) 
	{
		if (selected && !name.includes(selected)) continue;
		const dir = path.join(work, name); await fs.mkdir(dir, { recursive:true });
		const externalMd = path.join(dir, "external.g.md");
		await fs.writeFile(externalMd, "# External document\n\nDOCX_INSERT_ITEM_001 {{person}}\n");
		await ordinaryApi({ input:externalMd, output:path.join(dir, "external.docx"), disableMacros:true, logger:{ info() {}, warn() {}, error() {} } });
		const externalPdf = await PDFDocument.create();
		const font = await externalPdf.embedFont(StandardFonts.Helvetica);
		externalPdf.addPage([595.3, 841.9]).drawText("PDF_INSERT_ITEM_001", { x:85, y:740, size:14, font });
		await fs.writeFile(path.join(dir, "external.pdf"), await externalPdf.save());
		const prefix = "!!rule title E2E & PDF merge\n!!rule author Integration tester\n\n";
		const insertDocx = '!!(external.docx){"person":"Подстановка"}\n\n';
		const insertPdf = "!!(external.pdf){}\n\n";
		const toc = "# СОДЕРЖАНИЕ\n\n";
		const first = "# [first] Первый раздел\n\nPDFMAIN_ITEM_001 Начало основного документа, см. раздел [second].\n\n";
		const last = "# [second] Второй раздел\n\nPDFMAIN_ITEM_002 Конец основного документа.\n\n";
		const source = prefix + (name === "pdf-prefix-includes" ? insertDocx + insertPdf + "!!section from 3\n\n" + toc + first + "---\n\n" + last : toc + first + insertDocx + insertPdf + last);
		const input = path.join(dir, "input.g.md"); await fs.writeFile(input, source);
		try 
		{
			const log = [];
			const result = await sourceApi({ input, output:path.join(dir, "result.pdf"), keepIntermediateDocx:true,
				logger:{ info:m => { log.push(m); console.log(m); }, warn:m => log.push(m), error:m => { log.push(m); console.error(m); } } });
			const merged = await PDFDocument.load(await fs.readFile(result.filePath));
			assert.ok(merged.getPageCount() >= 4);
			assert.equal(merged.getTitle(), "E2E & PDF merge");
			assert.equal(merged.getAuthor(), "Integration tester");
			assert.ok(result.intermediateDocxPath); await fs.stat(result.intermediateDocxPath);
			assert.equal(result.warnings.length, 0);
			results[name] = { status:"passed-structural", pages:merged.getPageCount(), file:result.filePath, log };
			console.log("PDF_PIPELINE_OK " + name + " pages=" + merged.getPageCount());
		}
		catch (e) 
		{
			results[name] = { status:"failed", error:e.stack }; process.exitCode = 1;
			console.error("PDF_PIPELINE_FAILED " + name, e);
		}
		await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));
	}
}
main().catch(e => { console.error(e); process.exitCode = 1; });
