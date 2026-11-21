import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFString } from "pdf-lib";
import { assemblePDFManifest } from "../pdfMerge";

suite("PDF assembly", () =>
{
	let dir: string;
	setup(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), "md2gost-pdf-")); });
	teardown(async () => { await fs.rm(dir, { recursive: true, force: true }); });
	async function fixture()
	{
		const main = await PDFDocument.create();
		const pages = [main.addPage(), main.addPage(), main.addPage()];
		pages[0].node.set(PDFName.of("Annots"), main.context.obj([{ Type: "Annot", Subtype: "Link", Rect: [0, 0, 20, 20], Dest: [pages[2].ref, "Fit"] }]));
		await fs.writeFile(path.join(dir, "000-main.pdf"), await main.save());
		const insert = await PDFDocument.create();
		const from = insert.addPage(), to = insert.addPage();
		insert.catalog.set(PDFName.of("Names"), insert.context.obj({ Dests: { Names: [PDFString.of("last"), [to.ref, "Fit"]] } }));
		from.node.set(PDFName.of("Annots"), insert.context.obj([
			{ Subtype: "Link", Rect: [0, 0, 20, 20], Dest: [to.ref, "Fit"] },
			{ Subtype: "Link", Rect: [0, 0, 20, 20], A: { S: "GoTo", D: PDFString.of("last") } },
			{ Subtype: "Link", Rect: [0, 0, 20, 20], A: { S: "URI", URI: PDFString.of("https://example.com") } },
		]));
		await fs.writeFile(path.join(dir, "002-pdf.pdf"), await insert.save());
		return { version: 1, main: "000-main.pdf", parts: [{ type: "main", from: 1, to: 1 }, { type: "include", file: "002-pdf.pdf" }, { type: "main", from: 3, to: 3 }] };
	}
	test("preserves main TOC destinations across inserted pages and remaps included links", async () =>
	{
		const plan = await fixture();
		const file = path.join(dir, "manifest.json");
		await fs.writeFile(file, JSON.stringify(plan));
		const assembled = await assemblePDFManifest(file);
		const pdf = await PDFDocument.load(await assembled.save());
		assert.equal(pdf.getPageCount(), 4);
		const pages = pdf.getPages();
		const annotations = pages[0].node.Annots()!;
		assert.equal(annotations.lookup(0, PDFDict).lookup(PDFName.of("Dest"), PDFArray).get(0).toString(), pages[3].ref.toString());
		const inserted = pages[1].node.Annots()!;
		assert.equal(inserted.lookup(0, PDFDict).lookup(PDFName.of("Dest"), PDFArray).get(0).toString(), pages[2].ref.toString());
		assert.equal(inserted.lookup(1, PDFDict).lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("D"), PDFArray).get(0).toString(), pages[2].ref.toString());
		assert.equal(inserted.lookup(2, PDFDict).lookup(PDFName.of("A"), PDFDict).get(PDFName.of("S")), PDFName.of("URI"));
	});
	test("rejects overlapping page ranges and filenames outside the export directory", async () =>
	{
		const plan = await fixture();
		const file = path.join(dir, "manifest.json");
		plan.parts.push({ type: "main", from: 1, to: 1 });
		await fs.writeFile(file, JSON.stringify(plan));
		await assert.rejects(assemblePDFManifest(file), /overlapping/);
		await fs.writeFile(file, JSON.stringify({ ...plan, main: "../000-main.pdf" }));
		await assert.rejects(assemblePDFManifest(file), /filename/);
	});
});
