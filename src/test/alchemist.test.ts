import * as assert from "node:assert/strict";
import { alchemist } from "../alchemist";
import { Doc } from "../doc";
import { runifyDoc } from "../parser";

function text(node: any) { return (node.text || node.title).map((r: any) => r.text).join(""); }
const NBSP = "\u00A0";

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
		assert.equal(text(runic.nodes[1]), `see${NBSP}1.2 and${NBSP}1.1`);
		assert.equal(text((runic.nodes[2] as any)), "Рисунок 1.1 – First");
		assert.equal(text((runic.nodes[3] as any)), "Рисунок 1.2 – Second");
		assert.equal(text((runic.nodes[5] as any)), "Таблица 2.1 – Data");
	});

	test("uses explicit section numbers at every heading level and accepts trailing dots", () =>
	{
		for (let level = 1; level <= 6; level++)
			for (const dot of ["", "."])
				for (const number of [`3${dot}`, `**3${dot}**`, `**3**${dot}`])
				{
					const doc = new Doc();
					doc.numberingSections = true;
					doc.numberingLazy = true;
					doc.nodes = [
						{ type: "title", sourceLine: 1, level: 1, text: "ХОД РАБОТЫ" },
						{ type: "text", sourceLine: 2, text: "[#], [i#]" },
						{ type: "title", sourceLine: 3, level, text: `${number} First` },
						{ type: "image", sourceLine: 4, src: "x", width: null, height: null, text: "first" },
						{ type: "title", sourceLine: 5, level: Math.min(level + 1, 6), text: `**3**.1${dot} Subsection` },
						{ type: "title", sourceLine: 6, level: 1, text: "Дополнительные сведения" },
						{ type: "title", sourceLine: 7, level, text: "1С Configuration" },
						{ type: "image", sourceLine: 8, src: "x", width: null, height: null, text: "second" },
						{ type: "text", sourceLine: 9, text: "[#], [i#], [i#-1], [#-1]" },
						{ type: "title", sourceLine: 10, level, text: `7${dot} Second` },
						{ type: "image", sourceLine: 11, src: "x", width: null, height: null, text: "third" },
					];
					const warnings: string[] = [];
					const runic = runifyDoc(doc);
					alchemist(runic, warning => warnings.push(warning));
					assert.deepEqual(runic.nodes.filter(node => node.type == "image").map(text), [
						"Рисунок 3.1 – First", "Рисунок 3.2 – Second", "Рисунок 7.1 – Third",
					]);
					assert.equal(text(runic.nodes[1]), `3.1,${NBSP}3.1`);
					assert.equal(text(runic.nodes[8]), `7.1,${NBSP}7.1,${NBSP}3.2,${NBSP}3.2`);
					assert.deepEqual(warnings, []);
				}
	});

	test("applies the section prefix to every object type and preserves continuous numbering when disabled", () =>
	{
		for (const sections of [false, true])
		{
			const doc = new Doc();
			doc.numberingSections = sections;
			const objects = (id: string): Doc["nodes"] => [
				{ type: "image", sourceLine: 1, src: "x", width: null, height: null, text: `[image_${id}] Figure` },
				{ type: "table", sourceLine: 1, align: ["l"], rows: [], title: `[table_${id}] Data` },
				{ type: "code", sourceLine: 1, lang: "text", code: "Code", title: `[code_${id}] Code` },
				{ type: "math", sourceLine: 1, latex: "x = 1", title: `([formula_${id}])` },
			];
			doc.nodes = [
				{ type: "title", sourceLine: 1, level: 1, text: "ХОД РАБОТЫ" },
				{ type: "text", sourceLine: 2, text: "[image_last], [table_last], [code_last], [formula_last]" },
				{ type: "title", sourceLine: 3, level: 2, text: "3. First" },
				...objects("first"),
				{ type: "title", sourceLine: 4, level: 3, text: "3.1. Subsection" },
				...objects("subsection"),
				{ type: "title", sourceLine: 5, level: 2, text: "7. Second" },
				...objects("last"),
				{ type: "text", sourceLine: 6, text: "[image_first], [table_subsection], [c#-1], [f#-1]" },
			];
			const warnings: string[] = [];
			const runic = runifyDoc(doc);
			alchemist(runic, warning => warnings.push(warning));
			const captions = runic.nodes.filter(node => node.type == "image" || node.type == "table" || node.type == "code" || node.type == "math").map(text);
			const expected = (num: string) => [`Рисунок ${num} – Figure`, `Таблица ${num} – Data`, `Листинг ${num} – Code`, `(${num})`];
			assert.deepEqual(captions, [...expected(sections ? "3.1" : "1"), ...expected(sections ? "3.2" : "2"), ...expected(sections ? "7.1" : "3")]);
			assert.equal(text(runic.nodes[1]), Array(4).fill(sections ? "7.1" : "3").join("," + NBSP));
			assert.equal(text(runic.nodes.at(-1)), (sections ? ["3.1", "3.2", "7.1", "7.1"] : ["1", "2", "3", "3"]).join("," + NBSP));
			assert.deepEqual(warnings, []);
		}
	});

	test("keeps typed references at the start of a heading from becoming section declarations", () =>
	{
		const doc = new Doc();
		doc.numberingSections = true;
		doc.nodes = [
			{ type: "title", sourceLine: 1, level: 1, text: "ХОД РАБОТЫ" },
			{ type: "title", sourceLine: 2, level: 2, text: "3. First" },
			{ type: "image", sourceLine: 3, src: "x", width: null, height: null, text: "[#] First" },
			{ type: "title", sourceLine: 4, level: 1, text: "[i# - 1] Previous figure" },
			{ type: "image", sourceLine: 5, src: "x", width: null, height: null, text: "[#] Second" },
		];
		const runic = runifyDoc(doc);
		alchemist(runic);
		assert.equal(text(runic.nodes[3]), `3.1 Previous figure`);
		assert.equal(text(runic.nodes[4]), "Рисунок 3.2 – Second");
	});

	test("preserves implicit sections and heading counters across special headings", () =>
	{
		const doc = new Doc();
		doc.numberingSections = true;
		doc.nodes = [
			{ type: "title", sourceLine: 1, level: 1, text: "First" },
			{ type: "image", sourceLine: 2, src: "x", width: null, height: null, text: "[#] First" },
			{ type: "title", sourceLine: 3, level: 0, text: "СОДЕРЖАНИЕ" },
			{ type: "text", sourceLine: 4, text: "[#], [i#]" },
			{ type: "title", sourceLine: 5, level: 1, text: "[#] Next" },
			{ type: "image", sourceLine: 6, src: "x", width: null, height: null, text: "[#] Second" },
		];
		const runic = runifyDoc(doc);
		alchemist(runic);
		assert.equal(text(runic.nodes[3]), `1.1,${NBSP}1.1`);
		assert.equal(text(runic.nodes[4]), "1 Next");
		assert.equal(text(runic.nodes[5]), "Рисунок 1.1 – Second");
	});

	test("resolves untyped references across appendix boundaries with and without section numbering", () =>
	{
		for (const sections of [false, true])
		{
			const doc = new Doc();
			doc.numberingSections = sections;
			doc.nodes = [
				{ type: "title", sourceLine: 1, level: 1, text: "First" },
				{ type: "image", sourceLine: 2, src: "x", width: null, height: null, text: "[#] First" },
				{ type: "title", sourceLine: 3, level: 1, text: "Second" },
				{ type: "image", sourceLine: 4, src: "x", width: null, height: null, text: "[#] Second" },
				{ type: "text", sourceLine: 5, text: "[#], [i#], [#-1]" },
				{ type: "title", sourceLine: 6, level: 0, text: "ПРИЛОЖЕНИЯ" },
				{ type: "title", sourceLine: 7, level: 1, text: "[app] Code" },
				{ type: "title", sourceLine: 8, level: 2, text: "5. Content" },
				{ type: "image", sourceLine: 9, src: "x", width: null, height: null, text: "[#] Appendix" },
				{ type: "text", sourceLine: 10, text: "[#], [i#], [#-1], [i#-1]" },
				{ type: "title", sourceLine: 11, level: 1, text: "[app_b] Code" },
				{ type: "image", sourceLine: 12, src: "x", width: null, height: null, text: "[#] Appendix" },
			];
			const runic = runifyDoc(doc);
			alchemist(runic);
			assert.equal(text(runic.nodes[3]), `Рисунок ${sections ? "2.1" : "2"} – Second`);
			assert.equal(text(runic.nodes[4]), `А.1,${NBSP}А.1,${NBSP}${sections ? "2.1" : "2"}`);
			assert.equal(text(runic.nodes[9]), `Б.1,${NBSP}Б.1,${NBSP}А.1,${NBSP}А.1`);
			assert.equal(text(runic.nodes[11]), "Рисунок Б.1 – Appendix");
		}
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

	test("numbers only the first nonempty heading rune and preserves later named references", () =>
	{
		for (const marker of ["[chapter]", "**[chapter]**", "  [chapter]"])
		{
			const doc = new Doc();
			doc.nodes = [
				{ type: "title", sourceLine: 1, level: 1, text: "[root] Root" },
				{ type: "image", sourceLine: 2, src: "x", width: null, height: null, text: "[cat] Cat" },
				{ type: "title", sourceLine: 3, level: 2, text: `${marker} Compare [cat] and [root]` },
				{ type: "text", sourceLine: 4, text: "[cat], [root], [chapter]" },
			];
			const warnings: string[] = [];
			const runic = runifyDoc(doc);
			alchemist(runic, warning => warnings.push(warning));
			assert.equal(text(runic.nodes[2]).trim(), `1.1 Compare${NBSP}1 and${NBSP}1`);
			assert.equal(text(runic.nodes[3]), `1,${NBSP}1,${NBSP}1.1`);
			assert.deepEqual(warnings, []);
		}
	});

	test("retains manual heading numbers while resolving forward references in their text", () =>
	{
		for (const number of ["3", "**3**"])
		{
			const doc = new Doc();
			doc.numberingSections = true;
			doc.nodes = [
				{ type: "title", sourceLine: 1, level: 1, text: `${number} Compare [cat]` },
				{ type: "image", sourceLine: 2, src: "x", width: null, height: null, text: "[cat] Cat" },
				{ type: "title", sourceLine: 3, level: 1, text: "[#] Next" },
				{ type: "text", sourceLine: 4, text: "[cat]" },
			];
			const warnings: string[] = [];
			const runic = runifyDoc(doc);
			alchemist(runic, warning => warnings.push(warning));
			assert.equal(text(runic.nodes[0]), `3 Compare${NBSP}3.1`);
			assert.equal(text(runic.nodes[1]), "Рисунок 3.1 – Cat");
			assert.equal(text(runic.nodes[2]), "4 Next");
			assert.equal(text(runic.nodes[3]), "3.1");
			assert.deepEqual(warnings, []);
		}
	});

	test("treats a numeric leading identifier as a numbering marker rather than a manual number", () =>
	{
		const doc = new Doc();
		doc.nodes = [
			{ type: "title", sourceLine: 1, level: 1, text: "[123] First" },
			{ type: "text", sourceLine: 2, text: "[123]" },
			{ type: "title", sourceLine: 3, level: 1, text: "[#] Next" },
		];
		const runic = runifyDoc(doc);
		alchemist(runic);
		assert.equal(text(runic.nodes[0]), "1 First");
		assert.equal(text(runic.nodes[1]), "1");
		assert.equal(text(runic.nodes[2]), "2 Next");
	});

	test("resolves later hash references in a heading against document objects", () =>
	{
		const doc = new Doc();
		doc.nodes = [
			{ type: "title", sourceLine: 1, level: 1, text: "3 Start" },
			{ type: "title", sourceLine: 2, level: 2, text: "[#] Figures [#] and [#+1]" },
			{ type: "image", sourceLine: 3, src: "x", width: null, height: null, text: "[cat] Cat" },
			{ type: "image", sourceLine: 4, src: "x", width: null, height: null, text: "[dog] Dog" },
		];
		const runic = runifyDoc(doc);
		alchemist(runic);
		assert.equal(text(runic.nodes[1]), `3.1 Figures${NBSP}1 and${NBSP}2`);
	});

	test("does not declare identifiers for references following heading text", () =>
	{
		const doc = new Doc();
		doc.nodes = [
			{ type: "title", sourceLine: 7, level: 1, text: "[section] About [missing]" },
			{ type: "text", sourceLine: 8, text: "[section]" },
		];
		const warnings: string[] = [];
		const runic = runifyDoc(doc);
		alchemist(runic, warning => warnings.push(warning));
		assert.equal(text(runic.nodes[1]), "1");
		assert.deepEqual(warnings, ["Line 7: Неизвестная ссылка [missing]"]);
	});

	test("numbers sixth-level headings and resolves their identifiers", () =>
	{
		const doc = new Doc();
		for (let level = 1; level <= 6; level++)
			doc.nodes.push({ type: "title", sourceLine: level, level, text: `[heading${level}] Level ${level}` });
		doc.appendText("[heading6]", 7);
		const runic = runifyDoc(doc);
		alchemist(runic);
		assert.equal(text(runic.nodes[5]), "1.1.1.1.1.1 Level 6");
		assert.equal(text(runic.nodes[6]), "1.1.1.1.1.1");
	});

	test("resolves typed forward references and offsets independently of intervening object types", () =>
	{
		const doc = new Doc();
		doc.nodes = [
			{ type: "image", sourceLine: 1, src: "x", width: null, height: null, text: "[#] first" },
			{ type: "image", sourceLine: 2, src: "x", width: null, height: null, text: "[#] second" },
			{ type: "table", sourceLine: 3, align: ["l"], rows: [], title: "[#] first" },
			{ type: "code", sourceLine: 4, lang: "ts", code: "", title: "[#] first" },
			{ type: "code", sourceLine: 5, lang: "ts", code: "", title: "[#] second" },
			{ type: "code", sourceLine: 6, lang: "ts", code: "", title: "[#] third" },
			{ type: "text", sourceLine: 7, text: "[i#], [t#], [c#], [f#], [#]; [i# + 2], [t#+1], [c# - 1]" },
			{ type: "table", sourceLine: 8, align: ["l"], rows: [], title: "[#] second" },
			{ type: "math", sourceLine: 9, latex: "x = 1", title: "([#])" },
			{ type: "code", sourceLine: 10, lang: "ts", code: "", title: "[#] fourth" },
			{ type: "image", sourceLine: 11, src: "x", width: null, height: null, text: "[#] third" },
		];
		const warnings: string[] = [];
		const runic = runifyDoc(doc);
		alchemist(runic, warning => warnings.push(warning));
		assert.equal(text(runic.nodes[6]), `3,${NBSP}2,${NBSP}4,${NBSP}1,${NBSP}2;${NBSP}5,${NBSP}3,${NBSP}3`);
		assert.deepEqual(warnings, []);
	});

	test("resolves typed backward references after the last object of every type", () =>
	{
		const doc = new Doc();
		doc.nodes = [
			{ type: "image", sourceLine: 1, src: "x", width: null, height: null, text: "[#] first" },
			{ type: "code", sourceLine: 2, lang: "ts", code: "", title: "[#] code" },
			{ type: "table", sourceLine: 3, align: ["l"], rows: [], title: "[#] table" },
			{ type: "math", sourceLine: 4, latex: "x = 1", title: "([#])" },
			{ type: "image", sourceLine: 5, src: "x", width: null, height: null, text: "[#] second" },
			{ type: "text", sourceLine: 6, text: "[i#-1], [t# - 1], [c#-1], [f# - 1], [i#-2]" },
		];
		const warnings: string[] = [];
		const runic = runifyDoc(doc);
		alchemist(runic, warning => warnings.push(warning));
		assert.equal(text(runic.nodes[5]), `2,${NBSP}1,${NBSP}1,${NBSP}1,${NBSP}1`);
		assert.deepEqual(warnings, []);
	});

	test("uses the referenced object's section and appendix prefix across boundaries", () =>
	{
		for (const sections of [false, true])
		{
			const doc = new Doc();
			doc.numberingSections = sections;
			doc.nodes = [
				{ type: "title", sourceLine: 1, level: 1, text: "3 First [i#]" },
				{ type: "image", sourceLine: 2, src: "x", width: null, height: null, text: "[#] first" },
				{ type: "text", sourceLine: 3, text: "[i#], [i#-1], [i#+2]" },
				{ type: "title", sourceLine: 4, level: 1, text: "[#] Second" },
				{ type: "image", sourceLine: 5, src: "x", width: null, height: null, text: "[#] second" },
				{ type: "title", sourceLine: 6, level: 0, text: "ПРИЛОЖЕНИЯ" },
				{ type: "text", sourceLine: 7, text: "[i#], [i#-1]" },
				{ type: "title", sourceLine: 8, level: 1, text: "[appendix_a] First appendix" },
				{ type: "image", sourceLine: 9, src: "x", width: null, height: null, text: "[#] appendix image" },
				{ type: "title", sourceLine: 10, level: 1, text: "[appendix_b] Second appendix" },
				{ type: "text", sourceLine: 11, text: "[i#], [i#-1]" },
				{ type: "image", sourceLine: 12, src: "x", width: null, height: null, text: "[#] appendix image" },
			];
			const warnings: string[] = [];
			const runic = runifyDoc(doc);
			alchemist(runic, warning => warnings.push(warning));
			assert.equal(text(runic.nodes[0]), `3 First${NBSP}${sections ? "3.1" : "1"}`);
			assert.equal(text(runic.nodes[2]), sections ? `4.1,${NBSP}3.1,${NBSP}4.3` : `2,${NBSP}1,${NBSP}4`);
			assert.equal(text(runic.nodes[6]), `А.1,${NBSP}${sections ? "4.1" : "2"}`);
			assert.equal(text(runic.nodes[10]), `Б.1,${NBSP}А.1`);
			assert.deepEqual(warnings, []);
		}
	});

	test("skips definitions tables and resolves references in lists and table cells", () =>
	{
		const doc = new Doc();
		doc.nodes = [
			{ type: "list", sourceLine: 1, mark: "-", startIndex: 1, items: [{ type: "listItem", sourceLine: 1, text: "[t#]" }] },
			{ type: "table", sourceLine: 2, tags: ["definitions_table"], align: ["l"], rows: [] },
			{ type: "table", sourceLine: 3, align: ["l"], rows: [[{ type: "text", sourceLine: 4, text: "[i#]" }]], title: "[#] table" },
			{ type: "image", sourceLine: 5, src: "x", width: null, height: null, text: "[#] image" },
		];
		const runic = runifyDoc(doc);
		alchemist(runic);
		const list = runic.nodes[0];
		const table = runic.nodes[2];
		assert.ok(list.type == "list" && list.items[0]?.type == "listItem");
		assert.ok(table.type == "table");
		assert.equal(text(list.items[0]), "1");
		assert.equal(text(table.rows[0]![0]), "1");
	});

	test("keeps typed references distinct from numbering declarations in lazy captions", () =>
	{
		const doc = new Doc();
		doc.numberingLazy = true;
		doc.nodes = [
			{ type: "image", sourceLine: 1, src: "x", width: null, height: null, text: "example from [c#]" },
			{ type: "code", sourceLine: 2, lang: "ts", code: "", title: "example for [i#-1]" },
		];
		const warnings: string[] = [];
		const runic = runifyDoc(doc);
		alchemist(runic, warning => warnings.push(warning));
		assert.equal(text(runic.nodes[0]), `Рисунок 1 – Example from${NBSP}1`);
		assert.equal(text(runic.nodes[1]), `Листинг 1 – Example for${NBSP}1`);
		assert.deepEqual(warnings, []);
	});

	test("capitalizes lazy formatted captions while preserving their inline styles", () =>
	{
		const doc = new Doc();
		doc.numberingLazy = true;
		doc.nodes = [
			{ type: "image", sourceLine: 1, src: "x", width: null, height: null, text: "**кот**" },
			{ type: "code", sourceLine: 2, lang: "ts", code: "", title: "*пример*" },
			{ type: "table", sourceLine: 3, align: ["l"], rows: [], title: "**данные**" },
		];
		const runic = runifyDoc(doc);
		alchemist(runic);
		assert.equal(text(runic.nodes[0]), "Рисунок 1 – Кот");
		assert.equal(text(runic.nodes[1]), "Листинг 1 – Пример");
		assert.equal(text(runic.nodes[2]), "Таблица 1 – Данные");
		const image = runic.nodes[0];
		const code = runic.nodes[1];
		const table = runic.nodes[2];
		assert.ok(image.type == "image" && image.text?.some(rune => rune.text == "Кот" && rune.bold));
		assert.ok(code.type == "code" && code.title?.some(rune => rune.text == "Пример" && rune.italic));
		assert.ok(table.type == "table" && table.title?.some(rune => rune.text == "Данные" && rune.bold));
	});

	test("omits the caption separator when only a numbering marker remains", () =>
	{
		for (const lazy of [false, true])
			for (const caption of ["[id]", "[#]", " [id] \t ", "**[id]**", "[id]<br>", "%prefix% [id]", "[id] - ", "[id] **–**"])
			{
				const doc = new Doc();
				doc.numberingLazy = lazy;
				doc.numberingSections = true;
				const title = (name: string, prefix: string) => caption.replaceAll("id", name).replace("%prefix%", prefix);
				doc.nodes = [
					{ type: "title", sourceLine: 1, level: 1, text: "3 Examples" },
					...(caption.includes("[id]") ? [{ type: "text" as const, sourceLine: 2, text: "[figure], [data], [listing]" }] : []),
					{ type: "image", sourceLine: 3, src: "x", width: null, height: null, text: title("figure", "Рисунок") },
					{ type: "table", sourceLine: 4, align: ["l"], rows: [], title: title("data", "Таблица") },
					{ type: "code", sourceLine: 5, lang: "text", code: "Output", title: title("listing", "Листинг") },
					...(caption.includes("[id]") ? [{ type: "text" as const, sourceLine: 6, text: "[figure], [data], [listing]" }] : []),
				];
				const runic = runifyDoc(doc);
				const warnings: string[] = [];
				alchemist(runic, warning => warnings.push(warning));
				const captions = runic.nodes.filter(node => node.type == "image" || node.type == "table" || node.type == "code");
				assert.deepEqual(captions.map(node => text(node).trim()), ["Рисунок 3.1", "Таблица 3.1", "Листинг 3.1"], caption);
				for (const reference of runic.nodes.filter(node => node.type == "text"))
					assert.equal(text(reference).replaceAll(NBSP, " "), "3.1, 3.1, 3.1");
				assert.deepEqual(warnings, []);
			}
	});

	test("cleans caption spacing and separators across formatting boundaries", () =>
	{
		for (const caption of ["**[cat]** Кот", "**[cat]** *–* **кот**", "Рисунок [cat] – **кот**"])
		{
			const doc = new Doc();
			doc.nodes = [{ type: "image", sourceLine: 1, src: "x", width: null, height: null, text: caption }];
			const runic = runifyDoc(doc);
			alchemist(runic);
			assert.equal(text(runic.nodes[0]), "Рисунок 1 – Кот");
		}
	});

	test("preserves code, math, references and values at the start of a caption", () =>
	{
		const doc = new Doc();
		doc.numberingLazy = true;
		doc.nodes = [
			{ type: "image", sourceLine: 1, src: "x", width: null, height: null, text: "`myVar`" },
			{ type: "image", sourceLine: 2, src: "x", width: null, height: null, text: "$x_i$" },
			{ type: "image", sourceLine: 3, src: "x", width: null, height: null, text: "[c#] подпись" },
			{ type: "image", sourceLine: 4, src: "x", width: null, height: null, text: "[!codes] подпись" },
			{ type: "code", sourceLine: 5, lang: "ts", code: "", title: "[code] Code" },
		];
		const warnings: string[] = [];
		const runic = runifyDoc(doc);
		alchemist(runic, warning => warnings.push(warning));
		assert.equal(text(runic.nodes[0]), "Рисунок 1 – myVar");
		assert.equal(text(runic.nodes[1]), "Рисунок 2 – x_i");
		assert.equal(text(runic.nodes[2]), "Рисунок 3 – 1 подпись");
		assert.equal(text(runic.nodes[3]), "Рисунок 4 – 1 подпись");
		const code = runic.nodes[0];
		const math = runic.nodes[1];
		assert.ok(code.type == "image" && code.text?.some(rune => rune.text == "myVar" && rune.mono));
		assert.ok(math.type == "image" && math.text?.some(rune => rune.text == "x_i" && rune.type == "math"));
		assert.deepEqual(warnings, []);
	});

	test("preserves legacy caption marker positions with automatic prefixes disabled", () =>
	{
		const doc = new Doc();
		doc.numberingLazy = true;
		doc.numberingAutoprefix = false;
		doc.nodes = [
			{ type: "image", sourceLine: 1, src: "x", width: null, height: null, text: "Рисуночек [cat]: **кот**" },
			{ type: "text", sourceLine: 2, text: "[cat]" },
		];
		const runic = runifyDoc(doc);
		alchemist(runic);
		assert.equal(text(runic.nodes[0]), `Рисуночек${NBSP}1: кот`);
		assert.equal(text(runic.nodes[1]), "1");
	});

	test("leaves empty and whitespace-only captions unnumbered", () =>
	{
		for (const caption of ["", " \t ", "\u00a0", "<br>", "<br> <br>"])
		{
			const doc = new Doc();
			doc.numberingLazy = true;
			doc.nodes = [
				{ type: "table", sourceLine: 1, title: caption, align: ["l"], rows: [] },
				{ type: "code", sourceLine: 2, title: caption, lang: "text", code: "Output" },
				{ type: "image", sourceLine: 3, text: caption, src: "x", width: null, height: null },
			];
			const runic = runifyDoc(doc);
			const warnings: string[] = [];
			alchemist(runic, warning => warnings.push(warning));
			for (const node of runic.nodes)
			{
				const runes = node.type == "image" ? node.text : node.type == "table" || node.type == "code" ? node.title : undefined;
				assert.ok(runes?.every(rune => !rune.text.trim()), caption);
			}
			assert.deepEqual(warnings, []);
		}
	});

	test("warns with source lines when a typed reference has no base object", () =>
	{
		const doc = new Doc();
		doc.nodes = [
			{ type: "text", sourceLine: 12, text: "[i#] [t#-1] [c#+2] [f#-1]" },
		];
		const warnings: string[] = [];
		alchemist(runifyDoc(doc), warning => warnings.push(warning));
		assert.equal(warnings.length, 4);
		for (const reference of ["i#", "t#-1", "c#+2", "f#-1"])
			assert.ok(warnings.includes(`Line 12: Неизвестная ссылка [${reference}]`));
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
