import * as assert from "node:assert/strict";
import { Doc } from "../doc";
import { enrichDoc } from "../enricher";

suite("enricher", () =>
{
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
