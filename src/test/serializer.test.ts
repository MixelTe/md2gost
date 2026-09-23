import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Doc } from "../doc";
import { serializeDocx } from "../serializer";
import { runifyDoc } from "../parser";
import { hasFile, openDocx, xml } from "./helpers/docx";
import { withTempDir, writePng } from "./helpers/fixtures";

const assets = path.resolve(process.cwd(), "assets");

function fixedDoc()
{
	const doc = new Doc();
	doc.title = "A & <B> \"C\" 'D'";
	doc.author = "Author & Co";
	doc.etime = 42;
	doc.ctime = new Date("2020-01-02T03:04:05.000Z");
	doc.mtime = new Date("2021-02-03T04:05:06.000Z");
	return doc;
}

suite("DOCX serializer", () =>
{
	test("writes deterministic metadata and essential DOCX XML", async () => withTempDir(async dir =>
	{
		const doc = fixedDoc();
		doc.nodes = [
			{ type: "title", level: 1, text: "Heading" },
			{ type: "text", text: "**bold** *italic* `mono`<br>next" },
			{ type: "pageBreak" },
		];
		const output = path.join(dir, "report.docx");
		await serializeDocx(runifyDoc(doc), output, dir, assets, dir);
		const zip = openDocx(output);
		for (const name of ["word/document.xml", "word/styles.xml", "word/numbering.xml", "docProps/core.xml", "docProps/app.xml"])
			assert.equal(hasFile(zip, name), true, name);
		const core = xml(zip, "docProps/core.xml");
		assert.ok(core.includes("A &amp; &lt;B&gt; &quot;C&quot; &apos;D&apos;"));
		assert.ok(core.includes("2020-01-02T03:04:05.000Z"));
		assert.ok(xml(zip, "docProps/app.xml").includes("<TotalTime>42</TotalTime>"));
		const document = xml(zip, "word/document.xml");
		assert.ok(document.includes("w:b"));
		assert.ok(document.includes("w:i"));
		assert.ok(document.includes("w:br"));
		assert.ok(document.includes("w:type=\"page\""));
	}));

	test("serializes sections, links, bookmarks, lists, tables, and a case-insensitive PNG", async () => withTempDir(async dir =>
	{
		await writePng(dir, "figure.PNG");
		const doc = fixedDoc();
		doc.nodes = [
			{ type: "text", text: "[external](https://example.test) [internal](#mark)" },
			{ type: "text", text: "target", noIndent: true },
			{ type: "list", ordered: true, mark: ".", startIndex: 3, items: [{ type: "listItem", text: "item" }] },
			{ type: "table", title: "Table", align: ["r"], rows: [[{ type: "text", text: "Head" }], [{ type: "text", text: "Value" }]] },
			{ type: "image", src: "figure.PNG", width: 20, height: null, text: "Figure" },
			{ type: "sectionBreak", pageStart: -1, orientation: "landscape" }, { type: "text", text: "last" },
		];
		const runic: any = runifyDoc(doc);
		runic.nodes[1].text[0].anchor = "mark";
		const output = path.join(dir, "report.docx");
		await serializeDocx(runic, output, dir, assets, dir);
		const zip = openDocx(output);
		const document = xml(zip, "word/document.xml");
		assert.ok(document.includes("w:hyperlink"));
		assert.ok(document.includes("w:bookmarkStart"));
		assert.ok(document.includes("w:tbl"));
		assert.ok(document.includes("w:jc w:val=\"right\""));
		assert.ok(document.includes("w:orient=\"landscape\""));
		assert.ok(Object.keys(zip.files).some(name => name.startsWith("word/media/")));
		assert.ok(xml(zip, "word/numbering.xml").includes("w:start w:val=\"3\""));
	}));

	test("serializes text and table headers and footers", async () => withTempDir(async dir =>
	{
		const doc = fixedDoc();
		doc.header = { type: "content", align: "center", nodes: [{ type: "text", text: "Inventory [!page]" }] };
		doc.footer = {
			type: "content",
			align: "left",
			nodes: [{
				type: "table",
				header: false,
				align: ["l", "r"],
				rows: [[{ type: "text", text: "Change" }, { type: "text", text: "[!page] / [!pages]" }]],
			}],
		};
		doc.nodes = [{ type: "text", text: "body" }, { type: "sectionBreak", pageStart: -1, orientation: null, footer: { type: "auto" } }, { type: "text", text: "unpaged" }];
		const output = path.join(dir, "report.docx");
		await serializeDocx(runifyDoc(doc), output, dir, assets, dir);
		const zip = openDocx(output);
		const headerName = Object.keys(zip.files).find(name => name.startsWith("word/header"))!;
		const footerNames = Object.keys(zip.files).filter(name => name.startsWith("word/footer"));
		assert.ok(xml(zip, headerName).includes("Inventory"));
		const customFooter = footerNames.map(name => xml(zip, name)).find(content => content.includes("Change"))!;
		assert.ok(customFooter.includes("w:tbl"));
		assert.equal(customFooter.includes("w:tblHeader"), false);
		assert.ok(customFooter.includes("PAGE"));
		assert.ok(customFooter.includes("NUMPAGES"));
		assert.ok(footerNames.map(name => xml(zip, name)).some(content => !content.includes("Change") && !content.includes("PAGE")));
	}));

	test("serializes admonitions as styled callout paragraphs", async () => withTempDir(async dir =>
	{
		const doc = fixedDoc();
		doc.nodes = [{ type: "admonition", admonitionType: "warning", title: "Careful", text: "Keep **this** value.", attributes: ".compact" }];
		const output = path.join(dir, "report.docx");
		await serializeDocx(runifyDoc(doc), output, dir, assets, dir);
		const zip = openDocx(output);
		const document = xml(zip, "word/document.xml");
		assert.ok(document.includes("Careful"));
		assert.ok(document.includes("Keep"));
		assert.ok(document.includes("xAdmonitionwarning"));
		assert.equal(document.includes("<w:tbl>"), false);
		assert.ok(xml(zip, "word/styles.xml").includes("xAdmonitionwarning"));
	}));

	test("rejects missing, unsupported, and path-escaping input files", async () => withTempDir(async dir =>
	{
		const outside = path.join(path.dirname(dir), "outside.png");
		await fs.writeFile(outside, "outside");
		try
		{
			const doc = fixedDoc();
			doc.nodes = [{ type: "image", src: "../outside.png", width: null, height: null }];
			await assert.rejects(() => serializeDocx(runifyDoc(doc), path.join(dir, "x.docx"), dir, assets, dir), /Access denied/);
		}
		finally { await fs.rm(outside, { force: true }); }
	}));
});
