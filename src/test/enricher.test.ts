import * as assert from "node:assert/strict";
import { Doc } from "../doc";
import { enrichDoc } from "../enricher";
import { parseMD, runifyDoc } from "../parser";
import { SPECIAL_HEADINGS } from "../sections";
import { withTempDir, writeMarkdown } from "./helpers/fixtures";

suite("enricher", () =>
{
	test("keeps escaped conventional section names as ordinary headings", async () => withTempDir(async dir =>
	{
		const names = [...SPECIAL_HEADINGS, "ТИТУЛЬНИК сохранён"];
		const input = await writeMarkdown(dir, names.map(name => `# \\${name}\n\nBody`).join("\n\n"));
		const doc = await parseMD(input);
		const warnings: string[] = [];
		enrichDoc(doc, message => warnings.push(message));
		assert.deepEqual(warnings, []);
		assert.equal(doc.nodes.length, names.length * 2);
		assert.deepEqual(doc.nodes.flatMap(node => node.type == "title" ? [[node.text, node.level, node.notSpecial, node.center]] : []), names.map(name => [name, 1, true, undefined]));
		assert.equal(doc.nodes.some(node => node.type == "tableOfContents" || node.type == "pageBreak" || node.tags?.includes("synopsis")), false);
	}));

	test("preserves literal slashes and retains normal TOC processing beside escaped headings", async () => withTempDir(async dir =>
	{
		const input = await writeMarkdown(dir, ["# СОДЕРЖАНИЕ", String.raw`# \РЕФЕРАТ`, String.raw`# \\РЕФЕРАТ`, String.raw`# \Обычный`, "## Нормальный"].join("\n\n"));
		const doc = await parseMD(input);
		enrichDoc(doc);
		assert.equal(doc.nodes.filter(node => node.type == "tableOfContents").length, 1);
		const titles = doc.nodes.filter(node => node.type == "title");
		assert.equal(titles[1]?.notSpecial, true);
		assert.equal(titles[2]?.notSpecial, undefined);
		assert.equal(titles[3]?.notSpecial, undefined);
		const runic = runifyDoc(doc);
		assert.deepEqual(runic.nodes.flatMap(node => node.type == "title" ? [node.text.map(r => r.text).join("")] : []), ["СОДЕРЖАНИЕ", "РЕФЕРАТ", String.raw`\РЕФЕРАТ`, String.raw`\Обычный`, "Нормальный"]);
	}));

	for (const heading of ["ЗАКЛЮЧЕНИЕ", "СПИСОК ЛИТЕРАТУРЫ", "ПРИЛОЖЕНИЯ"])
		test(`does not add a blank page after a section break before ${heading}`, () =>
		{
			const doc = new Doc();
			doc.nodes = [
				{ type: "text", sourceLine: 1, text: "body" },
				{ type: "sectionBreak", sourceLine: 2, orientation: "portrait", pageStart: null },
				{ type: "title", sourceLine: 3, text: heading, level: 1 },
				{ type: "text", sourceLine: 4, text: "content" },
			];
			enrichDoc(doc);
			assert.equal(doc.nodes[2].type, "title");
		});
	test("preserves explicit blank pages but coalesces added automatic breaks", () =>
	{
		const doc = new Doc();
		doc.nodes = [
			{ type: "text", sourceLine: 1, text: "body" },
			{ type: "sectionBreak", sourceLine: 2, orientation: "portrait", pageStart: null },
			{ type: "pageBreak", sourceLine: 3 },
			{ type: "title", sourceLine: 4, text: "ЗАКЛЮЧЕНИЕ", level: 1 },
		];
		enrichDoc(doc);
		assert.equal(doc.nodes.filter(n => n.type == "pageBreak").length, 1);
		assert.equal(doc.nodes[2].sourceLine, 3);
	});
	test("recognizes section aliases only at H1 and retains their names", () =>
	{
		const doc = new Doc();
		doc.nodes = [
			{ type: "title", sourceLine: 1, text: "Содержание", level: 1 },
			{ type: "title", sourceLine: 2, text: "Список литературы", level: 1 },
			{ type: "text", sourceLine: 3, text: "[book] Источник" },
			{ type: "title", sourceLine: 4, text: "Содержание", level: 2 },
			{ type: "title", sourceLine: 5, text: "Список литературы", level: 2 },
		];
		enrichDoc(doc);
		assert.equal(doc.nodes.filter(node => node.type == "tableOfContents").length, 1);
		assert.ok(doc.nodes.some(node => node.type == "title" && node.text == "СОДЕРЖАНИЕ"));
		assert.ok(doc.nodes.some(node => node.type == "title" && node.text == "СПИСОК ЛИТЕРАТУРЫ"));
		assert.ok(doc.nodes.some(node => node.type == "list" && node.tags?.includes("sources")));
		assert.equal(doc.nodes.filter(node => node.type == "title" && node.level == 2).length, 2);
	});
	test("expands conventional report sections", () =>
	{
		const doc = new Doc();
		doc.nodes = [
			{ type: "title", sourceLine: 1, text: "РЕФЕРАТ", level: 1 }, { type: "text", sourceLine: 1, text: "summary." },
			{ type: "title", sourceLine: 1, text: "ОГЛАВЛЕНИЕ", level: 1 },
			{ type: "title", sourceLine: 1, text: "ВВЕДЕНИЕ", level: 1 }, { type: "text", sourceLine: 1, text: "body" },
			{ type: "title", sourceLine: 1, text: "ЗАКЛЮЧЕНИЕ", level: 1 },
		];
		enrichDoc(doc);
		assert.equal((doc.nodes[0] as any).level, 0);
		assert.equal((doc.nodes[1] as any).tags?.[0], "synopsis");
		assert.equal((doc.nodes[2] as any).text, "SUMMARY");
		assert.ok(doc.nodes.some(n => n.type == "tableOfContents"));
		assert.equal((doc.nodes.find(n => n.type == "title" && n.text == "ВВЕДЕНИЕ") as any).center, true);
		assert.equal((doc.nodes.find(n => n.type == "title" && n.text == "ЗАКЛЮЧЕНИЕ") as any).center, true);
	});

	test("converts terms and abbreviations and reports malformed terms", () =>
	{
		const warnings: string[] = [];
		const doc = new Doc();
		doc.nodes = [
			{ type: "title", sourceLine: 1, text: "ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ", level: 1 },
			{ type: "list", sourceLine: 1, mark: "-", startIndex: 1, items: [{ type: "listItem", sourceLine: 1, text: "API: interface" }, { type: "listItem", sourceLine: 1, text: "broken" }] },
			{ type: "title", sourceLine: 1, text: "ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ", level: 1 },
			{ type: "list", sourceLine: 1, mark: "-", startIndex: 1, items: [{ type: "listItem", sourceLine: 1, text: "ГОСТ." }] },
		];
		enrichDoc(doc, w => warnings.push(w));
		const table = doc.nodes.find(n => n.type == "table") as any;
		assert.deepEqual(table.rows.map((r: any[]) => r.map(v => v.text)), [["Термин", "Определение"], ["API", "interface"]]);
		assert.equal(table.tags[0], "definitions_table");
		assert.ok(warnings.some(w => w.includes("ТЕРМИНЫ")));
		assert.ok(doc.nodes.some(n => n.type == "text" && (n as any).text == "ГОСТ"));
	});

	test("normalizes captions, lists, and external document page breaks", () =>
	{
		const doc = new Doc();
		doc.nodes = [
			{ type: "image", sourceLine: 1, src: "a.png", width: null, height: null, text: "Figure." },
			{ type: "table", sourceLine: 1, title: "Table!", align: ["l"], rows: [] },
			{ type: "code", sourceLine: 1, lang: "txt", title: "Code;", code: "x" },
			{ type: "list", sourceLine: 1, mark: "-", startIndex: 1, items: [{ type: "listItem", sourceLine: 1, text: "first" }, { type: "listItem", sourceLine: 1, text: "last" }] },
			{ type: "externalDoc", sourceLine: 1, path: "x.docx", dict: {} }, { type: "text", sourceLine: 1, text: "after" },
		];
		enrichDoc(doc);
		assert.deepEqual(doc.nodes.slice(0, 3).map((n: any) => n.text || n.title), ["Figure", "Table", "Code"]);
		assert.deepEqual((doc.nodes.find(n => n.type == "list") as any).items.map((i: any) => i.text), ["first,", "last."]);
		const external = doc.nodes.findIndex(n => n.type == "externalDoc");
		assert.equal(doc.nodes[external + 1].type, "pageBreak");
	});
});
