const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");
const execute = promisify(require("node:child_process").execFile);
const PizZip = require("pizzip");
const api = require("../../../dist/index.js").default;
const { common, listing, table } = require("./fixtures.cjs");
const { documentText, runCase } = require("./libreoffice.cjs");

const fixtures = {
	"short-blocks": {
		markdown: common + listing("EMPTY", 0) + listing("ONE", 1) + table("TINY", 1) +
			"---\n\n" + table("SHORT", 2) + listing("LAST", 1),
		continuations: [],
	},
	"listing-only": {
		markdown: common + listing("BEFORE", 1) + listing("LONG", 102, { blanks: true, wrap: true }) + listing("AFTER", 1),
		continuations: ["листинга 2"],
	},
	"table-only": {
		markdown: common + table("BEFORE", 2) + "---\n\n" +
			table("LONG", 66, 3, row => row % 12 == 0 ? 3 : 1, 2) + table("AFTER", 2),
		continuations: ["таблицы 2"],
	},
	"uncaptioned-blocks": {
		markdown: common + listing("PLAIN", 63).replace(/^```[^\n]*/, "```txt") +
			"| Заголовок |\n| :--- |\n| PLAIN_ROW_001 |\n",
		continuations: [],
	},
	"oversized-row": {
		markdown: common + table("HUGE", 2, 2, row => row == 0 ? 70 : 1),
		error: /Table header and first data row do not fit on one page/,
	},
};

const marker = /\b[A-Z][A-Z0-9]*_(?:ROW|LINE)_\d{3}\b/g;
const logger = { info() {}, warn() {}, error() {} };

async function readDocx(file)
{
	return new PizZip(await fs.readFile(file));
}

function codeLines(docx)
{
	const styles = docx.file("word/styles.xml").asText();
	const codeStyle = [...styles.matchAll(/<w:style\b[^>]*>[\s\S]*?<\/w:style>/g)]
		.find(([style]) => /<w:name\b[^>]*\bw:val="Listing_Code"/.test(style));
	assert.ok(codeStyle, "DOCX lost the listing code style");
	const id = /\bw:styleId="([^"]+)"/.exec(codeStyle[0])[1];
	const xml = docx.file("word/document.xml").asText();
	return [...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)]
		.filter(([paragraph]) => /<w:pStyle\b[^>]*\bw:val="([^"]+)"/.exec(paragraph)?.[1] == id)
		.map(([paragraph]) => [...paragraph.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)].map(match => match[1]).join(""));
}

async function verifyDocument(file, fixture, raw)
{
	const docx = await readDocx(file);
	const text = documentText(docx);
	assert.deepEqual(text.match(marker), fixture.markdown.match(marker), "Data markers were lost, duplicated or reordered");
	const continuations = [...text.matchAll(/Продолжение ((?:таблицы|листинга)\s+\d+)/g)].map(match => match[1]);
	assert.deepEqual([...new Set(continuations)], fixture.continuations, "Wrong numbered blocks received continuations");
	if (fixture.markdown.includes("```"))
		assert.deepEqual(codeLines(docx), codeLines(raw), "Code text or blank code lines changed");
}

async function main()
{
	const engine = process.argv.find(arg => arg.startsWith("--engine="))?.slice(9);
	assert.ok(engine == "word" || engine == "libreoffice", "Use --engine=word or --engine=libreoffice");
	const selected = process.argv.find(arg => arg.startsWith("--case="))?.slice(7);
	assert.ok(!selected || Object.hasOwn(fixtures, selected), `Unknown case: ${selected}`);
	const output = path.resolve(process.env.MD2GOST_E2E_DIR || `out/e2e/macro-edges/${engine}`);
	await fs.mkdir(output, { recursive: true });
	const work = await fs.mkdtemp(path.join(output, "run-"));
	console.log(`Macro edge cases (${engine}): ${work}`);
	for (const [name, fixture] of Object.entries(fixtures))
	{
		if (selected && selected != name) continue;
		const dir = path.join(work, name);
		await fs.mkdir(dir);
		const input = path.join(dir, "input.g.md");
		const pdf = path.join(dir, "result.pdf");
		const result = path.join(dir, "result.docx");
		await fs.writeFile(input, fixture.markdown);
		if (fixture.error)
		{
			await assert.rejects(api({ input, output: pdf, engine, logger, abortSignal: AbortSignal.timeout(180000) }), error =>
			{
				assert.equal(error.code, engine == "word" ? "vba" : "office");
				assert.match(`${error.message}\n${error.officeLog.join("")}`, fixture.error);
				assert.equal(error.renderedFile, result);
				return true;
			});
			await assert.rejects(fs.stat(pdf), { code: "ENOENT" });
			assert.deepEqual(documentText(await readDocx(result)).match(marker), fixture.markdown.match(marker), "Recovered DOCX lost table rows");
		}
		else
		{
			const raw = path.join(dir, "raw.docx");
			await api({ input, output: raw, disableMacros: true, logger });
			const original = await readDocx(raw);
			if (engine == "word")
			{
				const { stdout } = await execute("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
					path.join(__dirname, "word-layout.ps1"), "-InputDoc", raw, "-OutputDoc", result], { timeout: 360000 });
				assert.match(stdout, /LAYOUT_OK/);
			}
			else
			{
				const continuationKinds = ["таблицы", "листинга"].map(kind => fixture.continuations.some(caption => caption.startsWith(kind)));
				await runCase(name, fixture.markdown, { dir, repeat: true, continuationKinds });
				await verifyDocument(path.join(dir, "repeat/result.docx"), fixture, original);
			}
			await verifyDocument(result, fixture, original);
		}
		console.log(`PASS ${engine}/${name}`);
	}
}

main().catch(error => { console.error(error); process.exitCode = 1; });
