import * as assert from "node:assert/strict";
import Module from "node:module";
import MarkdownIt from "markdown-it";
import type * as Formatter from "../formatter";
import type * as Preview from "../markdownPlugin";
import type * as IntelliSense from "../intellisense";

// Exercise editor integrations in Node without requiring a running extension host.
const settings: Record<string, unknown> = {};
class Range
{
	constructor(public start: { line: number; character: number }, public end: { line: number; character: number }) { }
}
const stub = {
	Range,
	CompletionItem: class
	{
		constructor(public label: unknown, public kind: unknown) { }
	},
	CompletionItemKind: { Constant: 1, Snippet: 2, Reference: 3 },
	MarkdownString: class
	{
		constructor(public value = "") { }
		appendCodeblock(value: string) { this.value += value; return this; }
		appendMarkdown(value: string) { this.value += value; return this; }
	},
	Hover: class
	{
		constructor(public contents: unknown) { }
	},
	TextEdit: { replace: (range: Range, newText: string) => ({ range, newText }) },
	workspace: { getConfiguration: () => ({ get: (key: string, fallback?: unknown) => settings[key] ?? fallback }) },
	window: {},
};
const loader = Module as any;
const originalLoad = loader._load;
let formatter: typeof Formatter;
let preview: typeof Preview;
let intellisense: typeof IntelliSense;
try
{
	loader._load = function (name: string, ...args: any[])
	{
		return name == "vscode" ? stub : originalLoad.call(this, name, ...args);
	};
	formatter = require("../formatter");
	preview = require("../markdownPlugin");
	intellisense = require("../intellisense");
}
finally { loader._load = originalLoad; }

async function format(source: string, fileName = "test.g.md", selection?: [number, number])
{
	const lines = source.split("\n");
	const offset = (position: { line: number; character: number }) => lines.slice(0, position.line).reduce((sum, line) => sum + line.length + 1, 0) + position.character;
	const document: any = {
		fileName, lineCount: lines.length,
		lineAt: (line: number) => ({ text: lines[line]!, range: new Range({ line, character: 0 }, { line, character: lines[line]!.length }) }),
		getText: (range?: Range) => range ? source.slice(offset(range.start), offset(range.end)) : source,
	};
	const [first, last] = selection || [0, lines.length - 1];
	const range = new Range({ line: first, character: 0 }, { line: last, character: lines[last]!.length });
	const edits = await formatter.md_formatter(document, range as any, { insertSpaces: true, tabSize: 4 }, { isCancellationRequested: false } as any);
	for (const edit of [...edits].sort((a, b) => offset(b.range.start) - offset(a.range.start)))
		source = source.slice(0, offset(edit.range.start)) + edit.newText + source.slice(offset(edit.range.end));
	return source;
}

