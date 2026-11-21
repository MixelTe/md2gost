const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { PDFDocument } = require("pdf-lib");
const Zip = require("pizzip");

// This check uses the shipped runner and template, without source injection.
// No source injection, template changes or template generation occurs here.
async function main()
{
	const root = path.resolve(__dirname, "../../..");
	const work = path.join(root, "out/e2e/standard-runner");
	await fs.mkdir(work, { recursive: true });
	const template = await fs.readFile(path.join(root, "assets/template.dotm"));
	const hash = crypto.createHash("sha256").update(template).digest("hex");
	const reportPath = path.join(work, "results.json");
	const report = { templateSha256: hash, cases: {} };
	try
	{
		const api = require(path.join(root, "dist/index.js")).default;
		const input = path.join(root, "out/e2e/layout/mixed-sections/input.g.md");
		const output = path.join(work, "mixed.docx");
		const log = [];
		const result = await api({ input, output, abortSignal: AbortSignal.timeout(240000), logger: {
			info: message => { log.push(message); console.log(message); },
			warn: message => log.push(message), error: message => { log.push(message); console.error(message); },
		} });
		assert.equal(result.warnings.length, 0);
		assert.ok(log.includes("[!4] Starting word"), "Auto must prefer the installed Word");
		assert.ok(log.some(message => message.includes("Generating continued tables and listings")));
		assert.ok(!log.some(message => message.includes("E2E source runner")));
		const zip = new Zip(await fs.readFile(output));
		const xml = zip.file("word/document.xml").asText();
		assert.ok(xml.includes("Продолжение таблицы"));
		assert.ok(xml.includes("Продолжение листинга"));
		const markers = /[A-Z][A-Z0-9]*_(?:ROW|LINE|ITEM)_[0-9]{3}/g;
		const xmlText = [...xml.matchAll(/<w:p(?:\s[^>]*)?>.*?<\/w:p>/gs)].map(match => [...match[0].matchAll(/<w:t(?:\s[^>]*)?>(.*?)<\/w:t>/gs)].map(run => run[1]).join("")).join("\n");
		assert.deepEqual(xmlText.match(markers), (await fs.readFile(input, "utf8")).match(markers));
		report.cases["api-docx"] = { status: "passed", file: output, log };
		await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

		const pdfInput = path.join(root, "out/e2e/pdf-pipeline/pdf-interleaved-includes/input.g.md");
		const pdfOutput = path.join(work, "interleaved.pdf");
		let cliLog = "";
		await new Promise((resolve, reject) =>
		{
			const cli = spawn(process.execPath, [path.join(root, "dist/cli.js"), pdfInput, "--engine", "word", "--output", pdfOutput, "--keep-intermediate-docx"], { cwd: root });
			for (const stream of [cli.stdout, cli.stderr]) stream.on("data", data => { cliLog += data; process.stdout.write(data); });
			cli.on("error", reject);
			cli.on("close", code => code === 0 ? resolve() : reject(new Error("Standard CLI failed with exit code " + code)));
		});
		assert.ok(cliLog.includes("Successfully saved to:"));
		assert.ok(cliLog.includes("[!4] Starting word"));
		assert.ok(!cliLog.includes("E2E source runner"));
		const pdf = await PDFDocument.load(await fs.readFile(pdfOutput));
		assert.equal(pdf.getPageCount(), 5);
		assert.equal(pdf.getTitle(), "E2E & PDF merge");
		await fs.stat(path.join(work, "interleaved.docx"));
		report.cases["cli-pdf"] = { status: "passed-structural", file: pdfOutput, log: cliLog };
		report.status = "awaiting-final-pdf-audit-and-visual-check";
	}
	catch (error)
	{
		report.status = "failed";
		report.error = error.stack;
		console.error(error);
		process.exitCode = 1;
	}
	await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
