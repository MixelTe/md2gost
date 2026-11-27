import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Doc } from "../doc";
import { serializeDocx } from "../serializer";
import { parseMD, runifyDoc } from "../parser";
import { hasFile, openDocx, xml } from "./helpers/docx";
import { withTempDir, writeMarkdown, writePng } from "./helpers/fixtures";

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
	test("gives TOC entries their own alignment and room for page numbers", async () => withTempDir(async dir =>
	{
		const doc = fixedDoc();
		doc.nodes = [{ type: "tableOfContents", sourceLine: 1 }];
		const output = path.join(dir, "toc.docx");
		await serializeDocx(runifyDoc(doc), output, dir, assets, dir);
		const zip = openDocx(output);
		const styles = xml(zip, "word/styles.xml").match(/<w:style\b[^>]*>.*?<\/w:style>/gs)!;
		assert.match(styles.find(style => style.includes('w:name w:val="Normal"'))!, /<w:jc w:val="both"\/>/);
		for (let level = 1; level <= 3; level++)
		{
			const entryStyle = styles.find(style => style.includes(`w:name w:val="toc ${level}"`))!;
			assert.match(entryStyle, /<w:jc w:val="left"\/>/);
			assert.match(entryStyle, /<w:ind\b[^>]*w:right="[1-9][0-9]*"/);
			assert.match(entryStyle, /<w:tab w:val="right" w:leader="dot"/);
		}
		assert.match(xml(zip, "word/document.xml"), /<w:instrText\b[^>]*>TOC\b/);
	}));

	test("keeps block gaps when body paragraphs have no after-spacing", async () => withTempDir(async dir =>
	{
		await writePng(dir, "figure.PNG");
		const doc = fixedDoc();
		doc.nodes = [
			{ type: "text", sourceLine: 1, text: "BODY" },
			{ type: "table", sourceLine: 2, title: "TABLE_CAPTION", align: ["l"], rows: [[{ type: "text", sourceLine: 2, text: "CELL" }]] },
			{ type: "text", sourceLine: 3, text: "AFTER_TABLE" },
			{ type: "code", sourceLine: 4, title: "CODE_CAPTION", lang: "", code: "first\n\nlast" },
			{ type: "image", sourceLine: 5, src: "figure.PNG", width: 20, height: null, text: "FIGURE_CAPTION" },
			{ type: "image", sourceLine: 6, src: "figure.PNG", width: 20, height: null },
			{ type: "title", sourceLine: 7, level: 2, text: "HEADING" },
		];
		const output = path.join(dir, "spacing.docx");
		await serializeDocx(runifyDoc(doc), output, dir, assets, dir);
		const zip = openDocx(output);
		const styles = xml(zip, "word/styles.xml");
		const getStyle = (id: string) => new RegExp(`<w:style\\b[^>]*w:styleId="${id}"[^>]*>(.*?)</w:style>`, "s").exec(styles)![1]!;
		assert.match(getStyle("a2"), /<w:spacing\b[^>]*w:line="360"[^>]*w:after="0"/);
		assert.match(getStyle("ListingCode"), /<w:spacing\b[^>]*w:line="240"[^>]*w:after="160"/);
		assert.match(getStyle("ListingCode"), /<w:contextualSpacing\/>/);
		const paragraphs = xml(zip, "word/document.xml").match(/<w:p\b[^>]*>.*?<\/w:p>/gs)!;
		assert.match(paragraphs.find(p => p.includes(">AFTER_TABLE</w:t>"))!, /<w:spacing\b[^>]*w:before="160"/);
		assert.match(paragraphs.find(p => p.includes(">FIGURE_CAPTION</w:t>"))!, /<w:spacing\b[^>]*w:after="160"/);
		const images = paragraphs.filter(p => p.includes("<w:drawing>"));
		assert.equal(images.length, 2);
		assert.match(images[1]!, /<w:spacing\b[^>]*w:after="160"/);
		assert.equal(paragraphs.filter(p => p.includes('<w:pStyle w:val="ListingCode"/>')).length, 3);
		const heading = paragraphs.find(p => p.includes(">HEADING</w:t>"))!;
		assert.match(heading, /<w:spacing\b[^>]*w:before="160"/);
		assert.match(heading, /<w:spacing\b[^>]*w:after="80"/);
	}));

	for (const [tableAfter, imageBefore, expected] of [
		[undefined, undefined, 8],
		[6, 3, 6],
		[6, 12, 12],
		[0, 0, 0],
	] as const)
		test(`applies a ${expected} pt gap between a table and an image`, async () => withTempDir(async dir =>
		{
			await writePng(dir, "figure.png");
			const file = await writeMarkdown(dir, [
				...(tableAfter === undefined ? [] : [`!!rule table spacing after ${tableAfter}`]),
				...(imageBefore === undefined ? [] : [`!!rule img spacing before ${imageBefore}`]),
				"", "| Name | Value |", "|---|---|", "| Item | 1 |",
				"", "![After the table](figure.png){20}",
				"", "Ordinary text.",
				"", "![After text](figure.png){20}",
			].join("\n"));
			const output = path.join(dir, "table-image.docx");
			await serializeDocx(runifyDoc(await parseMD(file)), output, dir, assets, dir);
			const document = xml(openDocx(output), "word/document.xml");
			const images = document.match(/<w:p\b[^>]*>.*?<\/w:p>/gs)!.filter(p => p.includes("<w:drawing>"));
			assert.equal(images.length, 2);
			assert.ok(document.includes(`</w:tbl>${images[0]}`));
			assert.match(images[0]!, new RegExp(`<w:spacing\\b[^>]*w:before="${expected * 20}"`));
			if (imageBefore === undefined) assert.doesNotMatch(images[1]!, /<w:spacing\b[^>]*w:before=/);
			else assert.match(images[1]!, new RegExp(`<w:spacing\\b[^>]*w:before="${imageBefore * 20}"`));
		}));

	for (const highlight of [false, true])
		test(`applies custom listing line spacing independently of body and block gaps (${highlight ? "highlighted" : "plain"})`, async () => withTempDir(async dir =>
		{
			const file = await writeMarkdown(dir, [
				"!!rule text line_spacing 2",
				"!!rule text spacing after 12",
				"!!rule code text line_spacing 1.25",
				"!!rule code spacing after 6",
				`!!rule code highlight ${highlight ? "on" : "off"}`,
				"", "```js", "const first = 1;", "", "const last = 2;", "```",
			].join("\n"));
			const output = path.join(dir, "listing.docx");
			await serializeDocx(runifyDoc(await parseMD(file)), output, dir, assets, dir);
			const zip = openDocx(output);
			const styles = xml(zip, "word/styles.xml");
			const listing = /<w:style\b[^>]*w:styleId="ListingCode"[^>]*>(.*?)<\/w:style>/s.exec(styles)![1]!;
			assert.match(listing, /<w:spacing\b[^>]*w:line="300"[^>]*w:lineRule="auto"[^>]*w:after="120"/);
			const paragraphs = xml(zip, "word/document.xml").match(/<w:p\b[^>]*>.*?<\/w:p>/gs)!.filter(p => p.includes('<w:pStyle w:val="ListingCode"/>'));
			assert.equal(paragraphs.length, 3);
			for (const paragraph of paragraphs) assert.doesNotMatch(paragraph, /<w:spacing\b[^>]*w:line=/);
			assert.equal(paragraphs.some(p => /<w:color\b/.test(p)), highlight);
		}));

	for (const [name, firstBlock, secondBlock, boundary, expected] of [
		["table to heading", "| Head |\n|---|\n| Cell |", "## Next", "paragraph", 18],
		["table to listing caption", "| Head |\n|---|\n| Cell |", "```js Caption\nconst value = 1;\n```", "paragraph", 18],
		["table to note", "| Head |\n|---|\n| Cell |", ":::note[Next]\nBody.\n:::", "paragraph", 18],
		["table to formula", "| Head |\n|---|\n| Cell |", "$$\nx = 1\n$$", "separator", 18],
		["formula to text", "$$\nx = 1\n$$", "Next paragraph.", "paragraph", 16],
		["formula to formula", "$$\nx = 1\n$$", "$$\ny = 2\n$$", "separator", 16],
		["text to highlighted listing", "Intro.", "```js\nconst value = 1;\n```", "listing", 11],
		["listing to listing", "```js\nconst first = 1;\n```", "```js\nconst second = 2;\n```", "listing separator", 11],
	] as const)
		test(`preserves external spacing from ${name}`, async () => withTempDir(async dir =>
		{
			const file = await writeMarkdown(dir, [
				"!!rule table spacing after 18",
				"!!rule formula spacing before 4",
				"!!rule formula spacing after 16",
				"!!rule code spacing before 11",
				"!!rule code highlight on",
				"", firstBlock, "", secondBlock,
			].join("\n"));
			const output = path.join(dir, "boundary.docx");
			await serializeDocx(runifyDoc(await parseMD(file)), output, dir, assets, dir);
			const document = xml(openDocx(output), "word/document.xml");
			const tableEnd = document.indexOf("</w:tbl>");
			const afterFirstBlock = tableEnd < 0 ? document : document.slice(tableEnd + "</w:tbl>".length);
			const paragraphs = afterFirstBlock.match(/<w:p\b[^>]*>.*?<\/w:p>/gs)!;
			const next = boundary.startsWith("listing") ? paragraphs[1]! : paragraphs[0]!;
			assert.match(next, new RegExp(`<w:spacing\\b[^>]*w:before="${expected * 20}"`));
			if (boundary.includes("separator"))
			{
				assert.match(next, /<w:spacing\b[^>]*w:lineRule="exact"/);
				assert.doesNotMatch(next, /<w:r>/);
			}
		}));

	test("exports mixed Latin and Cyrillic inline formulas as complete native math", async () => withTempDir(async dir =>
	{
		const file = await writeMarkdown(dir, String.raw`Latin и русский $T_{ср}$ и $T_{\text{ср}}$.

$$
T_{\text{ср}}
$$`);
		const output = path.join(dir, "cyrillic-math.docx");
		const warnings: string[] = [];
		await serializeDocx(runifyDoc(await parseMD(file)), output, dir, assets, dir, warning => warnings.push(warning));
		const document = xml(openDocx(output), "word/document.xml");
		assert.equal((document.match(/<m:oMath>/g) || []).length, 3);
		assert.equal((document.match(/<m:sSub>/g) || []).length, 3);
		assert.ok(document.replace(/<[^>]+>/g, "").includes("Tср"));
		assert.ok(!document.includes("T_{") && !document.includes("\\text"));
		assert.deepEqual(warnings, []);
	}));

	test("reports the original formula line before and after a Markdown include", async () => withTempDir(async dir =>
	{
		await writeMarkdown(dir, "CHILD\n\nBODY\n\nEND", "child.md");
		for (const first of ["INTRO", "!!(child.md){}"])
		{
			const file = await writeMarkdown(dir, [first, "", "$\\unknown{x}$", "", "$$", "\\unknown{x}", "$$"].join("\n"));
			const doc = await parseMD(file, {}, { allowIncludes: true });
			const warnings: string[] = [];
			await serializeDocx(runifyDoc(doc), path.join(dir, "warnings.docx"), dir, assets, dir, warning => warnings.push(warning));
			assert.deepEqual(warnings, [
				"Line 3: Formula was not converted: unsupported command \\unknown",
				"Line 5: Formula was not converted: unsupported command \\unknown",
			]);
		}
	}));

	for (const mode of ["on", "outline"])
		test(`shares the listing font with inline code in ${mode} mode`, async () => withTempDir(async dir =>
		{
			for (const font of [undefined, "Shared & Mono"])
			{
				const input = await writeMarkdown(dir, [
					"!!rule text font Body Serif",
					...(font ? [`!!rule code text font ${font}`] : []),
					"!!rule code text size 9",
					`!!rule backtick_mono ${mode}`,
					"Text with `INLINE_MONO`.",
					"", "```", "listing", "```",
				].join("\n"));
				const output = path.join(dir, "shared-font.docx");
				await serializeDocx(runifyDoc(await parseMD(input)), output, dir, assets, dir);
				const zip = openDocx(output);
				const expected = font ? "Shared &amp; Mono" : "Courier New";
				const styles = xml(zip, "word/styles.xml");
				const listing = /<w:style\b[^>]*w:styleId="ListingCode"[^>]*>(.*?)<\/w:style>/s.exec(styles)![1]!;
				assert.ok(listing.includes(`w:ascii="${expected}"`));
				const inline = xml(zip, "word/document.xml").match(/<w:r\b[^>]*>.*?<\/w:r>/gs)!.find(run => run.includes(">INLINE_MONO</w:t>"))!;
				assert.ok(inline.includes(`w:ascii="${expected}"`));
				assert.match(inline, /<w:sz w:val="26"\/>/);
				assert.equal(inline.includes("<w:bdr"), mode == "outline");
			}
		}));
	test("keeps the body font for italic and off inline code modes", async () => withTempDir(async dir =>
	{
		for (const mode of ["italic", "off"])
		{
			const input = await writeMarkdown(dir, `!!rule text font Body Serif\n!!rule code text font Listing Mono\n!!rule backtick_mono ${mode}\n\nText with \`INLINE_MONO\`.`);
			const output = path.join(dir, "body-font.docx");
			await serializeDocx(runifyDoc(await parseMD(input)), output, dir, assets, dir);
			const zip = openDocx(output);
			assert.ok(xml(zip, "word/styles.xml").includes('w:ascii="Body Serif"'));
			const inline = xml(zip, "word/document.xml").match(/<w:r\b[^>]*>.*?<\/w:r>/gs)!.find(run => run.includes(">INLINE_MONO</w:t>"))!;
			assert.equal(inline.includes("<w:rFonts"), false);
			assert.equal(inline.includes("<w:bdr"), false);
			assert.equal(/<w:i\b/.test(inline), mode == "italic");
		}
	}));
	test("keeps body and listing font rules independent when they use template font names", async () => withTempDir(async dir =>
	{
		for (const [body, listing] of [["Courier New", "Listing Mono"], ["Body Serif", "Times New Roman"]])
		{
			const doc = await parseMD(await writeMarkdown(dir, `!!rule text font ${body}\n!!rule code text font ${listing}\n\nText\n\n\`\`\`\ncode\n\`\`\``));
			const output = path.join(dir, "fonts.docx");
			await serializeDocx(runifyDoc(doc), output, dir, assets, dir);
			const styles = xml(openDocx(output), "word/styles.xml");
			const getStyle = (id: string) => new RegExp(`<w:style\\b[^>]*w:styleId="${id}"[^>]*>(.*?)</w:style>`, "s").exec(styles)![1]!;
			assert.ok(getStyle("a2").includes(`w:ascii="${body}"`));
			assert.ok(getStyle("af3").includes(`w:ascii="${body}"`));
			for (const id of ["ListingCode", "ListingCode0"])
				assert.ok(getStyle(id).includes(`w:ascii="${listing}"`));
		}
	}));
	test("applies font rules to styles, inline code and native formulas without changing names", async () => withTempDir(async dir =>
	{
		const file = await writeMarkdown(dir, [
			"!!rule text font Body & Serif",
			"!!rule code text font Listing Mono",
			"!!rule backtick_mono on",
			"!!rule formula font Custom Math",
			"# Heading",
			"Text with `code` and $a_1 + \\frac{x}{y}$.",
			"```", "listing", "```",
		].join("\n\n"));
		const warnings: string[] = [];
		const doc = await parseMD(file, undefined, {}, dir, undefined, msg => warnings.push(msg));
		assert.deepEqual(warnings, []);
		const output = path.join(dir, "fonts.docx");
		await serializeDocx(runifyDoc(doc), output, dir, assets, dir);
		const zip = openDocx(output);
		const styles = xml(zip, "word/styles.xml");
		assert.match(styles, /w:ascii="Body &amp; Serif"/);
		assert.ok(!styles.includes('w:ascii="Times New Roman"'));
		assert.match(styles, /w:ascii="Listing Mono"/);
		const document = xml(zip, "word/document.xml");
		assert.match(document, /w:ascii="Listing Mono"/);
		const formulas = document.match(/<m:r>.*?<\/m:r>/g)!;
		assert.ok(formulas.length > 0);
		for (const formula of formulas) assert.match(formula, /w:ascii="Custom Math"/);
		assert.match(xml(zip, "word/settings.xml"), /<m:mathFont m:val="Custom Math"\/>/);
	}));
	test("breaks header/footer inheritance when a section disables them", async () => withTempDir(async dir =>
	{
		const doc = fixedDoc();
		doc.header = { type: "content", align: "left", nodes: [{ type: "text", sourceLine: 1, text: "OLD_HEADER" }] };
		doc.footer = { type: "content", align: "left", nodes: [{ type: "text", sourceLine: 1, text: "OLD_FOOTER" }] };
		doc.nodes = [
			{ type: "text", sourceLine: 1, text: "first" },
			{ type: "sectionBreak", sourceLine: 2, orientation: "portrait", pageStart: null, header: { type: "none" }, footer: { type: "none" } },
			{ type: "text", sourceLine: 3, text: "second" },
		];
		const output = path.join(dir, "sections.docx");
		await serializeDocx(runifyDoc(doc), output, dir, assets, dir);
		const zip = openDocx(output);
		const sections = xml(zip, "word/document.xml").match(/<w:sectPr>.*?<\/w:sectPr>/g)!;
		assert.equal(sections.length, 2);
		assert.match(sections[1], /w:headerReference/);
		assert.match(sections[1], /w:footerReference/);
		const refs = [...xml(zip, "word/_rels/document.xml.rels").matchAll(/<Relationship Id="([^"]+)"[^>]*Target="([^"]+)"[^>]*\/>/g)];
		for (const type of ["header", "footer"])
		{
			const id = sections[1].match(new RegExp(`<w:${type}Reference[^>]*r:id="([^"]+)"`))![1];
			const target = refs.find(r => r[1] == id)![2];
			assert.ok(!xml(zip, "word/" + target).includes("OLD_"));
		}
	}));
	for (const custom of [false, true])
		test(`keeps Admonition properties in schema order and code font sizes consistent (${custom ? "custom" : "defaults"})`, async () => withTempDir(async dir =>
		{
			const doc = fixedDoc();
			doc.appendText("Style regression fixture", 1);
			if (custom)
			{
				doc.code.text.size = 15;
				for (const style of Object.values(doc.admonition))
				{
					style.spacing = { before: 0, after: 0 };
					style.indent = 0;
					style.padding = { top: 1, right: 2, bottom: 3, left: 4 };
					style.color = "123456";
					style.background = "abcdef";
					style.bar_width = 1.5;
				}
			}
			const output = path.join(dir, "styles.docx");
			await serializeDocx(runifyDoc(doc), output, dir, assets, dir);
			const styles = xml(openDocx(output), "word/styles.xml");
			const getStyle = (id: string) => new RegExp(`<w:style\\b[^>]*w:styleId="${id}"[^>]*>(.*?)</w:style>`, "s").exec(styles)![1]!;
			const code = getStyle("ListingCode");
			assert.ok(code.includes(`<w:sz w:val="${doc.code.text.size * 2}"/>`));
			assert.ok(code.includes(`<w:szCs w:val="${doc.code.text.size * 2}"/>`));
			for (const [type, expected] of Object.entries(doc.admonition))
			{
				const style = getStyle(`xAdmonition${type == "note" ? "" : type}`);
				const properties = /<w:pPr>(.*?)<\/w:pPr>/s.exec(style)![1]!;
				// The current template lacks spacing/indent and several borders in derived styles.
				const positions = ["pBdr", "shd", "spacing", "ind"].map(name => properties.search(new RegExp(`<w:${name}\\b`)));
				assert.ok(positions.every((position, i) => position >= 0 && (i == 0 || position > positions[i - 1]!)), type);
				const borders = /<w:pBdr>(.*?)<\/w:pBdr>/s.exec(properties)![1]!;
				assert.deepEqual([...borders.matchAll(/<w:(\w+)\b/g)].map(match => match[1]), ["top", "left", "bottom", "right"], type);
				assert.match(properties, new RegExp(`<w:spacing\\b[^>]*w:before="${expected.spacing.before * 20}"[^>]*w:after="${expected.spacing.after * 20}"`));
				for (const side of ["top", "left", "bottom", "right"] as const)
				{
					const border = new RegExp(`<w:${side}\\b[^>]*/>`).exec(borders)![0];
					assert.ok(border.includes(`w:space="${expected.padding[side]}"`));
					assert.ok(border.includes(`w:color="${side == "left" ? expected.color : "FFFFFF"}"`));
				}
				assert.ok(properties.includes(`w:fill="${expected.background}"`));
			}
		}));

	test("styles clickable links and preserves literal URL targets in relationships", async () => withTempDir(async dir =>
	{
		const url = "https://example.test/foo-bar/UTF-8?a=1&b=2#x-y";
		const doc = await parseMD(await writeMarkdown(dir, `!!rule link color 000000\n!!rule link underline off\n\n[**ссылка**](${url}) [внутренняя](#mark) ${url}`));
		const output = path.join(dir, "links.docx");
		await serializeDocx(runifyDoc(doc), output, dir, assets, dir);
		const zip = openDocx(output);
		const document = xml(zip, "word/document.xml");
		assert.ok(document.includes('w:anchor="mark"'));
		assert.ok(document.includes('<w:u w:val="none"'));
		assert.ok(document.includes('<w:color w:val="000000"'));
		assert.ok(document.includes("<w:b"));
		assert.ok(document.includes(url.replaceAll("&", "&amp;")));
		assert.ok(xml(zip, "word/_rels/document.xml.rels").includes(url.replaceAll("&", "&amp;")));
		const styles = xml(zip, "word/styles.xml");
		for (const id of ["af0", "af8"])
		{
			const style = new RegExp(`<w:style[^>]*w:styleId="${id}"[^>]*>(.*?)</w:style>`, "s").exec(styles)![1]!;
			assert.ok(style.includes('w:val="000000"'));
			assert.ok(style.includes('w:val="none"'));
			assert.equal(style.includes("themeColor"), false);
		}
	}));
	test("writes deterministic metadata and essential DOCX XML", async () => withTempDir(async dir =>
	{
		const doc = fixedDoc();
		doc.nodes = [
			{ type: "title", sourceLine: 1, level: 1, text: "Heading" },
			{ type: "text", sourceLine: 1, text: "**bold** *italic* `mono`<br>next" },
			{ type: "pageBreak", sourceLine: 1 },
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
			{ type: "text", sourceLine: 1, text: "[external](https://example.test) [internal](#mark)" },
			{ type: "text", sourceLine: 1, text: "target", noIndent: true },
			{ type: "list", sourceLine: 1, ordered: true, mark: ".", startIndex: 3, items: [{ type: "listItem", sourceLine: 1, text: "item" }] },
			{ type: "table", sourceLine: 1, title: "Table", align: ["r"], rows: [[{ type: "text", sourceLine: 1, text: "Head" }], [{ type: "text", sourceLine: 1, text: "Value" }]] },
			{ type: "image", sourceLine: 1, src: "figure.PNG", width: 20, height: null, text: "Figure" },
			{ type: "sectionBreak", sourceLine: 1, pageStart: -1, orientation: "landscape" }, { type: "text", sourceLine: 1, text: "last" },
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
		doc.header = { type: "content", align: "center", nodes: [{ type: "text", sourceLine: 1, text: "Inventory [!page]" }] };
		doc.footer = {
			type: "content",
			align: "left",
			nodes: [{
				type: "table",
				sourceLine: 1,
				header: false,
				align: ["l", "r"],
				rows: [[{ type: "text", sourceLine: 1, text: "Change" }, { type: "text", sourceLine: 1, text: "[!page] / [!pages]" }]],
			}],
		};
		doc.nodes = [{ type: "text", sourceLine: 1, text: "body" }, { type: "sectionBreak", sourceLine: 1, pageStart: -1, orientation: null, footer: { type: "auto" } }, { type: "text", sourceLine: 1, text: "unpaged" }];
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
		doc.nodes = [{ type: "admonition", sourceLine: 1, admonitionType: "warning", title: "Careful", text: "Keep **this** value.", attributes: ".compact" }];
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

	test("rejects unsupported and corrupt image files", async () => withTempDir(async dir =>
	{
		for (const [name, message] of [["image.txt", /Unsupported image format/], ["corrupt.png", /Invalid|unsupported/]] as const)
		{
			await fs.writeFile(path.join(dir, name), "invalid image data");
			const doc = fixedDoc();
			doc.nodes = [{ type: "image", sourceLine: 1, src: name, width: null, height: null }];
			await assert.rejects(() => serializeDocx(runifyDoc(doc), path.join(dir, "x.docx"), dir, assets, dir), message);
		}
	}));

	test("rejects image paths outside the allowed directory", async () => withTempDir(async dir =>
	{
		const outside = path.join(path.dirname(dir), "outside.png");
		await fs.writeFile(outside, "outside");
		try
		{
			const doc = fixedDoc();
			doc.nodes = [{ type: "image", sourceLine: 1, src: "../outside.png", width: null, height: null }];
			await assert.rejects(() => serializeDocx(runifyDoc(doc), path.join(dir, "x.docx"), dir, assets, dir), /Access denied/);
		}
		finally { await fs.rm(outside, { force: true }); }
	}));
});
