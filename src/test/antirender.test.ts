import * as assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import PizZip from "pizzip";
import { inspectDocx, parseDocx, reverseDocx, serializeInspection, serializeMD, type DocxNode } from "../antirender";
import { render } from "../main";
import { parseMD, runifyDoc } from "../parser";
import { enrichDoc } from "../enricher";
import { withTempDir, writeMarkdown, writePng } from "./helpers/fixtures";
import { openDocx, xml } from "./helpers/docx";

const escapeXml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const run = (text: string, properties = "") => `<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ""}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
const paragraph = (text: string, properties = "", runProperties = "") => `<w:p>${properties ? `<w:pPr>${properties}</w:pPr>` : ""}${run(text, runProperties)}</w:p>`;
const style = (id: string) => `<w:pStyle w:val="${id}"/>`;
const numbered = (id: string, level = 0) => `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${id}"/></w:numPr>`;
const styles = `<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Times New Roman"/></w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:styleId="Base"><w:rPr><w:b/></w:rPr><w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
<w:style w:styleId="CustomHeading"><w:basedOn w:val="Base"/><w:name w:val="Custom heading"/></w:style>
<w:style w:styleId="ListingCode"><w:rPr><w:rFonts w:ascii="Courier New"/></w:rPr></w:style>
<w:style w:styleId="CustomCode"><w:basedOn w:val="ListingCode"/><w:name w:val="Custom code"/></w:style>
<w:style w:styleId="ListingCaption"><w:name w:val="Listing Caption"/></w:style>
<w:style w:styleId="TableCaption"><w:name w:val="Table Caption"/></w:style>
<w:style w:styleId="Mono"><w:rPr><w:rFonts w:ascii="Consolas"/></w:rPr></w:style>
</w:styles>`;

async function fixture(dir: string, body: string, parts: Record<string, string | Uint8Array> = {}, name = "source.docx")
{
	const zip = new PizZip();
	zip.file("word/document.xml", `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"> <w:body>${body}</w:body></w:document>`);
	zip.file("word/styles.xml", styles);
	for (const [part, content] of Object.entries(parts)) zip.file(part, content);
	const file = path.join(dir, name);
	await fs.writeFile(file, zip.generate({ type: "nodebuffer" }));
	return file;
}

const nodeText = (node: DocxNode) => "text" in node ? typeof node.text == "string" ? node.text : node.text.map(r => r.text).join("") : "";

