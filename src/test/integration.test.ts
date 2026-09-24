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
});
