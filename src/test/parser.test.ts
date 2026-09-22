import * as assert from "node:assert/strict";
import { parseMD, runifyDoc } from "../parser";
import { withTempDir, writeMarkdown } from "./helpers/fixtures";

suite("parser and runifier", () =>
{
	test("parses headings, paragraphs, code, images, lists, and tables", async () => withTempDir(async dir =>
	{
		const file = await writeMarkdown(dir, "# Heading\n\nfirst\nsecond\n\n```ts Sample\n\n  **literal**\n\n```\n\n![Caption](<img.png>){100x}\n\n- one\n    * nested\n- two\n\nTable caption\n| A | B |\n|:--|:-:|\n| a | b |");
		const doc = await parseMD(file);
		assert.equal(doc.title, "Report");
		assert.deepEqual(doc.nodes.slice(0, 3).map(n => n.type), ["title", "text", "code"]);
		assert.deepEqual(doc.nodes[0], { type: "title", text: "Heading", level: 1 });
		assert.equal((doc.nodes[1] as any).text, "first\nsecond");
		const code = doc.nodes.find(n => n.type == "code")! as any;
		assert.deepEqual(code, { type: "code", lang: "ts", title: "Sample", code: "\n  **literal**\n" });
		const image = doc.nodes.find(n => n.type == "image")! as any;
		assert.deepEqual(image, { type: "image", text: "Caption", src: "img.png", width: 100, height: null });
		const list = doc.nodes.find(n => n.type == "list")! as any;
		assert.equal(list.items[1].type, "list");
		const table = doc.nodes.find(n => n.type == "table")! as any;
		assert.equal(table.title, "Table caption");
		assert.deepEqual(table.align, ["l", "c"]);
	}));

	test("handles directives, external documents, sections, and warnings", async () => withTempDir(async dir =>
	{
		const warnings: string[] = [];
		const file = await writeMarkdown(dir, "!!rule title Custom\n!!rule text size nope\n!!rule unknown yes\n!!section landscape from 4\n!!(<appendix.docx>) {\"a\": {\"b\": 1,},}");
		const doc = await parseMD(file, w => warnings.push(w));
		assert.equal(doc.title, "Custom");
		assert.deepEqual(doc.nodes[0], { type: "sectionBreak", orientation: "landscape", pageStart: 4 });
		assert.deepEqual(doc.nodes[1], { type: "externalDoc", path: "appendix.docx", dict: { "a.b": "1" } });
		assert.equal(warnings.length, 2);
	}));

	test("parses admonitions with optional titles and attributes", async () => withTempDir(async dir =>
	{
		const file = await writeMarkdown(dir, "!!rule admonition all padding 4 2\n!!rule admonition warning indent 0.5\n!!rule admonition warning color #B26A00\n!!rule admonition warning icon size 20\n!!rule admonition warning title_color off\n:::note\nDefault title\n:::\n\n:::warning[Careful]{.compact #warning}\n\nCustom title\n\n:::\n!!rule admonition note title Заметка");
		const doc = await parseMD(file);
		assert.deepEqual(doc.admonition.note.padding, { top: 2, right: 4, bottom: 2, left: 4 });
		assert.equal(doc.admonition.warning.indent, 0.5);
		assert.equal(doc.admonition.warning.color, "B26A00");
		assert.equal(doc.admonition.warning.icon_size, 20);
		assert.equal(doc.admonition.warning.title_color, false);
		assert.deepEqual(doc.nodes[0], {
			type: "admonition",
			admonitionType: "note",
			title: "Заметка",
			text: "Default title",
			attributes: "",
		});
		assert.deepEqual(doc.nodes[1], {
			type: "admonition",
			admonitionType: "warning",
			title: "Careful",
			text: "Custom title",
			attributes: ".compact #warning",
		});
	}));

	test("turns inline formatting, links, refs, entities and line breaks into runes", () =>
	{
		const doc: any = { rainbow: false, nodes: [{ type: "text", text: "**bold** *italic* `mono` [site](https://example.test) [id+1] <br> A&nbsp;&amp;" }] };
		const runes = (runifyDoc(doc).nodes[0] as any).text;
		assert.ok(runes.some((r: any) => r.text == "bold" && r.bold));
		assert.ok(runes.some((r: any) => r.text == "italic" && r.italic));
		assert.ok(runes.some((r: any) => r.text == "mono" && r.mono));
		assert.ok(runes.some((r: any) => r.text == "site" && r.link == "https://example.test"));
		assert.ok(runes.some((r: any) => r.text == "id+1" && r.type == "ref"));
		assert.ok(runes.some((r: any) => r.linebreak));
		assert.ok(runes.some((r: any) => r.text.includes("\u00A0&amp;")));
	});
});
