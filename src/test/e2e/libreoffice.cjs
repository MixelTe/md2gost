const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const execute = promisify(require("node:child_process").execFile);
const PizZip = require("pizzip");
const { PDFDocument, PDFArray, PDFDict, PDFName, PDFRef } = require("pdf-lib");
const api = require("../../../dist/index.js").default;
const root = path.resolve(__dirname, "../../..");
const output = process.env.MD2GOST_E2E_DIR || path.join(root, "out/e2e/libreoffice");
const selected = process.argv.find(arg => arg.startsWith("--case="))?.slice(7);
const python = process.env.UNO_PYTHON_PATH || (process.platform == "win32" ? path.join(process.env.ProgramFiles, "LibreOffice/program/python.exe") : "python3");
const soffice = process.env.SOFFICE_PATH || (process.platform == "win32" ? path.join(process.env.ProgramFiles, "LibreOffice/program/soffice.com") : "soffice");
const fonts = "!!rule text font Liberation Serif\n!!rule code text font Liberation Mono\n";

function documentText(zip)
{
	return zip.file("word/document.xml").asText().replaceAll("</w:p>", "\n").replace(/<[^>]+>/g, "").replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">");
}

async function inspectPDF(file)
{
	const pdf = await PDFDocument.load(await fs.readFile(file));
	const refs = new Set(pdf.getPages().map(page => page.ref.toString()));
	let links = 0;
	for (const page of pdf.getPages())
	{
		const annotations = page.node.Annots();
		if (!annotations) continue;
		for (let i = 0; i < annotations.size(); i++)
		{
			const annotation = annotations.lookup(i, PDFDict);
			const action = annotation.lookupMaybe(PDFName.of("A"), PDFDict);
			const dest = annotation.lookup(PDFName.of("Dest")) || (action?.get(PDFName.of("S")) === PDFName.of("GoTo") ? action.lookup(PDFName.of("D")) : undefined);
			if (!dest) continue;
			assert.ok(dest instanceof PDFArray, "Internal link must resolve to an explicit destination");
			const ref = dest.get(0);
			assert.ok(ref instanceof PDFRef && refs.has(ref.toString()), "Internal link points to a missing PDF page");
			links++;
		}
	}
	return { pages: pdf.getPageCount(), links };
}

async function runCase(name, markdown, { repeat = false, links = false, dir = path.join(output, name), continuationKinds } = {})
{
	await fs.mkdir(dir, { recursive: true });
	const input = path.join(dir, "input.g.md");
	await fs.writeFile(input, fonts + markdown);
	const log = [];
	const config = { input, output: path.join(dir, "result.pdf"), engine: "libreoffice", keepIntermediateDocx: true,
		logger: { info: msg => log.push(msg), warn: msg => log.push(msg), error: msg => log.push(msg) } };
	let result;
	try { result = await api(config); }
	finally { await fs.writeFile(path.join(dir, "office.log"), log.join("\n")); }
	assert.deepEqual(result.warnings, []);
	const zip = new PizZip(await fs.readFile(result.intermediateDocxPath));
	const text = documentText(zip);
	const markers = markdown.match(/\b[A-Z][A-Z0-9]*_(?:ROW|LINE)_\d+\b/g) || [];
	for (const marker of markers) assert.equal(text.split(marker).length - 1, 1, `${name}: lost or duplicated ${marker}`);
	const counts = ["Продолжение таблицы", "Продолжение листинга"].map(label => text.split(label).length - 1);
	if (continuationKinds || markers.length)
		assert.deepEqual(counts.map(count => count > 0), continuationKinds ?? [true, true], `${name}: unexpected table/listing continuations: ${counts}`);
	const inspectWork = path.join(dir, "inspect");
	await fs.mkdir(inspectWork, { recursive: true });
	const inspection = await execute(python, [path.join(__dirname, "libreoffice_inspect.py"), "--input", result.intermediateDocxPath,
		"--soffice", soffice, "--work-dir", inspectWork, ...(links ? ["--require-toc"] : [])], { windowsHide: true, timeout: 180000, env: { ...process.env, PYTHONUTF8: "1" } });
	await fs.writeFile(path.join(dir, "layout.json"), inspection.stdout);
	if (repeat)
	{
		const work = path.join(dir, "repeat");
		await fs.mkdir(work, { recursive: true });
		await execute(python, [path.join(root, "assets/macro_engine.py"), "--input", result.intermediateDocxPath,
			"--output", path.join(work, "result.docx"), "--work-dir", work, "--soffice", soffice], { windowsHide: true, timeout: 180000, env: { ...process.env, PYTHONUTF8: "1" } });
		const repeated = documentText(new PizZip(await fs.readFile(path.join(work, "result.docx"))));
		for (const marker of markers) assert.equal(repeated.split(marker).length - 1, 1, `Repeat lost or duplicated ${marker}`);
		assert.deepEqual(["Продолжение таблицы", "Продолжение листинга"].map(label => repeated.split(label).length - 1), counts, "Repeat adds continuation captions");
	}
	const pdf = await inspectPDF(result.filePath);
	if (links) assert.ok(pdf.links > 0, "Missing TOC/reference links");
	console.log(`${name}: ${pdf.pages} pages, ${counts.join("/")} table/listing continuations, ${pdf.links} internal links`);
	return { name, ...pdf, continuations: counts };
}

