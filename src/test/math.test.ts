import * as assert from "node:assert/strict";
import { Document, Packer, Paragraph, type ParagraphChild } from "docx";
import PizZip from "pizzip";
import { latexToOmml } from "../math";

async function mathXml(latex: string): Promise<string>
{
	const doc = new Document({ sections: [{ children: [new Paragraph({ children: [latexToOmml(latex) as ParagraphChild] })] }] });
	const zip = new PizZip(await Packer.toBuffer(doc));
	return zip.file("word/document.xml")!.asText().match(/<m:oMath>.*?<\/m:oMath>/)![0];
}

suite("math parser regressions", () =>
{
	test("ignores math whitespace around arguments and scripts", async () =>
	{
		assert.equal(await mathXml(String.raw`\frac {a _ i ^ 2} {\sqrt [3] {b}}`), await mathXml(String.raw`\frac{a_i^2}{\sqrt[3]{b}}`));
		assert.equal(await mathXml(String.raw`\sum _ {i=1} ^ n x _ i`), await mathXml(String.raw`\sum_{i=1}^n x_i`));
	});

	test("preserves text spaces including nested groups", async () =>
	{
		const xml = await mathXml(String.raw`\text{if {x is} positive }`);
		assert.equal((xml.match(/<m:t xml:space="preserve"> <\/m:t>/g) || []).length, 4);
	});

	test("handles nested scalable and invisible delimiters", async () =>
	{
		const xml = await mathXml(String.raw`\left\{\frac{1}{\left(x+1\right)}\right.`);
		assert.equal((xml.match(/<m:d>/g) || []).length, 2);
		assert.ok(xml.includes('<m:begChr m:val="{"/>'));
		assert.ok(xml.includes('<m:endChr m:val=""/>'));
	});

	test("keeps nested matrices and escaped ampersands inside their cells", async () =>
	{
		const xml = await mathXml(String.raw`\begin{pmatrix}\begin{matrix}a&b\\c&d\end{matrix}&\text{A\&B}\\e&f\\\end{pmatrix}`);
		assert.equal((xml.match(/<m:m>/g) || []).length, 2);
		assert.equal((xml.match(/<m:mr>/g) || []).length, 4);
		assert.ok(xml.includes("&amp;"));
	});

	test("hides absent limits and respects explicit limit placement", async () =>
	{
		const integral = await mathXml(String.raw`\int x \,dx`);
		assert.ok(integral.includes('<m:subHide m:val="1"/>'));
		assert.ok(integral.includes('<m:supHide m:val="1"/>'));
		const sum = await mathXml(String.raw`\sum\nolimits_{i=0}^{n} x_i`);
		assert.ok(sum.includes('<m:limLoc m:val="subSup"/>'));
		assert.ok(!sum.includes("\u2063"));
		assert.ok(!(await mathXml(String.raw`\lim x`)).includes("m:limLow"));
		assert.ok((await mathXml(String.raw`\lim\nolimits_{x\to 0} x`)).includes("<m:sSub>"));
		assert.equal(await mathXml(String.raw`\displaystyle x\!y`), await mathXml("xy"));
	});

	test("retains mathematical alphabets", async () =>
	{
		const xml = await mathXml(String.raw`\mathbb{R}+\mathcal{F}`);
		assert.ok(xml.includes('<m:scr m:val="double-struck"/>'));
		assert.ok(xml.includes('<m:scr m:val="script"/>'));
	});

	test("rejects missing arguments, duplicate scripts and unbalanced groups", () =>
	{
		for (const source of [String.raw`\frac{a}`, "x^", "x_1_2", "x}", "{x", String.raw`\left(x`, String.raw`\right)`, String.raw`\begin{matrix}a\end{pmatrix}`])
		{
			assert.throws(() => latexToOmml(source), Error, source);
		}
	});
});
