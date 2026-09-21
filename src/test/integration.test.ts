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
});