async function main()
{
	await fs.mkdir(output, { recursive: true });
	const results = [];
	for (const name of ["01-table-first", "02-listing-first", "03-boundaries", "04-appendices"])
	{
		if (selected && selected != name) continue;
		const source = await fs.readFile(path.join(__dirname, "fixtures/continuations", name + ".g.md"), "utf8");
		results.push(await runCase(name, source, { repeat: true, links: name == "04-appendices" }));
	}
	if (!selected || selected == "features")
	{
		results.push(await runCase("features", "!!rule numbering lazy\n!!rule backtick_mono on\n" +
			"!!header align=center\nHEADER [!page]\n!!endheader\n!!footer\n| Pages | [!page] / [!pages] |\n|:---|---:|\n!!endfooter\n\n" +
			"# СОДЕРЖАНИЕ\n\n# [sec] Раздел\n\nFEATURE_START **Полужирный**, *курсив*, `код`, $a_1^2 + \\sqrt{x}$ и [ссылка](https://example.org).\n\n" +
			"[eq]\n$$\n\\mathbf{A}=\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}+\\frac{1}{2}\\sum_{i=1}^{n}x_i\n$$\n\n" +
			":::warning[Примечание]\nFEATURE_NOTE Текст с **выделением**.\n:::\n\n" +
			"!!section landscape from 1\n\n# [wide] Альбомный раздел\n\nLANDSCAPE\n\n" +
			"!!section portrait unpaged\n\n!!header none\n!!footer none\n\n# [last] Последний раздел\n\nFEATURE_END Ссылки [sec], [wide], [eq].\n", { links: true }));
		const xml = new PizZip(await fs.readFile(path.join(output, "features/result.docx"))).file("word/document.xml").asText();
		assert.match(xml, /<m:oMath[ >]/, "Native formulas were lost during the Writer round trip");
		assert.match(xml, /w:orient="landscape"/, "Landscape section was lost");
	}
	if (!selected || selected == "includes")
	{
		const dir = path.join(output, "includes");
		await fs.mkdir(dir, { recursive: true });
		await fs.writeFile(path.join(dir, "insert.g.md"), "# INSERT_PDF\n\nINSERT_PDF_BODY\n");
		await api({ input: path.join(dir, "insert.g.md"), output: path.join(dir, "insert.pdf"), engine: "libreoffice" });
		await fs.writeFile(path.join(dir, "template.g.md"), "# INSERT_DOCX\n\nFIELD_VALUE: {{name}}\n\n---\n\nINSERT_DOCX_SECOND\n");
		await api({ input: path.join(dir, "template.g.md"), output: path.join(dir, "template.docx"), disableMacros: true });
		const fields = JSON.stringify({ name: "Подстановка & \"текст\"" });
		results.push(await runCase("includes", "# СОДЕРЖАНИЕ\n\n# [one] BEFORE_INSERT\n\nBEFORE_TEXT\n\n!!(insert.pdf){}\n\n" +
			`!!(template.docx)${fields}\n\n!!section landscape\n\n# [two] AFTER_INSERT\n\nAFTER_TEXT [one].\n\n---\n\nFINAL_TEXT\n`, { links: true }));
	}
	await fs.writeFile(path.join(output, selected ? `summary-${selected}.json` : "summary.json"), JSON.stringify(results, null, 2));
}

module.exports = { inspectPDF, runCase, documentText };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
