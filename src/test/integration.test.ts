import * as assert from "node:assert/strict";
import * as path from "node:path";
import { alchemist } from "../alchemist";
import { enrichDoc } from "../enricher";
import { parseMD, runifyDoc } from "../parser";
import { serializeDocx } from "../serializer";
import { openDocx, xml } from "./helpers/docx";
import { withTempDir, writeMarkdown, writePng } from "./helpers/fixtures";

suite("main logic integration", () =>
{
	test("exports section numbers from second-level headings and keeps reference prefixes through appendices", async () => withTempDir(async dir =>
	{
		await writePng(dir, "figure.png");
		const objects = (id: string) => [
			`![[image_${id}] Figure](figure.png){20}`, "",
			`[table_${id}] Data`, "", "| Name | Value |", "|---|---|", "| Item | 1 |", "",
			`\`\`\`text [code_${id}] Code`, "CODE_CONTENT", "```", "",
			`[formula_${id}]`, "$$", "x = 1", "$$", "",
		];
		const input = await writeMarkdown(dir, [
			"!!rule numbering sections", "!!rule numbering lazy", "",
			"# СОДЕРЖАНИЕ", "", "# ВВЕДЕНИЕ", "",
			"First: [#], [i#]. Last: [image_last], [table_last], [code_last], [formula_last]. Appendix: [appendix_image].", "",
			"# ХОД РАБОТЫ", "", "## 3. Реализация [i#]", "",
			...objects("first"),
			"### 3.1. Проверка", "", "![Within subsection](figure.png){20}", "",
			"Next: [#], [i#]. Previous: [#-1], [i#-1].", "",
			"## 7. Испытания", "", ...objects("last"),
			"# ЗАКЛЮЧЕНИЕ", "", "Completed.", "",
			"# ПРИЛОЖЕНИЯ", "", "## [app] Appendix", "",
			"![[appendix_image] Appendix](figure.png){20}",
		].join("\n"));
		const doc = await parseMD(input);
		enrichDoc(doc);
		const warnings: string[] = [];
		const runic = runifyDoc(doc);
		alchemist(runic, warning => warnings.push(warning));
		const output = path.join(dir, "section-numbers.docx");
		await serializeDocx(runic, output, dir, path.resolve(process.cwd(), "assets"), dir, warning => warnings.push(warning));
		const document = xml(openDocx(output), "word/document.xml");
		const text = document.replace(/<[^>]+>/g, "").replaceAll("\u00a0", " ");
		for (const expected of [
			"First: 3.1, 3.1. Last: 7.1, 7.1, 7.1, 7.1. Appendix: А.1.",
			"3. Реализация 3.1", "Рисунок 3.1 – Figure", "Рисунок 3.2 – Within subsection",
			"Next: 7.1, 7.1. Previous: 3.2, 3.2.", "Рисунок 7.1 – Figure", "Рисунок А.1 – Appendix",
			"Таблица 3.1 – Data", "Листинг 3.1 – Code", "(3.1)",
			"Таблица 7.1 – Data", "Листинг 7.1 – Code", "(7.1)",
		]) assert.ok(text.includes(expected), expected);
		assert.deepEqual(warnings, []);
	}));

	test("exports number-only captions without dashes and retains named references", async () => withTempDir(async dir =>
	{
		await writePng(dir, "figure.png");
		const input = await writeMarkdown(dir, [
			"!!rule numbering lazy", "",
			"See figure [figure], table [data], and listing [listing].", "",
			"![[figure]](figure.png){20}", "",
			"[data]", "", "| Name | Value |", "|---|---|", "| TABLE_CONTENT | 1 |", "",
			"```text [listing]", "LISTING_CONTENT", "```", "",
			"Again: [figure], [data], [listing].",
		].join("\n"));
		const doc = await parseMD(input);
		enrichDoc(doc);
		const runic = runifyDoc(doc);
		const warnings: string[] = [];
		alchemist(runic, warning => warnings.push(warning));
		const output = path.join(dir, "number-only.docx");
		await serializeDocx(runic, output, dir, path.resolve(process.cwd(), "assets"), dir, warning => warnings.push(warning));
		const document = xml(openDocx(output), "word/document.xml");
		const text = document.replace(/<[^>]+>/g, "").replaceAll("\u00a0", " ");
		for (const caption of ["Рисунок 1", "Таблица 1", "Листинг 1"])
		{
			assert.ok(text.includes(caption), caption);
			assert.ok(!text.includes(caption + " –"), caption);
		}
		for (const expected of ["See figure 1, table 1, and listing 1.", "Again: 1, 1, 1.", "TABLE_CONTENT", "LISTING_CONTENT"])
			assert.ok(text.includes(expected), expected);
		assert.deepEqual(warnings, []);
	}));

	for (const lazy of [false, true])
		for (const separate of [false, true])
			test(`preserves an introduction before a captionless table (lazy=${lazy}, separate=${separate})`, async () => withTempDir(async dir =>
			{
				const input = await writeMarkdown(dir, [
					...(lazy ? ["!!rule numbering lazy", ""] : []),
					"INTRO_KEEP", "", "<br>", ...(separate ? [""] : []),
					"| Name | Value |", "|---|---|", "| first | 1 |", "",
					"AFTER_TABLE", "", "[named] Named caption<br>continued", "",
					"| Name | Value |", "|---|---|", "| second | 2 |", "",
					"See table [named]. Total [!tables].",
				].join("\n"));
				const warnings: string[] = [];
				const doc = await parseMD(input);
				assert.ok(doc.nodes.some(node => node.type == "text" && node.text == "INTRO_KEEP"));
				enrichDoc(doc);
				const runic = runifyDoc(doc);
				alchemist(runic, warning => warnings.push(warning));
				const tables = runic.nodes.filter(node => node.type == "table");
				assert.equal(tables.length, 2);
				assert.ok(tables[0]!.title?.every(rune => !rune.text.trim()));
				assert.equal(tables[1]!.title?.map(rune => rune.text).join(""), "Таблица 2 – Named captioncontinued");
				const output = path.join(dir, "captionless-table.docx");
				await serializeDocx(runic, output, dir, path.resolve(process.cwd(), "assets"), dir, warning => warnings.push(warning));
				const document = xml(openDocx(output), "word/document.xml");
				const text = document.replace(/<[^>]+>/g, "").replaceAll("\u00a0", " ");
				for (const expected of ["INTRO_KEEP", "AFTER_TABLE", "first", "second", "Таблица 2", "See table 2. Total 2."])
					assert.ok(text.includes(expected), expected);
				assert.ok(!text.includes("Таблица 1"));
				assert.equal((document.match(/<w:pStyle w:val="TableCaption"\/>/g) ?? []).length, 1);
				assert.deepEqual(warnings, []);
			}));

	test("preserves missing image captions and references while exporting available images", async () => withTempDir(async dir =>
	{
		await writePng(dir, "figure.png");
		const input = await writeMarkdown(dir, [
			"!!rule numbering lazy", "",
			"См. рисунки [i#], [i#+1] и [i#+2]. Всего [!imgs].", "",
			"![Пустой путь]()", "",
			"![Отсутствующий файл](missing.png)", "",
			"![Готовый рисунок](figure.png){20x}", "",
			"После рисунков.",
		].join("\n"));
		const warnings: string[] = [];
		const doc = await parseMD(input);
		enrichDoc(doc);
		const runic = runifyDoc(doc);
		alchemist(runic, warning => warnings.push(warning));
		const output = path.join(dir, "missing-images.docx");
		await serializeDocx(runic, output, dir, path.resolve(process.cwd(), "assets"), dir, warning => warnings.push(warning));
		assert.deepEqual(warnings, ["Line 5: Image path is empty", 'Line 7: Image file not found: "missing.png"']);
		const zip = openDocx(output);
		const document = xml(zip, "word/document.xml");
		const text = document.replace(/<[^>]+>/g, "").replaceAll("\u00a0", " ");
		assert.ok(text.includes("См. рисунки 1, 2 и 3. Всего 3."));
		assert.ok(text.includes("Рисунок 1 – Пустой путь"));
		assert.ok(text.includes("Рисунок 2 – Отсутствующий файл"));
		assert.ok(text.includes("Рисунок 3 – Готовый рисунок"));
		assert.ok(text.includes("После рисунков."));
		assert.equal((document.match(/<w:drawing>/g) || []).length, 1);
		assert.equal(zip.file(/^word\/media\/[^/]+$/).length, 1);
	}));

	test("builds a valid DOCX report from Markdown through all core stages", async () => withTempDir(async dir =>
	{
		await writePng(dir, "figure.png");
		const input = await writeMarkdown(dir, "!!rule title Integration\n!!rule author Tester\n# ВВЕДЕНИЕ\ntext [figure]\n\n![Рисунок [figure] – sample](figure.png){20x}\n\nTable\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts Listing [code]\nconst x = 1;\n```");
		const doc = await parseMD(input);
		doc.etime = 10;
		doc.ctime = new Date("2020-01-01T00:00:00.000Z");
		doc.mtime = new Date("2020-01-01T00:00:00.000Z");
		assert.ok(doc.nodes.some(n => n.type == "image"));
		enrichDoc(doc);
		const runic = runifyDoc(doc);
		alchemist(runic);
		assert.ok((runic.nodes.find(n => n.type == "image") as any).text.some((r: any) => r.text.includes("Рисунок 1")));
		const output = path.join(dir, "integration.docx");
		await serializeDocx(runic, output, dir, path.resolve(process.cwd(), "assets"), dir);
		const zip = openDocx(output);
		assert.ok(xml(zip, "word/document.xml").includes("Рисунок 1"));
		assert.ok(xml(zip, "docProps/core.xml").includes("Integration"));
	}));

	test("numbers formulas and writes native OMML", async () => withTempDir(async dir =>
	{
		const input = await writeMarkdown(dir, "!!rule numbering sections\n# One\nSee [energy]. [!formulas]\n[energy]\n$$\n\\frac{a_1}{\\sqrt{b}} = \\sum_{i=1}^{n} x_i\n$$");
		const runic = runifyDoc(await parseMD(input));
		alchemist(runic);
		assert.equal((runic.nodes.find(node => node.type == "math") as any).title.map((r: any) => r.text).join(""), "(1.1)");
		assert.ok((runic.nodes.find(node => node.type == "text") as any).text.some((r: any) => r.text == "1.1"));
		assert.ok((runic.nodes.find(node => node.type == "text") as any).text.some((r: any) => r.text == "1"));
		const output = path.join(dir, "formulas.docx");
		await serializeDocx(runic, output, dir, path.resolve(process.cwd(), "assets"), dir);
		const document = xml(openDocx(output), "word/document.xml");
		assert.ok(document.includes("m:oMath"));
		assert.ok(document.includes("m:f"));
		assert.ok(document.includes("m:rad"));
		assert.ok(document.includes("1.1"));
	}));

	test("preserves appendix headings and forward and backward references through DOCX export", async () => withTempDir(async dir =>
	{
		await writePng(dir, "figure.png");
		const input = await writeMarkdown(dir, "!!rule numbering sections on\n# [main] Main\n\nСм. приложение [app] и рисунок [cat].\n\n# ПРИЛОЖЕНИЯ\n\n## [app] Graphic [cat]\n\n![[cat] Cat](figure.png){20x}\n\nПриложение [app].");
		const warnings: string[] = [];
		const doc = await parseMD(input);
		enrichDoc(doc);
		const runic = runifyDoc(doc);
		alchemist(runic, warning => warnings.push(warning));
		const heading = runic.nodes.find(node => node.type == "title" && node.text.some(rune => rune.text.startsWith("ПРИЛОЖЕНИЕ")));
		assert.ok(heading?.type == "title");
		assert.equal(heading.text.map(rune => rune.text).join(""), "ПРИЛОЖЕНИЕ\u00a0А");
		const text = runic.nodes.filter(node => node.type == "text").map(node => node.text.map(rune => rune.text).join("").replaceAll("\u00a0", " "));
		assert.ok(text.includes("См. приложение А и рисунок А.1."));
		assert.ok(text.includes("Приложение А."));
		assert.ok(text.some(value => value.trim() == "Graphic А.1"));
		assert.deepEqual(warnings, []);
		const output = path.join(dir, "appendix-references.docx");
		await serializeDocx(runic, output, dir, path.resolve(process.cwd(), "assets"), dir);
		const document = xml(openDocx(output), "word/document.xml");
		assert.ok(document.includes("ПРИЛОЖЕНИЕ\u00a0А"));
		assert.equal(document.includes("А-1"), false);
	}));

	for (const [name, rules, space] of [
		["reference spaces disabled", "!!rule typography nbsp references off", " "],
		["all spaces disabled", "!!rule typography nbsp off", " "],
		["reference spaces re-enabled", "!!rule typography nbsp off\n!!rule typography nbsp references on", "\u00a0"],
	])
		test(`respects ${name} in appendix headings`, async () => withTempDir(async dir =>
		{
			const input = await writeMarkdown(dir, `${rules}\n!!rule numbering autoprefix off\n\n# ПРИЛОЖЕНИЯ\n\n## [a] First\n\nFirst appendix.\n\n## [b] Second\n\nSecond appendix.`);
			const doc = await parseMD(input);
			enrichDoc(doc);
			const runic = runifyDoc(doc);
			alchemist(runic);
			const headings = runic.nodes.flatMap(node => node.type == "title" && node.level == 1 ? [node.text.map(rune => rune.text).join("")] : []);
			assert.deepEqual(headings, [`ПРИЛОЖЕНИЕ${space}А`, `ПРИЛОЖЕНИЕ${space}Б`]);
			const output = path.join(dir, "appendix-spacing.docx");
			await serializeDocx(runic, output, dir, path.resolve(process.cwd(), "assets"), dir);
			const document = xml(openDocx(output), "word/document.xml");
			assert.ok(document.includes(`ПРИЛОЖЕНИЕ${space}А`));
			assert.ok(document.includes(`ПРИЛОЖЕНИЕ${space}Б`));
		}));

	test("uses a manually supplied formula number without changing counter behavior", async () => withTempDir(async dir =>
	{
		const input = await writeMarkdown(dir, "(А.1)\n$$\nE = mc^2\n$$\n[id]\n$$\nx = 1\n$$");
		const runic = runifyDoc(await parseMD(input));
		alchemist(runic);
		const formulas = runic.nodes.filter(node => node.type == "math") as any[];
		assert.equal(formulas[0].title.map((r: any) => r.text).join(""), "(А.1)");
		assert.equal(formulas[1].title.map((r: any) => r.text).join(""), "(2)");
		const output = path.join(dir, "manual-formula-number.docx");
		await serializeDocx(runic, output, dir, path.resolve(process.cwd(), "assets"), dir);
		assert.ok(xml(openDocx(output), "word/document.xml").includes("(А.1)"));
	}));

	test("renders limits, large operators, matrices, cases, styles and math spacing without placeholders", async () => withTempDir(async dir =>
	{
		const input = await writeMarkdown(dir, String.raw`$$
x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}
$$
$$
f'(x) = \lim_{h \to 0} \frac{f(x+h) - f(x)}{h}
$$
$$
\int_{-\infty}^{\infty} e^{-x^2} \,dx = \sqrt{\pi}
$$
$$
\sum_{n=1}^{\infty} \frac{1}{n^2} = \frac{\pi^2}{6}
$$
$$
\mathbf{A} = \begin{pmatrix} a & b \\ c & d \end{pmatrix}
$$
$$
|x| = \begin{cases} x & \text{if } x \ge 0 \\ -x & \text{if } x < 0 \end{cases}
$$
$$
\overline{AB} + \underline{x} + \hat{x} + \widehat{xyz} + \vec{v}
$$`);
		const output = path.join(dir, "math-structures.docx");
		await serializeDocx(runifyDoc(await parseMD(input)), output, dir, path.resolve(process.cwd(), "assets"), dir);
		const document = xml(openDocx(output), "word/document.xml");
		assert.ok(document.includes("<m:limLow>"));
		const nary = document.match(/<m:nary>.*?<\/m:nary>/g) || [];
		assert.equal(nary.length, 2);
		assert.ok(nary[0]?.includes("<m:e><m:sSup>"));
		assert.ok(nary[1]?.includes("<m:e><m:f>"));
		assert.ok(document.includes('<m:begChr m:val="("/>'));
		assert.ok(document.includes('<m:endChr m:val=")"/>'));
		assert.ok(document.includes('<m:begChr m:val="{"/>'));
		assert.ok(document.includes('<m:endChr m:val=""/>'));
		assert.ok(document.includes('<m:sty m:val="b"/>'));
		assert.ok(document.includes('<m:sty m:val="p"/>'));
		assert.equal((document.match(/<m:bar>/g) || []).length, 2);
		assert.equal((document.match(/<m:acc>/g) || []).length, 3);
		assert.ok(document.includes('<m:chr m:val="̂"/>'));
		assert.ok(document.includes('<m:chr m:val="⃗"/>'));
		assert.ok(!document.includes("<m:e/>") && !document.includes("<m:e></m:e>"));
		assert.ok(!/<m:t[^>]*>,<\/m:t>/.test(document));
		assert.ok(!document.includes("\u2063"));
	}));
});
