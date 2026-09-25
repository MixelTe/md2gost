import * as assert from "node:assert/strict";
import { alchemist } from "../alchemist";
import { Doc } from "../doc";
import { runifyDoc } from "../parser";

function text(node: any) { return (node.text || node.title).map((r: any) => r.text).join(""); }

suite("alchemist", () =>
{
	test("numbers objects by section and resolves forward and arithmetic references", () =>
	{
		const doc = new Doc();
		doc.numberingSections = true;
		doc.nodes = [
			{ type: "title", sourceLine: 1, level: 1, text: "First" },
			{ type: "text", sourceLine: 1, text: "see [fig+1] and [#]" },
			{ type: "image", sourceLine: 1, src: "x", width: null, height: null, text: "Рисунок [fig] – first" },
			{ type: "image", sourceLine: 1, src: "x", width: null, height: null, text: "Рисунок [next] – second" },
			{ type: "title", sourceLine: 1, level: 1, text: "Second" },
			{ type: "table", sourceLine: 1, align: ["l"], rows: [], title: "Таблица [table] – data" },
		];
		const runic = runifyDoc(doc);
		alchemist(runic);
		assert.equal(text(runic.nodes[1]), "see 1.2 and 1.1");
		assert.equal(text((runic.nodes[2] as any)), "Рисунок 1.1 – First");
		assert.equal(text((runic.nodes[3] as any)), "Рисунок 1.2 – Second");
		assert.equal(text((runic.nodes[5] as any)), "Таблица 2.1 – Data");
	});

	test("fills shared synopsis counters and excludes definitions tables", () =>
	{
		const doc = new Doc();
		doc.nodes = [
			{ type: "text", sourceLine: 1, tags: ["synopsis"], text: "ignored" },
			{ type: "table", sourceLine: 1, tags: ["definitions_table"], align: ["l"], rows: [] },
			{ type: "table", sourceLine: 1, align: ["l"], rows: [], title: "[t]" },
			{ type: "image", sourceLine: 1, src: "x", width: null, height: null, text: "[i]" },
		];
		const runic = runifyDoc(doc);
		alchemist(runic);
		assert.equal(text(runic.nodes[0]), "Отчет pages с., 1 рис., 1 табл.");
	});

	test("warns for unknown references and materializes lazy numbers", () =>
	{
		const warnings: string[] = [];
		const doc = new Doc();
		doc.numberingLazy = true;
		doc.nodes = [{ type: "text", sourceLine: 1, text: "[unknown]" }, { type: "image", sourceLine: 1, src: "x", width: null, height: null, text: "caption" }];
		const runic = runifyDoc(doc);
		alchemist(runic, w => warnings.push(w));
		assert.equal(text(runic.nodes[1]), "Рисунок 1 – Caption");
		assert.ok(warnings.some(w => w.includes("unknown")));
	});
});