suite("DOCX antirender", () =>
{
	test("omits rules for plain content, listings and literal monospace fallbacks", () =>
	{
		const text = serializeMD({ images: [], warnings: [], nodes: [
			{ id: 1, type: "title", level: 2, text: [{ text: "Heading", mono: true }] },
			{ id: 2, type: "text", text: [{ text: "Plain text" }, { text: "multi\nline", mono: true }, { text: "a``b", mono: true }] },
			{ id: 3, type: "code", text: "CODE `literal`", inferred: false, fonts: [] },
		] });
		assert.doesNotMatch(text, /!!rule/);
		assert.match(text, /^## Heading/);
	});

	test("enables monospace only for emitted inline code including table cells and captions", () =>
	{
		for (const node of [
			{ id: 1, type: "text", text: [{ text: "inline", mono: true }] },
			{ id: 1, type: "table", complex: false, rows: [[[{ id: 2, type: "text", text: [{ text: "inline", mono: true }] }]]] },
			{ id: 1, type: "image", image: "img", title: [{ text: "inline", mono: true }] },
		] satisfies DocxNode[])
		{
			const text = serializeMD({ nodes: [node], images: [], warnings: [] });
			assert.deepEqual(text.match(/^!!rule .+$/gm), ["!!rule backtick_mono on"]);
			assert.ok(text.includes("`inline`"));
		}
	});

	test("adds list rules only for lists represented as Markdown", async () => withTempDir(async dir =>
	{
		const item = { id: 1, type: "listItem", text: [{ text: "Original!" }], level: 0, ordered: true, number: 1, label: "1.", format: "decimal", simple: true, mark: "." } satisfies DocxNode;
		for (const [changes, rules] of [
			[{}, ["list ordered style keep", "list autopunctuation off"]],
			[{ mark: ")" }, ["list autopunctuation off"]],
			[{ ordered: false }, ["list autopunctuation off"]],
			[{ simple: false }, []],
			[{ level: 6 }, []],
		] as const)
		{
			const text = serializeMD({ nodes: [{ ...item, ...changes }], images: [], warnings: [] });
			assert.deepEqual(text.match(/^!!rule .+$/gm) || [], rules.map(rule => "!!rule " + rule));
			if (rules.length)
			{
				const doc = await parseMD(await writeMarkdown(dir, text));
				enrichDoc(doc);
				const list = doc.nodes[0];
				assert.ok(list?.type == "list");
				assert.equal(list.items[0]?.type == "listItem" && list.items[0].text, "Original!");
			}
		}
	}));

	test("resolves inherited styles, explicit formatting overrides and heading levels", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, paragraph("Heading", style("CustomHeading"))
			+ `<w:p>${run("BOLD", "<w:b/>")}${run(" normal", '<w:b w:val="0"/>')}${run(" italic", "<w:i/>")}</w:p>`);
		const doc = await parseDocx(input);
		assert.equal(doc.nodes[0]?.type, "title");
		assert.ok(doc.nodes[0]?.type == "title" && doc.nodes[0].level == 2);
		assert.ok(doc.nodes[0].text[0]?.bold);
		assert.ok(doc.nodes[1]?.type == "text");
		assert.deepEqual(doc.nodes[1].text.map(r => [r.text, !!r.bold, !!r.italic]), [["BOLD", true, false], [" normal", false, false], [" italic", false, true]]);
		assert.match(serializeMD(doc), /## Heading/);
	}));

	test("keeps hyperlink labels and cached field text without resolving links", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, `<w:p><w:hyperlink r:id="external">${run("LABEL")}</w:hyperlink>
<w:fldSimple w:instr=" REF arbitraryBookmark ">${run("VISIBLE_REF")}</w:fldSimple>
<w:r><w:fldChar w:fldCharType="begin"/><w:instrText> HYPERLINK https://hidden.test </w:instrText><w:fldChar w:fldCharType="separate"/></w:r>${run("CACHED_LABEL")}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`, {
			"word/_rels/document.xml.rels": '<Relationships><Relationship Id="external" Type="http://example/hyperlink" Target="https://hidden.test" TargetMode="External"/></Relationships>',
		});
		const doc = await parseDocx(input);
		const text = serializeMD(doc);
		assert.equal(doc.nodes.map(nodeText).join(""), "LABELVISIBLE_REFCACHED_LABEL");
		assert.doesNotMatch(text, /hidden\.test|arbitraryBookmark|\[i#\]/);
	}));

	test("joins fragmented emphasis without injecting Markdown marker characters", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, `<w:p>${run("A", "<w:b/>")}${run("B", "<w:b/>")}${run("C", "<w:i/>")}</w:p>`
			+ `<w:p>${run("SAME", "<w:b/>")}${run("STYLE", "<w:b/>")}</w:p>`);
		const result = await reverseDocx({ input });
		assert.ok(result.warnings.some(w => w.code == "inline-formatting"));
		const doc = runifyDoc(await parseMD(result.filePath));
		assert.deepEqual(doc.nodes.map(n => n.type == "text" && n.text.map(r => r.text).join("")), ["ABC", "SAMESTYLE"]);
		assert.ok(doc.nodes[1]?.type == "text" && doc.nodes[1].text.some(r => r.bold && r.text == "SAMESTYLE"));
	}));

	test("recognizes inherited monospace, retains code whitespace and separates inline code", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, paragraph("Листинг 3 – Запрос", style("ListingCaption"))
			+ paragraph("  SELECT name;  ", style("CustomCode")) + paragraph("", style("CustomCode")) + paragraph("\tFROM products;", style("CustomCode"))
			+ paragraph("INFERRED", style("Mono")) + `<w:p>${run("Use ")}${run("inline", '<w:rFonts w:ascii="Consolas"/>')}${run(" here")}</w:p>`);
		const doc = await parseDocx(input);
		const code = doc.nodes[0];
		assert.ok(code?.type == "code");
		assert.equal(code.text, "  SELECT name;  \n\n\tFROM products;\nINFERRED");
		assert.equal(code.title?.map(r => r.text).join(""), "Листинг 3 – Запрос");
		assert.ok(doc.nodes[1]?.type == "text" && doc.nodes[1].text[1]?.mono);
		assert.match(serializeMD(doc), /```text Листинг 3 – Запрос\n {2}SELECT name; {2}\n\n\tFROM products;/);
		assert.match(serializeMD(doc), /Use `inline` here/);
		const monoBody = styles.replace("Times New Roman", "Consolas");
		const bodyDoc = await parseDocx(await fixture(dir, paragraph("Ordinary prose"), { "word/styles.xml": monoBody }, "mono.docx"));
		assert.equal(bodyDoc.nodes[0]?.type, "text");
	}));

	test("keeps empty paragraphs with inherited monospace inside one listing", async () => withTempDir(async dir =>
	{
		const inherited = styles.replace("</w:styles>", '<w:style w:styleId="InheritedMono"><w:basedOn w:val="Mono"/></w:style></w:styles>');
		const input = await fixture(dir, paragraph("Листинг 1 – Пример", style("ListingCaption"))
			+ paragraph("FIRST", style("InheritedMono"))
			+ paragraph("", style("InheritedMono"))
			+ '<w:p><w:pPr><w:pStyle w:val="InheritedMono"/></w:pPr></w:p>'
			+ paragraph("LAST", style("InheritedMono")), { "word/styles.xml": inherited });
		const doc = await parseDocx(input);
		assert.equal(doc.nodes.length, 1);
		const code = doc.nodes[0];
		assert.ok(code?.type == "code");
		assert.equal(code.text, "FIRST\n\n\nLAST");
		assert.equal(code.title?.map(r => r.text).join(""), "Листинг 1 – Пример");
		assert.equal(code.inferred, true);
		const reversed = await reverseDocx({ input });
		const markdown = await parseMD(reversed.filePath);
		assert.deepEqual(markdown.nodes.flatMap(n => n.type == "code" ? [n.code] : []), ["FIRST\n\n\nLAST"]);
	}));

	test("recognizes empty monospace runs and paragraph marks", async () => withTempDir(async dir =>
	{
		const font = '<w:rFonts w:ascii="Consolas"/>';
		const variants = [
			paragraph("", "", font),
			`<w:p><w:r><w:rPr>${font}</w:rPr></w:r></w:p>`,
			`<w:p><w:pPr><w:rPr>${font}</w:rPr></w:pPr></w:p>`,
			`<w:p><w:pPr><w:rPr>${font}</w:rPr></w:pPr>${run("")}</w:p>`,
		];
		for (const blank of variants)
		{
			const doc = await parseDocx(await fixture(dir, paragraph("FIRST", style("Mono")) + blank + paragraph("LAST", style("Mono"))));
			assert.equal(doc.nodes.length, 1, blank);
			assert.ok(doc.nodes[0]?.type == "code");
			assert.equal(doc.nodes[0].text, "FIRST\n\nLAST");
		}
	}));

	test("preserves whitespace-only listing lines and separate space runs", async () => withTempDir(async dir =>
	{
		for (const codeStyle of ["Mono", "CustomCode"])
		{
			const input = await fixture(dir, paragraph("FIRST", style(codeStyle))
				+ paragraph("   ", style(codeStyle))
				+ `<w:p><w:pPr>${style(codeStyle)}</w:pPr><w:r><w:tab/></w:r></w:p>`
				+ `<w:p><w:pPr>${style(codeStyle)}</w:pPr>${run("LEFT")}${run(" ")}${run("RIGHT")}</w:p>`);
			const doc = await parseDocx(input);
			assert.equal(doc.nodes.length, 1);
			assert.ok(doc.nodes[0]?.type == "code");
			assert.equal(doc.nodes[0].text, "FIRST\n   \n\t\nLEFT RIGHT");
			assert.ok(serializeMD(doc).includes("FIRST\n   \n\t\nLEFT RIGHT"));
		}
	}));

	test("retains plain empty paragraphs as listing boundaries", async () => withTempDir(async dir =>
	{
		for (const blank of [paragraph(""), "<w:p/>", paragraph("   "),
			`<w:p><w:pPr>${style("Mono")}<w:rPr><w:rFonts w:ascii="Times New Roman"/></w:rPr></w:pPr></w:p>`])
		{
			const doc = await parseDocx(await fixture(dir, paragraph("FIRST", style("Mono")) + blank + paragraph("LAST", style("Mono"))));
			assert.deepEqual(doc.nodes.map(n => n.type), ["code", "text", "code"], blank);
			assert.equal((serializeMD(doc).match(/^```text/gm) || []).length, 2);
		}
	}));

	test("does not infer listings from blank paragraphs when the body font is monospace", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, paragraph("Prose") + paragraph("") + paragraph("   ")
			+ `<w:p><w:pPr>${style("Mono")}</w:pPr></w:p>` + paragraph("More prose"),
		{ "word/styles.xml": styles.replace("Times New Roman", "Consolas") });
		const doc = await parseDocx(input);
		assert.deepEqual(doc.nodes.map(n => n.type), ["text", "text", "text", "text", "text"]);
	}));

	test("resolves theme fonts and fixed-pitch font metadata without installed fonts", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, paragraph("CUSTOM_MONO", "", '<w:rFonts w:ascii="CustomFixed"/>')
			+ paragraph("THEME_MONO", "", '<w:rFonts w:asciiTheme="majorHAnsi"/>'), {
			"word/fontTable.xml": '<w:fonts><w:font w:name="CustomFixed"><w:pitch w:val="fixed"/></w:font></w:fonts>',
			"word/theme/theme1.xml": '<a:theme><a:themeElements><a:fontScheme><a:majorFont><a:latin typeface="Menlo"/></a:majorFont></a:fontScheme></a:themeElements></a:theme>',
		});
		const doc = await parseDocx(input);
		assert.ok(doc.nodes[0]?.type == "code");
		assert.deepEqual(doc.nodes[0].fonts, ["CustomFixed", "Menlo"]);
	}));

	test("retains list starts, overrides, level restarts and automatically numbered headings", async () => withTempDir(async dir =>
	{
		const numbering = `<w:numbering><w:abstractNum w:abstractNumId="a">
<w:lvl w:ilvl="0"><w:start w:val="3"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1)"/></w:lvl>
<w:lvl w:ilvl="1"><w:start w:val="2"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/></w:lvl>
</w:abstractNum><w:num w:numId="n"><w:abstractNumId w:val="a"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride></w:num></w:numbering>`;
		const input = await fixture(dir, paragraph("one", numbered("n")) + paragraph("child", numbered("n", 1))
			+ paragraph("two", numbered("n")) + paragraph("child again", numbered("n", 1)) + paragraph("Heading", style("CustomHeading") + numbered("n")), { "word/numbering.xml": numbering });
		const doc = await parseDocx(input);
		assert.deepEqual(doc.nodes.slice(0, 4).map(n => n.type == "listItem" && [n.number, n.level, n.label]), [[7, 0, "7)"], [2, 1, "2."], [8, 0, "8)"], [2, 1, "2."]]);
		const text = serializeMD(doc);
		assert.match(text, /7\) one\n {4}2\. child\n8\) two\n {4}2\. child again/);
		assert.match(text, /## 9\) Heading/);
	}));

	test("keeps compound and letter numbering as literal labels with a warning", async () => withTempDir(async dir =>
	{
		const numbering = '<w:numbering><w:abstractNum w:abstractNumId="a"><w:lvl w:ilvl="0"><w:numFmt w:val="upperLetter"/><w:start w:val="2"/><w:lvlText w:val="%1)"/></w:lvl></w:abstractNum><w:num w:numId="n"><w:abstractNumId w:val="a"/></w:num></w:numbering>';
		const doc = await parseDocx(await fixture(dir, paragraph("VALUE", numbered("n")), { "word/numbering.xml": numbering }));
		assert.match(serializeMD(doc), /B\) VALUE/);
		assert.ok(doc.warnings.some(w => w.code == "number-format"));
	}));

	test("keeps consecutive list restarts separate and reports orphan list levels", async () => withTempDir(async dir =>
	{
		const numbering = '<w:numbering><w:abstractNum w:abstractNumId="a"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/></w:lvl></w:abstractNum><w:num w:numId="a"><w:abstractNumId w:val="a"/></w:num><w:num w:numId="b"><w:abstractNumId w:val="a"/></w:num></w:numbering>';
		const input = await fixture(dir, paragraph("ONE", numbered("a")) + paragraph("TWO", numbered("a"))
			+ paragraph("RESTART", numbered("b")), { "word/numbering.xml": numbering });
		const reversed = await reverseDocx({ input });
		const parsed = await parseMD(reversed.filePath);
		assert.deepEqual(parsed.nodes.flatMap(n => n.type == "list" ? [n.startIndex] : []), [1, 1]);
		const orphan = await parseDocx(await fixture(dir, paragraph("ORPHAN", numbered("a", 1)), { "word/numbering.xml": numbering }, "orphan.docx"));
		assert.ok(orphan.warnings.some(w => w.code == "list-level"));
		assert.doesNotMatch(serializeMD(orphan), /^ {4}/m);
	}));

	test("reads alternate namespace prefixes and package relationship locations", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, "", {
			"_rels/.rels": '<Relationships><Relationship Id="main" Type="http://example/officeDocument" Target="/custom/body.xml"/></Relationships>',
			"custom/body.xml": '<x:document xmlns:x="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><x:body><x:p><x:r><x:t>ALTERNATE_PREFIX</x:t></x:r></x:p></x:body></x:document>',
		});
		assert.match((await inspectDocx({ input })).content, /ALTERNATE_PREFIX/);
	}));

	test("retains literal angle brackets, pipes and line breaks in table cells", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, `<w:tbl><w:tr><w:tc>${paragraph("HEADER")}</w:tc></w:tr><w:tr><w:tc>${paragraph("<br> &amp; | VALUE")}</w:tc></w:tr></w:tbl>`);
		const reverse = await reverseDocx({ input });
		const parsed = runifyDoc(await parseMD(reverse.filePath));
		const table = parsed.nodes.find(n => n.type == "table");
		assert.ok(table?.type == "table");
		const text = table.rows[1]?.flatMap(n => n.type == "text" ? n.text : []).map(r => r.text).join("");
		assert.equal(text, "<br> &amp; | VALUE");
	}));

	test("maps warnings to retained blocks and keeps unrepresentable code in comments", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, paragraph("```inner", style("ListingCode")) + "<w:tbl><w:tr><w:tc><w:p/></w:tc><w:tc><w:p><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p></w:tc><w:tc>" + paragraph("(1)") + "</w:tc></w:tr></w:tbl>");
		const doc = await parseDocx(input);
		assert.ok(doc.warnings.some(w => w.code == "code-fence"));
		assert.ok(doc.warnings.every(w => !w.block || doc.nodes.some(n => n.id == w.block)));
		assert.match(serializeMD(doc), /<!-- DOCX: Block \d+; edit code fence manually\n```inner/);
	}));

	test("escapes source text without executing directives, templates, references or math", async () => withTempDir(async dir =>
	{
		const values = ["!!rule text size 999", "!!(missing.md){}", "# Ordinary", "1. Plain", "- Plain", "[i#] {{missing}} $x$ **plain** _plain_ `plain` <tag> &amp;", "C:\\temp\\file", ":::note", "Literal <br> and <!-- comment -->", "https://example.test/a_b?q=1&v=2"];
		const input = await fixture(dir, values.map(value => paragraph(value)).join(""));
		const reversed = await reverseDocx({ input });
		const warnings: string[] = [];
		const parsed = await parseMD(reversed.filePath, {}, { allowIncludes: true }, false, undefined, message => warnings.push(message));
		assert.equal(parsed.text.size, 14);
		assert.ok(parsed.nodes.every(n => n.type == "text"));
		const runic = runifyDoc(parsed);
		assert.deepEqual(runic.nodes.map(n => n.type == "text" && n.text.map(r => r.text).join("")), values);
		assert.deepEqual(warnings, []);
	}));

	test("retains comment payloads reversibly without changing code or closing comments early", async () => withTempDir(async dir =>
	{
		const payload = "```inner\n--keep --force\n--i;\n<!-- nested -->\n--!>\n&lt; &amp; &#45; < >\n{{missing}}\n!!(missing.md){}";
		const input = await fixture(dir, paragraph(payload, style("ListingCode")) + paragraph("AFTER"));
		const result = await reverseDocx({ input });
		const markdown = await fs.readFile(result.filePath, "utf8");
		const inner = /<!-- DOCX: ([\s\S]*?) -->/.exec(markdown)?.[1];
		assert.ok(inner);
		assert.equal((markdown.match(/<!--/g) || []).length, 1);
		assert.equal((markdown.match(/-->/g) || []).length, 1);
		assert.ok(inner.includes("--keep --force\n--i;"));
		assert.doesNotMatch(inner, /[<>\u2014]/);
		const restored = inner.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
		assert.ok(restored.endsWith("\n" + payload));
		const warnings: string[] = [];
		const parsed = await parseMD(result.filePath, {}, { allowIncludes: true }, false, undefined, message => warnings.push(message));
		assert.deepEqual(warnings, []);
		assert.deepEqual(parsed.nodes.map(node => node.type == "text" && node.text), ["AFTER"]);
	}));

	test("imports captionless tables without consuming preceding prose and retains complex cell content", async () => withTempDir(async dir =>
	{
		const table = `<w:tbl><w:tr><w:tc>${paragraph("H1")}</w:tc><w:tc>${paragraph("H2")}</w:tc></w:tr>
<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr>${paragraph("A | B")}${paragraph("SECOND")}</w:tc></w:tr></w:tbl>`;
		const input = await fixture(dir, paragraph("INTRO") + table);
		const result = await reverseDocx({ input });
		assert.ok(result.warnings.some(w => w.code == "table"));
		const parsed = await parseMD(result.filePath);
		assert.ok(parsed.nodes.some(n => n.type == "text" && n.text == "INTRO"));
		assert.ok(parsed.nodes.some(n => n.type == "table" && n.title == "<br>"));
		const inspection = await inspectDocx({ input, format: "json" });
		assert.match(inspection.content, /A \| B/);
		assert.match(inspection.content, /SECOND/);
	}));

	test("extracts images safely, retains individual sizes and never overwrites existing assets", async () => withTempDir(async dir =>
	{
		const png = await fs.readFile(await writePng(dir));
		const picture = (id: string, width: number) => `<w:r><w:drawing><wp:inline><wp:extent cx="${width * 9525}" cy="${20 * 9525}"/><a:graphic><a:blip r:embed="${id}"/></a:graphic></wp:inline></w:drawing></w:r>`;
		const input = await fixture(dir, `<w:p>${picture("i1", 40)}${picture("i2", 60)}</w:p>` + paragraph("Рисунок 2 – RESULT"), {
			"word/_rels/document.xml.rels": '<Relationships><Relationship Id="i1" Type="http://example/image" Target="/word/media/first.png"/><Relationship Id="i2" Type="http://example/image" Target="media/second.jpeg"/></Relationships>',
			"word/media/first.png": png, "word/media/second.jpeg": png,
		});
		const before = await fs.readdir(dir);
		const inspection = JSON.parse((await inspectDocx({ input, format: "json" })).content);
		assert.deepEqual(await fs.readdir(dir), before);
		assert.ok(inspection.images.every((i: object) => !("data" in i)));
		assert.deepEqual(inspection.nodes.filter((n: DocxNode) => n.type == "image").map((n: any) => n.width), [40, 60]);
		const first = await reverseDocx({ input });
		assert.equal(first.images.length, 2);
		assert.match(first.images[1]!, /\.jpg$/);
		assert.deepEqual(await fs.readFile(first.images[0]!), png);
		await assert.rejects(reverseDocx({ input }), /already exists/);
		await fs.writeFile(first.images[0]!, "KEEP_EXISTING");
		const second = await reverseDocx({ input, overwrite: true });
		assert.notEqual(path.dirname(first.images[0]!), path.dirname(second.images[0]!));
		assert.equal(await fs.readFile(first.images[0]!, "utf8"), "KEEP_EXISTING");
		assert.match(await fs.readFile(second.filePath, "utf8"), /\{40x20\}[\s\S]*\{60x20\}/);
	}));

	test("warns about missing or external images and unsupported formulas without dropping surrounding text", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, `<w:p>${run("BEFORE")}<m:oMath><m:r><m:t>x+y</m:t></m:r></m:oMath>${run("AFTER")}</w:p>
<w:p><w:r><w:drawing><a:blip r:link="external"/></w:drawing></w:r></w:p>`, {
			"word/_rels/document.xml.rels": '<Relationships><Relationship Id="external" Type="http://example/image" Target="https://example.test/private.png" TargetMode="External"/></Relationships>',
		});
		const result = await reverseDocx({ input });
		assert.ok(result.warnings.some(w => w.code == "OMML"));
		assert.ok(result.warnings.some(w => w.code == "image"));
		const text = await fs.readFile(result.filePath, "utf8");
		assert.match(text, /BEFORE<!-- DOCX: OMML; x\+y -->AFTER/);
		assert.match(text, /!\[\]\(\)/);
		const doc = await parseDocx(input);
		assert.ok(doc.warnings.every(w => !w.block || doc.nodes.some(n => n.id == w.block)));
	}));

	test("recognizes a formula table and retains note content for manual conversion", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, "<w:tbl><w:tr><w:tc><w:p/></w:tc><w:tc><w:p><m:oMath><m:r><m:t>a+b</m:t></m:r></m:oMath></w:p></w:tc><w:tc>"
			+ paragraph("(3)") + '</w:tc></w:tr></w:tbl><w:p><w:r><w:footnoteReference w:id="4"/></w:r></w:p>', {
			"word/footnotes.xml": `<w:footnotes><w:footnote w:id="4">${paragraph("NOTE_CONTENT")}</w:footnote></w:footnotes>`,
		});
		const doc = await parseDocx(input);
		assert.ok(doc.nodes[0]?.type == "unsupported");
		assert.match(serializeMD(doc), /a\+b \(3\)/);
		assert.match(serializeInspection(doc), /NOTE_CONTENT/);
		assert.match(serializeMD(doc), /<!-- DOCX: footnote; NOTE_CONTENT -->/);
	}));

	test("replaces cached TOC entries with one content heading in either Word representation", async () => withTempDir(async dir =>
	{
		const toc = `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TOC \\o "1-3" </w:instrText><w:fldChar w:fldCharType="separate"/></w:r>${run("OLD_ENTRY_1")}</w:p>
${paragraph("OLD_ENTRY_2")}<w:p>${run("OLD_PAGE")}<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
		for (const body of [toc, `<w:sdt><w:sdtPr><w:alias w:val="Table of contents"/></w:sdtPr><w:sdtContent>${toc}</w:sdtContent></w:sdt>`])
		{
			const input = await fixture(dir, paragraph("СОДЕРЖАНИЕ", style("CustomHeading")) + body + paragraph("AFTER"));
			const doc = await parseDocx(input);
			const text = serializeMD(doc);
			assert.doesNotMatch(text, /OLD_ENTRY|OLD_PAGE/);
			assert.equal((text.match(/СОДЕРЖАНИЕ/g) || []).length, 1);
			assert.match(text, /^# СОДЕРЖАНИЕ$/m);
			const source = await writeMarkdown(dir, text, "contents.g.md");
			const parsed = await parseMD(source);
			enrichDoc(parsed);
			assert.ok(parsed.nodes.some(n => n.type == "tableOfContents"));
			assert.match(text, /AFTER/);
		}
	}));

	test("keeps a plain contents-named heading ordinary when no TOC field exists", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, paragraph("Содержание", '<w:outlineLvl w:val="0"/>') + paragraph("EXISTING_BODY"));
		const result = await reverseDocx({ input });
		assert.ok((await fs.readFile(result.filePath, "utf8")).includes(String.raw`# \Содержание`));
		const doc = await parseMD(result.filePath);
		enrichDoc(doc);
		assert.equal(doc.nodes.some(node => node.type == "tableOfContents"), false);
	}));

	test("does not expand already formatted special sections a second time", async () => withTempDir(async dir =>
	{
		const heading = (text: string) => paragraph(text, '<w:outlineLvl w:val="0"/>');
		const input = await fixture(dir, heading("РЕФЕРАТ") + paragraph("EXISTING_SYNOPSIS")
			+ heading("ТЕРМИНЫ И\u00a0ОПРЕДЕЛЕНИЯ") + paragraph("EXISTING_TERMS_INTRO")
			+ `<w:tbl><w:tr><w:tc>${paragraph("TERM")}</w:tc><w:tc>${paragraph("DEFINITION")}</w:tc></w:tr></w:tbl>`
			+ heading("ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ") + paragraph("EXISTING_ABBREVIATIONS"));
		const result = await reverseDocx({ input });
		const doc = await parseMD(result.filePath);
		const markdown = await fs.readFile(result.filePath, "utf8");
		assert.ok(markdown.replaceAll("\u00a0", " ").includes(String.raw`# \ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ`));
		assert.doesNotMatch(markdown, /# \*\*/);
		assert.ok(doc.nodes.filter(node => node.type == "title").every(node => node.notSpecial === true));
		const warnings: string[] = [];
		enrichDoc(doc, message => warnings.push(message));
		assert.deepEqual(warnings, []);
		assert.equal(doc.nodes.filter(n => n.tags?.includes("synopsis")).length, 0);
		const runic = runifyDoc(doc);
		assert.ok(runic.nodes.some(n => n.type == "title" && n.text.map(r => r.text).join("").replace(/\s+/g, " ") == "ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ"));
		assert.equal(doc.nodes.filter(n => n.type == "table").length, 1);
		const rendered = await render({ file: result.filePath, assets: path.resolve(__dirname, "../../assets"), disableMacros: true, loginfo() {} });
		const document = xml(openDocx(rendered.fout), "word/document.xml");
		assert.doesNotMatch(document, /\\(?:РЕФЕРАТ|ТЕРМИНЫ|ПЕРЕЧЕНЬ)/);
		assert.equal((document.match(/<w:pStyle w:val="1"\/>/g) || []).length, 3);
	}));

	test("preserves documents through reverse and a fresh md2gost render without Office", async () => withTempDir(async dir =>
	{
		await writePng(dir);
		const input = await writeMarkdown(dir, "# 1 SECTION_MARKER\n\nBODY_MARKER **bold**.\n\n```text Листинг 1 – CODE_TITLE\n  CODE_MARKER\n\tNEXT_LINE\n```\n\nТаблица 1 – TABLE_TITLE\n| H1 | H2 |\n|--|--|\n| CELL_MARKER | 2 |\n\n![Рисунок 1 – IMAGE_TITLE](image.PNG){40x20}");
		const rendered = await render({ file: input, assets: path.resolve(__dirname, "../../assets"), disableMacros: true, loginfo() {} });
		const reverse = await reverseDocx({ input: rendered.fout, output: path.join(dir, "reversed.g.md") });
		const text = await fs.readFile(reverse.filePath, "utf8");
		assert.match(text, / {2}CODE_MARKER\n\tNEXT_LINE/);
		assert.equal(reverse.images.length, 1);
		const rerendered = await render({ file: reverse.filePath, assets: path.resolve(__dirname, "../../assets"), disableMacros: true, loginfo() {} });
		const document = xml(openDocx(rerendered.fout), "word/document.xml");
		for (const marker of ["SECTION_MARKER", "BODY_MARKER", "CODE_MARKER", "CELL_MARKER", "IMAGE_TITLE", "TABLE_TITLE"]) assert.ok(document.includes(marker), marker);
		assert.deepEqual(reverse.warnings, []);
	}));

	test("rejects broken documents, invalid formats, overwrites and cancelled work", async () => withTempDir(async dir =>
	{
		const input = await fixture(dir, paragraph("VALUE"));
		const controller = new AbortController();
		controller.abort();
		await assert.rejects(parseDocx(input, controller.signal), /abort/i);
		await assert.rejects(inspectDocx({ input, format: "bad" as "text" }), /format/);
		await assert.rejects(reverseDocx({ input, output: input, overwrite: true }), /differ/);
		await assert.rejects(reverseDocx({ input, output: path.join(dir, "bad.md") }), /\.g\.md/);
		await fs.writeFile(input, "NOT_A_ZIP");
		await assert.rejects(parseDocx(input), /archive/);
		const invalid = await fixture(dir, "", { "word/document.xml": "<w:document>" });
		await assert.rejects(parseDocx(invalid), /XML|body/);
	}));
});
