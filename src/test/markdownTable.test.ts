import * as assert from "node:assert/strict";
import { parseTable, stringifyTable } from "../markdownTable";

suite("Markdown table formatting", () =>
{
	const source = "| Левая | Центр | Правая |\n|:---|:---:|---:|\n| я | я | 1 |";
	test("pads cells according to column alignment by default", () =>
	{
		const formatted = stringifyTable(parseTable(source));
		assert.equal(formatted.split("\n")[2], "| я     |   я   |      1 |");
		assert.equal(stringifyTable(parseTable(formatted)), formatted);
	});
	test("the opt-out retains right padding and compact overrides alignment", () =>
	{
		const old = stringifyTable(parseTable(source), { alignCellContents: false });
		assert.equal(old.split("\n")[2], "| я     | я     | 1      |");
		assert.equal(stringifyTable(parseTable(old), { alignCellContents: false }), old);
		assert.equal(stringifyTable(parseTable(source), { compact: true }), stringifyTable(parseTable(source), { compact: true, alignCellContents: false }));
	});
	for (const borderStyle of ["enclosed", "none", "preserve"] as const)
		test(`preserves data and is stable with ${borderStyle} borders`, () =>
		{
			const input = "A | B | C\n:--- | :---: | ---:\n\\| | `x\\|y` | a<br>b\n | |";
			const table = parseTable(input);
			const formatted = stringifyTable(table, { borderStyle, alwaysAddLeftColon: true });
			assert.deepEqual(parseTable(formatted).rows, table.rows);
			assert.equal(stringifyTable(parseTable(formatted), { borderStyle, alwaysAddLeftColon: true }), formatted);
		});
	test("short and empty cells still produce valid separators", () =>
	{
		const formatted = stringifyTable(parseTable("| a | b |\n|:---:|---:|\n| | 1 |"));
		assert.match(formatted.split("\n")[1]!, /^\|:-{3,}:\|-{3,}:\|$/);
		assert.equal(stringifyTable(parseTable(formatted)), formatted);
	});
	test("preserves inline code delimiters, HTML literals and escaped pipes", () =>
	{
		for (const code of ["`x\\|<br>`", "``<tag> &lt; <br> x\\|y``", "``one ``` literal``"])
		{
			const table = `| Code |\n|---|\n| ${code} |`;
			const formatted = stringifyTable(parseTable(table));
			assert.ok(formatted.includes(code), formatted);
			assert.deepEqual(parseTable(formatted).rows, parseTable(table).rows);
			assert.equal(stringifyTable(parseTable(formatted)), formatted);
		}
	});
});
