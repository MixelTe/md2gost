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
		assert.deepEqual(doc.nodes[0], { type: "title", text: "Heading", level: 1, sourceLine: 1 });
		assert.equal((doc.nodes[1] as any).text, "first\nsecond");
		const code = doc.nodes.find(n => n.type == "code")! as any;
		assert.deepEqual(code, { type: "code", lang: "ts", title: "Sample", code: "\n  **literal**\n", sourceLine: 6 });
		const image = doc.nodes.find(n => n.type == "image")! as any;
		assert.deepEqual(image, { type: "image", text: "Caption", src: "img.png", width: 100, height: null, sourceLine: 12 });
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
		assert.deepEqual(doc.nodes[0], { type: "sectionBreak", orientation: "landscape", pageStart: 4, sourceLine: 4 });
		assert.deepEqual(doc.nodes[1], { type: "externalDoc", path: "appendix.docx", dict: { "a.b": "1" }, sourceLine: 5 });
		assert.equal(warnings.length, 2);
		assert.ok(warnings.every(warning => warning.startsWith("Line ")));
	}));

	test("parses section-scoped headers and footers", async () => withTempDir(async dir =>
	{
		const file = await writeMarkdown(dir, "!!header align=center\nInventory [!page]\n!!endheader\n!!footer\n| Change | Date |\n|:--|--:|\n!!endfooter\n!!section landscape\n!!footer none\ntext\n!!section portrait\n!!footer auto");
		const doc = await parseMD(file);
		assert.deepEqual(doc.header, {
			type: "content", align: "center", nodes: [{ type: "text", text: "Inventory [!page]", sourceLine: 2 }],
		});
		assert.equal(doc.footer.type, "content");
		if (doc.footer.type == "content")
		{
			assert.equal(doc.footer.nodes[0]?.type, "table");
			assert.equal((doc.footer.nodes[0] as any).header, false);
		}
		const sections = doc.nodes.filter(node => node.type == "sectionBreak");
		assert.equal(sections[0]?.type == "sectionBreak" && sections[0].footer?.type, "none");
		assert.equal(sections[1]?.type == "sectionBreak" && sections[1].footer?.type, "auto");
	}));

	test("parses admonitions with optional titles and attributes", async () => withTempDir(async dir =>
	{
		const file = await writeMarkdown(dir, "!!rule admonition all padding 4 2\n!!rule admonition warning indent 0.5\n!!rule admonition warning color #B26A00\n!!rule admonition warning icon size 20\n!!rule admonition warning title_color off\n:::note\nDefault title\n:::\n\n:::warning[Careful]{.compact #warning}\n\nCustom title\n\n:::\n!!rule admonition note title Заметка");
		const doc = await parseMD(file);
		assert.deepEqual(doc.admonition.note.padding, { top: 2, right: 4, bottom: 2, left: 4 });
		assert.equal(doc.admonition.warning.indent, 0.5);
		assert.equal(doc.admonition.warning.color, "b26a00");
		assert.equal(doc.admonition.warning.icon_size, 20);
		assert.equal(doc.admonition.warning.title_color, false);
		assert.deepEqual(doc.nodes[0], {
			type: "admonition",
			admonitionType: "note",
			title: "Заметка",
			text: "Default title",
			attributes: "",
			sourceLine: 6,
		});
		assert.deepEqual(doc.nodes[1], {
			type: "admonition",
			admonitionType: "warning",
			title: "Careful",
			text: "Custom title",
			attributes: ".compact #warning",
			sourceLine: 10,
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
		assert.ok(runes.some((r: any) => r.text.includes("\u00A0&")));
	});

	test("recognizes display formulas and preserves inline formulas outside code", async () => withTempDir(async dir =>
	{
		const warnings: string[] = [];
		const file = await writeMarkdown(dir, "[energy]\n$$\nE = mc^2\n$$\n\nA $x_i$ and \\$ with `$code$`.\n\n```\n$literal$\n```\n\n$$\nunclosed");
		const doc = await parseMD(file, warning => warnings.push(warning));
		assert.deepEqual(doc.nodes.find(node => node.type == "math"), { type: "math", latex: "E = mc^2", title: "([energy])", sourceLine: 2 });
		const runic = runifyDoc(doc);
		const text = runic.nodes.find(node => node.type == "text") as any;
		assert.ok(text.text.some((r: any) => r.type == "math" && r.text == "x_i"));
		assert.ok(text.text.some((r: any) => r.mono && r.text == "$code$"));
		assert.ok(text.text.some((r: any) => r.text.includes("$")));
		assert.equal((runic.nodes.find(node => node.type == "code") as any).code, "$literal$");
		assert.ok(warnings.some(warning => warning.startsWith("Line ") && warning.includes("not closed")));
	}));

	test("parses a manual formula number without creating an id", async () => withTempDir(async dir =>
	{
		const formula = (await parseMD(await writeMarkdown(dir, "(А.1)\n$$\nE = mc^2\n$$"))).nodes[0] as any;
		assert.equal(formula.type, "math");
		assert.equal(formula.title, "(А.1)");
	}));

	test("applies formula spacing rules", async () => withTempDir(async dir =>
	{
		const doc = await parseMD(await writeMarkdown(dir, "!!rule formula spacing before 6\n!!rule formula spacing after 4"));
		assert.deepEqual(doc.formula.spacing, { before: 6, after: 4 });
	}));
});