suite("editor integrations", () =>
{
	setup(() =>
	{
		for (const key of Object.keys(settings)) delete settings[key];
		settings["formatter.replaceEmDash"] = true;
	});

	test("completes the NBSP block, its groups and the common switch", () =>
	{
		const complete = (text: string) => intellisense.md_completion({ lineAt: () => ({ text, range: { end: { line: 0, character: text.length } } }) } as any, { line: 0, character: text.length } as any) || [];
		assert.ok(complete("!!rule typography ").some(item => item.insertText == "nbsp "));
		const choices = complete("!!rule typography nbsp ");
		assert.ok(choices.some(item => item.insertText == "units on"));
		assert.ok(choices.some(item => item.insertText == "references on"));
		assert.ok(choices.some(item => item.insertText == "on"));
		assert.ok(choices.some(item => item.insertText == "off"));
		assert.deepEqual(complete("!!rule typography nbsp units ").map(item => item.insertText), ["on", "off"]);
		assert.deepEqual(complete("!!rule link underline ").map(item => item.insertText), ["on", "off"]);
		assert.deepEqual(complete("!!rule numbering lazy ").map(item => item.insertText), ["on", "off"]);
		assert.ok(complete("!!rule admonition note spacing ").some(item => item.insertText == "before 8"));
	});

	test("offers one shared font rule for listings and inline monospace", () =>
	{
		const complete = (text: string) => intellisense.md_completion({ lineAt: () => ({ text, range: { end: { line: 0, character: text.length } } }) } as any, { line: 0, character: text.length } as any) || [];
		const font = complete("!!rule code text ").find(item => item.insertText == "font Courier New");
		assert.ok(font);
		assert.match((font.documentation as { value: string }).value, /backtick_mono on/);
		assert.ok(!complete("!!rule backtick_mono ").some(item => String(item.insertText).startsWith("font")));
	});

	test("completes listing line spacing and provides its hover help", () =>
	{
		const text = "!!rule code text ";
		const items = intellisense.md_completion({ lineAt: () => ({ text, range: { end: { line: 0, character: text.length } } }) } as any, { line: 0, character: text.length } as any) || [];
		assert.ok(items.some(item => item.insertText == "line_spacing 1"));
		const rule = "!!rule code text line_spacing 1.25";
		const help = intellisense.md_hover({ lineAt: () => ({ text: rule }) } as any, { line: 0, character: rule.length } as any)!;
		assert.match((help.contents as any).value, /Межстрочный интервал|межстрочный интервал/);
		assert.match((help.contents as any).value, /По умолчанию: `1`/);
	});

	test("uses the specific group's hover instead of the common switch", () =>
	{
		const hover = (text: string) => intellisense.md_hover({ lineAt: () => ({ text }) } as any, { line: 0, character: text.length } as any);
		const units = hover("!!rule typography nbsp units off")!;
		assert.ok((units.contents as any).value.includes("10 кг"));
		assert.equal((units.contents as any).value.includes("отключает все восемь"), false);
		assert.ok((hover("!!rule typography nbsp off")!.contents as any).value.includes("все восемь"));
	});

	test("completes plain and typed relative references", () =>
	{
		const complete = (source: string, character = source.length) =>
		{
			const position = { line: 0, character, translate: (line: number, shift: number) => ({ line, character: character + shift }) };
			return intellisense.md_completion({ lineAt: () => ({ text: source, range: { end: position } }) } as any, position as any) || [];
		};
		assert.deepEqual(complete("See [").map(item => item.insertText), ["[#]", "[i#]", "[t#]", "[c#]", "[f#]"]);
		assert.deepEqual(complete("See [#").map(item => item.insertText), ["[#]"]);
		assert.deepEqual((complete("See []", 5)[0]!.range as Range).end, { line: 0, character: 6 });
		const choices = complete("See [t");
		assert.deepEqual(choices.map(item => item.insertText), ["[t#]"]);
		assert.deepEqual((choices[0]!.range as Range).start, { line: 0, character: 4 });
		assert.deepEqual((choices[0]!.range as Range).end, { line: 0, character: 6 });
		assert.deepEqual((complete("See [t]", 6)[0]!.range as Range).end, { line: 0, character: 7 });
		assert.deepEqual((complete("See [t#]", 6)[0]!.range as Range).end, { line: 0, character: 8 });
		assert.equal(complete("See \\[i").length, 0);
		assert.equal(complete("See \\[#").length, 0);
	});

	test("formatting preserves fenced code in lists, quotes and longer fences", async () =>
	{
		const blocks = [
			"```js\nconst x = 'A—B';\n```",
			"```js Caption with `inline code`\nconst x = 'A—B';\n```",
			"  ```js\n  const x = 'A—B';\n  ```",
			"- item\n\n    ```js\n    if (true) {\n        const x = 'A—B';\n    }\n    ```",
			"- item\n  - nested\n\n    ```js\n    const x = 'A—B';\n    ```",
			"1. item\n\n   ~~~js\n   const x = 'A—B';\n   ~~~",
			"- ```js\n  const x = 'A—B';\n  ```",
			"- item\n\n\t```js\n\tconst x = 'A—B';\n\t```",
			"> ```js\n> const x = 'A—B';\n> ```",
			"````md\n```js\nA—B\n```\n````",
			"~~~md\n```\nA—B\n~~~not a closer\nA—B\n~~~~",
		];
		for (const block of blocks)
		{
			const result = await format(`Before — text\n\n${block}\n\nAfter — text`);
			assert.equal(result, `Before – text\n\n${block}\n\nAfter – text`, block);
			assert.equal(await format(result), result);
		}
	});

	test("formatting keeps list numbering across a nested code block", async () =>
	{
		const block = "    ```\n    if (true) {\n        A—B\n    }\n    ```";
		const source = `1. First — item\n\n${block}\n\n9. Next — item`;
		assert.equal(await format(source), `1. First – item\n\n${block}\n\n2. Next – item`);
	});

	test("formatting protects code when a selection starts inside it", async () =>
	{
		const source = "Before — text\n\n```\nA—B\n```\n\nAfter — text";
		assert.equal(await format(source, "test.g.md", [3, 3]), source);
		const unclosed = "Before — text\n\n```\nA—B\n\nMore—code";
		assert.equal(await format(unclosed), unclosed.replace("Before — text", "Before – text"));
		assert.equal(await format("```A—B``` text —", "readme.md"), "```A—B``` text –");
		const list = "1. First — item\n9. Next — item";
		assert.equal(await format(list, "test.g.md", [0, 0]), "1. First – item\n9. Next — item");
	});

	test("formatting does not consume code blocks through table or special-section scans", async () =>
	{
		const block = "```\nA—B\n| code | value |\n|---|---|\n```";
		for (const prefix of ["| Head |\n|---|\n| Cell |", "# РЕФЕРАТ", "# Список литературы"])
		{
			const result = await format(`${prefix}\n${block}\n\n# Next\nAfter — text`);
			assert.ok(result.includes(block), result);
			assert.ok(result.endsWith("After – text"));
			assert.equal(await format(result), result);
		}
	});

	test("formatting protects inline code with mixed backtick lengths and line breaks", async () =>
	{
		for (const code of ["`A—B`", "`one `` A—B`", "``one ``` A—B``", "``<tag>—value``"])
		{
			const source = `# Heading — ${code}\n\n- Text — ${code}\n\n| Head |\n|---|\n| Text — ${code} |`;
			const result = await format(source);
			assert.equal(result.split(code).length, 4, result);
			assert.ok(!result.includes("Text —"));
			assert.equal(await format(result), result);
		}
		const multiline = "Text `first\nA—B\nlast` text";
		assert.equal(await format(multiline), multiline);
		assert.equal(await format(multiline, "test.g.md", [1, 1]), multiline);
		assert.equal(await format("# РЕФЕРАТ\n`lower—case` слова."), "# РЕФЕРАТ\n`lower—case` СЛОВА");
		assert.equal(await format("!!rule  title `A  B—C`"), "!!rule title `A  B—C`");
	});

	test("formatting preserves URLs, inline code, bibliography dashes, and escaped headings", async () =>
	{
		const input = "\\# Содержание\n# Содержание\nТекст — https://example.test/foo—bar [ссылка — текст](../foo—bar.docx) `foo—bar`\n# Список литературы\n[book] Источник — описание\n# Раздел\nТекст — текст";
		const result = await format(input);
		assert.ok(result.includes("\\# Содержание\n# СОДЕРЖАНИЕ"));
		assert.ok(result.includes("Текст – https://example.test/foo—bar [ссылка – текст](../foo—bar.docx) `foo—bar`"));
		assert.ok(result.includes("# СПИСОК ЛИТЕРАТУРЫ\n[book] Источник — описание"));
		assert.ok(result.endsWith("Текст – текст"));
		assert.equal(await format(result), result);
	});

	test("formatting retains escaped section names without applying their special formatting", async () =>
	{
		const source = String.raw`# \реферат` + "\nКлючевые слова.\n" + String.raw`# \Список литературы` + "\n[book] Источник — описание\n" + String.raw`# \\РЕФЕРАТ`;
		const result = await format(source);
		assert.ok(result.startsWith(String.raw`# \реферат` + "\nКлючевые слова."));
		assert.ok(result.includes(String.raw`# \Список литературы`));
		assert.ok(result.includes("Источник – описание"));
		assert.ok(result.endsWith(String.raw`# \\РЕФЕРАТ`));
		assert.equal(await format(result), result);
		assert.equal(await format(String.raw`# \РЕФЕРАТ`, "readme.md"), String.raw`# \РЕФЕРАТ`);
	});

	test("formats table cells and supports the configuration opt-out", async () =>
	{
		const source = "| L | Centre | Right |\n|:---|:---:|---:|\n| a | b | 1 |";
		const aligned = await format(source);
		assert.ok(aligned.includes("| a   |   b    |     1 |"));
		assert.equal(await format(aligned), aligned);
		settings["tables.alignCellContents"] = false;
		const legacy = await format(source);
		assert.ok(legacy.includes("| a   | b      | 1     |"));
		assert.equal(await format(legacy), legacy);
	});

	test("preview shows escaped names as ordinary headings without expanding their content", () =>
	{
		const md = new MarkdownIt();
		preview.markdownItPlugin(md);
		const names = ["РЕФЕРАТ", "Содержание", "Термины и определения", "Перечень сокращений и обозначений", "Список литературы"];
		const source = names.map(name => `# \\${name}\n\nBody`).join("\n\n");
		const html = md.render(source, { currentDocument: { fsPath: "test.g.md" } });
		for (const name of names) assert.ok(html.includes(`<h1>${name}</h1>`));
		assert.doesNotMatch(html, /md2gost_toc|<table>|Отчет #|В настоящем/);
		assert.ok(md.render(String.raw`# \РЕФЕРАТ`, { currentDocument: { fsPath: "test.md" } }).includes(String.raw`<h1>\РЕФЕРАТ</h1>`));
		settings["ui.enhancedPreview"] = false;
		assert.ok(md.render(String.raw`# \РЕФЕРАТ`, { currentDocument: { fsPath: "test.g.md" } }).includes(String.raw`<h1>\РЕФЕРАТ</h1>`));
	});

	test("preview includes an escaped abstract heading as an ordinary contents entry", () =>
	{
		const md = new MarkdownIt();
		preview.markdownItPlugin(md);
		const html = md.render("# СОДЕРЖАНИЕ\n\n" + String.raw`# \РЕФЕРАТ` + "\n\nBody\n\n# Раздел", { currentDocument: { fsPath: "test.g.md" } });
		assert.equal((html.match(/class="md2gost_toc-entry"/g) || []).length, 2);
		assert.ok(html.includes('href="#реферат"'));
		assert.doesNotMatch(html, /Отчет #|\\РЕФЕРАТ/);
	});

	test("preview supports aliases, hanging TOC titles and custom link styles", () =>
	{
		const md = new MarkdownIt();
		preview.markdownItPlugin(md);
		const env = { currentDocument: { fsPath: "test.g.md" } };
		const html = md.render("!!rule link color 000000\n!!rule link underline off\n\n# Содержание\n\n# 10.12.3 Длинный заголовок\n\n[**ссылка**](https://example.test/foo-bar)\n\n# Список литературы\n\n[book] Источник", env);
		assert.ok(html.includes("md2gost_toc-number"));
		assert.ok(html.includes("md2gost_toc-title"));
		assert.ok(html.includes('style="color: #000000;text-decoration: none;"'));
		assert.ok(html.includes("<strong>ссылка</strong>"));
		assert.ok(html.includes("<li>"));
		assert.equal(html.includes("!!rule"), false);
		const next = md.render("```\n!!rule link color ff0000\n```\n\n[x](https://example.test)", env);
		assert.equal(next.includes("color: #ff0000"), false);
		assert.equal(next.includes("color: #000000"), false);
		const nested = md.render("!!rule link color 000000\n!!rule link underline off\n\n:::note\n[x](https://example.test)\n:::\n\n!!header\n[y](https://example.test)\n!!endheader", env);
		assert.equal((nested.match(/style="color: #000000;text-decoration: none;"/g) || []).length, 2);
	});

	test("retains Admonition link styles when parsing and rendering use separate environments", () =>
	{
		const md = new MarkdownIt();
		preview.markdownItPlugin(md);
		const source = "!!rule link color ff0000\n!!rule link underline off\n!!rule admonition note title [Заголовок](https://example.test)\n\n:::note\n[Текст](https://example.test)\n:::\n\n!!header\n[Колонтитул](https://example.test)\n!!endheader";
		const tokens = md.parse(source, { currentDocument: { fsPath: "test.g.md" } });
		const html = md.renderer.render(tokens, md.options, { currentDocument: { fsPath: "test.g.md" } });
		assert.equal((html.match(/style="color: #ff0000;text-decoration: none;"/g) || []).length, 3);
	});

	test("applies the document link colour inside an Admonition without blank separators", () =>
	{
		const md = new MarkdownIt();
		preview.markdownItPlugin(md);
		const source = "!!rule link color 05ff00\n[ссылки](https://example.com).\n:::note\nОбычное примечание. Внутри работает Markdown: **жирный текст**, *курсив*, `монотекст` и [ссылки](https://example.com).\n:::";
		const env = { currentDocument: { fsPath: "test.g.md" } };
		for (const html of [md.render(source, env), md.renderer.render(md.parse(source, env), md.options, { ...env })])
		{
			assert.ok(html.includes('class="md2gost_admonition_content"'));
			assert.equal((html.match(/style="color: #05ff00;"/g) || []).length, 2);
			assert.ok(html.includes("<strong>жирный текст</strong>"));
			assert.ok(html.includes("<em>курсив</em>"));
			assert.ok(html.includes("<code>монотекст</code>"));
		}
	});
});
