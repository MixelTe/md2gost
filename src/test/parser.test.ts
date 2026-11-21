import * as assert from "node:assert/strict";
import { parseMD, runifyDoc } from "../parser";
import { withTempDir, writeMarkdown } from "./helpers/fixtures";

suite("parser and runifier", () =>
{
	test("removes comments while retaining surrounding text and source lines", async () => withTempDir(async dir =>
	{
		const file = await writeMarkdown(dir, [
			"FIRST<!-- hidden -->SECOND", "", "<!-- hidden -->THIRD", "",
			"FOURTH<!--", "HIDDEN", "-->FIFTH", "", "SIXTH",
		].join("\n"));
		const warnings: string[] = [];
		const doc = await parseMD(file, undefined, {}, false, null, warning => warnings.push(warning));
		assert.deepEqual(doc.nodes.map(node => node.type == "text" && [node.text, node.sourceLine]), [
			["FIRSTSECOND", 1], ["THIRD", 3], ["FOURTH\nFIFTH", 5], ["SIXTH", 9],
		]);
		assert.deepEqual(warnings, []);
	}));

	test("removes standalone comments inside headers, footers and admonitions", async () => withTempDir(async dir =>
	{
		const file = await writeMarkdown(dir, [
			"!!header", "HEADER", "<!-- hidden -->", "SECOND", "!!endheader",
			"!!footer", "FOOTER", "<!-- hidden -->", "SECOND", "!!endfooter",
			":::note", "BODY", "<!-- hidden -->", "SECOND", ":::",
		].join("\n"));
		const doc = await parseMD(file);
		assert.ok(doc.header.type == "content" && doc.header.nodes[0]?.type == "text");
		assert.equal(doc.header.nodes[0].text, "HEADER\nSECOND");
		assert.ok(doc.footer.type == "content" && doc.footer.nodes[0]?.type == "text");
		assert.equal(doc.footer.nodes[0].text, "FOOTER\nSECOND");
		assert.ok(doc.nodes[0]?.type == "admonition");
		assert.equal(doc.nodes[0].text, "BODY\nSECOND");
	}));

	test("keeps comment markers literal in code, formulas, escapes and link destinations", async () => withTempDir(async dir =>
	{
		const file = await writeMarkdown(dir, [
			"<!-- note -->```html Example", "<!-- literal -->AFTER", 'const ticks = "```"; <!-- kept -->', "!!(missing.md){}", "```", "",
			"`<!-- inline -->` and `` ` <!-- double --> ` ``", "",
			String.raw`\<!-- escaped --> and $\text{<!-- math -->}$`, "",
			"[link](https://example.test/<!--path-->)",
		].join("\n"));
		const doc = await parseMD(file, {}, { allowIncludes: true });
		assert.ok(doc.nodes[0]?.type == "code");
		assert.equal(doc.nodes[0].code, '<!-- literal -->AFTER\nconst ticks = "```"; <!-- kept -->\n!!(missing.md){}');
		const runic = runifyDoc(doc);
		const runes = runic.nodes.flatMap(node => node.type == "text" ? node.text : []);
		assert.ok(runes.some(rune => rune.mono && rune.text == "<!-- inline -->"));
		assert.ok(runes.some(rune => rune.mono && rune.text.includes("<!-- double -->")));
		assert.ok(runes.some(rune => rune.type == "math" && rune.text == String.raw`\text{<!-- math -->}`));
		assert.ok(runes.some(rune => rune.text.includes("<!-- escaped -->")));
		assert.ok(runes.some(rune => rune.link == "https://example.test/<!--path-->"));
	}));

	test("does not evaluate templates or includes hidden by comments", async () => withTempDir(async dir =>
	{
		await writeMarkdown(dir, "CHILD<!-- hidden -->_TAIL", "child.md");
		const file = await writeMarkdown(dir, [
			"<!--", "!!(missing.md){}", "{{missing}}", "!!rule text size 3", "-->", "",
			"BEGIN <!-- {{alsoMissing}} --> END", "", "!!(child.md){}",
		].join("\n"));
		const warnings: string[] = [];
		const doc = await parseMD(file, {}, { allowIncludes: true }, false, null, warning => warnings.push(warning));
		assert.equal(doc.text.size, 14);
		assert.deepEqual(doc.nodes.filter(node => node.type == "text").map(node => node.text.replace(/\s+/g, " ")), ["BEGIN END", "CHILD_TAIL"]);
		assert.deepEqual(warnings, []);
	}));

	test("parses consecutive inserts and multiline JSON independently of prose and blank lines", async () => withTempDir(async dir =>
	{
		const file = await writeMarkdown(dir, [
			"INTRO", "!!(first.docx){", '  "marker": "<!-- literal -->",',
			'  "nested": { "brace": "}" },', "", '  /* } */ "value": 2,', "}TAIL",
			'!!(second.pdf){"name":"second"}', "AFTER",
		].join("\n"));
		const warnings: string[] = [];
		const doc = await parseMD(file, undefined, {}, false, null, warning => warnings.push(warning));
		assert.deepEqual(doc.nodes, [
			{ type: "text", text: "INTRO", sourceLine: 1 },
			{ type: "externalDoc", path: "first.docx", dict: { marker: "<!-- literal -->", "nested.brace": "}", value: "2" }, sourceLine: 2 },
			{ type: "text", text: "TAIL", sourceLine: 7 },
			{ type: "externalDoc", path: "second.pdf", dict: { name: "second" }, sourceLine: 8 },
			{ type: "text", text: "AFTER", sourceLine: 9 },
		]);
		assert.deepEqual(warnings, []);
	}));

	test("keeps JSONC scan state across parameter lines", async () => withTempDir(async dir =>
	{
		for (const newline of ["\n", "\r\n"])
		{
			const file = await writeMarkdown(dir, [
				"!!(first.docx){", String.raw`"text": "quote: \" slash: \\ brace: }",`,
				"// } { \"", "/* {", '"ignored": "}",', "*/", '"nested": {', '"value": "}"', "}", "}TAIL",
				"!!(second.pdf){}",
			].join(newline));
			const warnings: string[] = [];
			const doc = await parseMD(file, undefined, {}, false, null, warning => warnings.push(warning));
			assert.deepEqual(doc.nodes, [
				{ type: "externalDoc", path: "first.docx", dict: { text: 'quote: " slash: \\ brace: }', "nested.value": "}" }, sourceLine: 1 },
				{ type: "text", text: "TAIL", sourceLine: 10 },
				{ type: "externalDoc", path: "second.pdf", dict: {}, sourceLine: 11 },
			]);
			assert.deepEqual(warnings, []);
		}
	}));

	test("parses indented inserts with the opening brace on either line through the same route", async () => withTempDir(async dir =>
	{
		for (const indent of ["", "  ", "    ", "\t"])
			for (const nextLine of [false, true])
			{
				const first = [
					...(nextLine ? [`${indent}!!(<folder/first file.docx>)`, `${indent}{`] : [`${indent}!!(<folder/first file.docx>){`]),
					`${indent}"nested": {"brace": "}"},`, "", `${indent}"items": [{"name": "one"}],`, `${indent}}`,
				];
				const file = await writeMarkdown(dir, [...first, `${indent}!!("second.pdf"){}`, "AFTER"].join(nextLine ? "\r\n" : "\n"));
				const warnings: string[] = [];
				const doc = await parseMD(file, undefined, {}, false, null, warning => warnings.push(warning));
				assert.deepEqual(doc.nodes, [
					{ type: "externalDoc", path: "folder/first file.docx", dict: { "nested.brace": "}", "items.0.name": "one" }, sourceLine: 1 },
					{ type: "externalDoc", path: "second.pdf", dict: {}, sourceLine: first.length + 1 },
					{ type: "text", text: "AFTER", sourceLine: first.length + 2 },
				]);
				assert.deepEqual(warnings, []);
			}
	}));

	test("retains a bare insert example as text and skips comments before a parameter block", async () => withTempDir(async dir =>
	{
		const file = await writeMarkdown(dir, [
			"!!(example.docx)", "TEXT", "",
			"!!(actual.docx)", "<!-- hidden -->", "", '{"value": 1}',
		].join("\n"));
		const warnings: string[] = [];
		const doc = await parseMD(file, undefined, {}, false, null, warning => warnings.push(warning));
		assert.deepEqual(doc.nodes, [
			{ type: "text", text: "!!(example.docx)\nTEXT", sourceLine: 1 },
			{ type: "externalDoc", path: "actual.docx", dict: { value: "1" }, sourceLine: 4 },
		]);
		assert.deepEqual(warnings, []);
	}));

	test("preserves a following insert when the preceding dictionary is malformed or unclosed", async () => withTempDir(async dir =>
	{
		for (const first of ["!!(bad.pdf){bad}", "!!(bad.pdf){"])
		{
			const warnings: string[] = [];
			const file = await writeMarkdown(dir, first + '\n!!(good.pdf){"value":1}');
			const doc = await parseMD(file, undefined, {}, false, null, warning => warnings.push(warning));
			assert.deepEqual(doc.nodes.at(-1), { type: "externalDoc", path: "good.pdf", dict: { value: "1" }, sourceLine: 2 });
			assert.equal(warnings.length, 1);
			assert.ok(warnings[0].startsWith("Line 1: "));
		}
	}));

	test("keeps consecutive external inserts after expanding a Markdown include", async () => withTempDir(async dir =>
	{
		await writeMarkdown(dir, "CHILD\n\nCONTENT", "child.md");
		const file = await writeMarkdown(dir, '!!(child.md){}\n!!(first.pdf){}\n!!(second.docx){"value":1}');
		const warnings: string[] = [];
		const doc = await parseMD(file, {}, { allowIncludes: true }, false, null, warning => warnings.push(warning));
		const inserts = doc.nodes.filter(node => node.type == "externalDoc");
		assert.deepEqual(inserts.map(node => node.path), ["first.pdf", "second.docx"]);
		assert.deepEqual(inserts.map(node => doc.mapSourceLine(node.sourceLine)), [2, 3]);
		assert.deepEqual(warnings, []);
	}));

	test("parses headings, paragraphs, code, images, lists, and tables", async () => withTempDir(async dir =>
	{
		const file = await writeMarkdown(dir, "# Heading\n\nfirst\nsecond\n\n```ts Sample\n\n  **literal**\n\n```\n\n![Caption](<img.png>){100x}\n\n- one\n    * nested\n- two\n\nTable caption\n| A | B |\n|:--|:-:|\n| a | b |");
		const doc = await parseMD(file);
		assert.equal(doc.title, "Report");
		assert.deepEqual(doc.nodes.slice(0, 3).map(n => n.type), ["title", "text", "code"]);
		assert.deepEqual(doc.nodes[0], { type: "title", text: "Heading", level: 1, sourceLine: 1, notSpecial: undefined });
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
		const doc = await parseMD(file, undefined, {}, false, null, w => warnings.push(w));
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
		const doc = await parseMD(file, undefined, {}, false, null, warning => warnings.push(warning));
		assert.deepEqual(doc.nodes.find(node => node.type == "math"), { type: "math", latex: "E = mc^2", title: "([energy])", sourceLine: 2 });
		const runic = runifyDoc(doc);
		const text = runic.nodes.find(node => node.type == "text") as any;
		assert.ok(text.text.some((r: any) => r.type == "math" && r.text == "x_i"));
		assert.ok(text.text.some((r: any) => r.mono && r.text == "$code$"));
		assert.ok(text.text.some((r: any) => r.text.includes("$")));
		assert.equal((runic.nodes.find(node => node.type == "code") as any).code, "$literal$");
		assert.ok(warnings.some(warning => warning.startsWith("Line ") && warning.includes("not closed")));
	}));

	test("recognizes typed references while preserving escapes, code, math and link addresses", () =>
	{
		const doc: any = {
			rainbow: false,
			nodes: [{ type: "text", text: "[i#] [t# + 2] [c#-1] [f# - 1] [figure] [x#] \\[i#] `[t#]` $[f#]$ [link](https://example.test/[c#]) A - B" }],
		};
		const runes = (runifyDoc(doc).nodes[0] as any).text;
		assert.deepEqual(runes.filter((r: any) => r.type == "ref").map((r: any) => r.text), ["i#", "t# + 2", "c#-1", "f# - 1", "figure"]);
		assert.ok(runes.some((r: any) => r.type != "ref" && r.text.includes("[i#]")));
		assert.ok(runes.some((r: any) => r.text == "[t#]" && r.mono));
		assert.ok(runes.some((r: any) => r.text == "[f#]" && r.type == "math"));
		assert.ok(runes.some((r: any) => r.text == "link" && r.link == "https://example.test/[c#]"));
		assert.ok(runes.some((r: any) => r.text.includes("A – B")));
	});

	test("parses a manual formula number without creating an id", async () => withTempDir(async dir =>
	{
		const formula = (await parseMD(await writeMarkdown(dir, "(А.1)\n$$\nE = mc^2\n$$"))).nodes[0] as any;
		assert.equal(formula.type, "math");
		assert.equal(formula.title, "(А.1)");
	}));

	test("parses independent body, table and listing line spacing and warns on invalid values", async () => withTempDir(async dir =>
	{
		const warnings: string[] = [];
		const file = await writeMarkdown(dir, [
			"!!rule text line_spacing 2",
			"!!rule table text line_spacing 1.5",
			"!!rule code text line_spacing 1.25",
			"!!rule code text line_spacing nope",
		].join("\n"));
		const doc = await parseMD(file, undefined, {}, false, null, warning => warnings.push(warning));
		assert.equal(doc.text.line_spacing, 2);
		assert.equal(doc.table.text.line_spacing, 1.5);
		assert.equal(doc.code.text.line_spacing, 1.25);
		assert.equal(warnings.length, 1);
		assert.match(warnings[0]!, /^Line 4:/);
	}));

	test("applies formula spacing rules", async () => withTempDir(async dir =>
	{
		const doc = await parseMD(await writeMarkdown(dir, "!!rule formula spacing before 6\n!!rule formula spacing after 4"));
		assert.deepEqual(doc.formula.spacing, { before: 6, after: 4 });
	}));
});
