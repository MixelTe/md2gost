import { repeat } from "./utils";
import { protectCodeSpans } from "./inline";

export interface TableFormatOptions
{
	borderStyle?: "enclosed" | "none" | "preserve";
	compact?: boolean;
	alwaysAddLeftColon?: boolean;
	alignCellContents?: boolean;
}

export interface MarkdownTable
{
	align: ("l" | "c" | "r")[],
	rows: string[][],
	bordered: boolean,
}

export function parseTable(text: string)
{
	const table: MarkdownTable = { rows: [], align: [], bordered: false };
	const lines = text.split("\n");
	const trim = (line: string) =>
	{
		line = line.trim();
		if (line.at(0) == "|") line = line.slice(1);
		if (line.at(-1) == "|") line = line.slice(0, -1);
		return line.trim();
	};

	while (lines.length && lines[lines.length - 1].trim() == "")
		lines.pop();

	for (let i = 0; i < lines.length; i++)
	{
		if (i == 1 && lines[i][0] == "|" && lines[i].trim().at(-1) == "|") table.bordered = true;
		const line = trim(lines[i]);
		if (i == 1)
			table.align = line.split("|").map(v => v.trim()).map(v =>
				v.startsWith(":") && v.endsWith(":") ? "c" :
					v.endsWith(":") ? "r" : "l" as const);
		else
			table.rows.push(line.split(/(?<!\\)\|/).map(v => transformCell(v.trim(), v => v
				.replaceAll("<br>", "\n")
				.replaceAll("\\|", "|")
				.replaceAll("&lt;", "<")
				.replaceAll("&gt;", ">"),
			v => v.replaceAll("\\|", "|")),
			));
	}
	const cols = Math.max(...table.rows.map(l => l.length));
	for (const row of table.rows)
		while (row.length < cols) row.push("");

	return table;
}

export function stringifyTable(table: MarkdownTable, options: TableFormatOptions = {})
{
	if (table.rows.length == 0) return "";
	table = { ...table, rows: table.rows.map(row => [...row]), align: [...table.align] };
	const cols = Math.max(...table.rows.map(l => l.length));
	const lens = repeat(cols, 3);
	for (let i = 0; i < table.rows.length; i++)
	{
		const row = table.rows[i];
		for (let j = 0; j < row.length; j++)
		{
			row[j] = transformCell(row[j].trim(), v => v
				.replaceAll("|", "\\|")
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;")
				.replaceAll("\n", "<br>"),
			v =>
			{
				const ticks = /^`+/.exec(v)![0];
				return v.replaceAll("|", "\\|").replaceAll(/\n+/g, s => `${ticks}${repeat(s.length, "<br>").join("")}${ticks}`);
			});
			lens[j] = Math.max(lens[j], row[j].length);
		}
	}

	while (table.align.length < cols) table.align.push("l");
	while (table.align.length > cols) table.align.pop();

	const { borderStyle = "preserve", compact = false, alwaysAddLeftColon = false, alignCellContents = true } = options;
	const userPreferBorder = borderStyle == "enclosed" || borderStyle == "preserve" && table.bordered;

	const border = userPreferBorder || cols == 1 ||
		table.rows.some(row => !row[0]) || !table.rows[0].at(-1);
	const prefix = border ? "| " : "";
	const postfix = border ? " |" : "";
	let res = "";
	for (let i = 0; i < table.rows.length; i++)
	{
		const row = table.rows[i];
		while (row.length < cols) row.push("");
		res += (prefix + row.map((v, i) =>
			alignCell(v, lens[i], table.align[i]),
		).join(" | ") + postfix).trimEnd() + "\n";
		if (i == 0)
			res += prefix.replace(" ", "") + table.align.map((v, i) => ({
				v, sep: (compact ? "---" : repeat(lens[i] + 1 + (i == 0 && !border ? 0 : 1), "-").join("")),
			})).map(({ v, sep }) =>
				v == "c" ? `:${sep.slice(2)}:` : v == "r" ? `${sep.slice(1)}:` : (alwaysAddLeftColon ? `:${sep.slice(1)}` : sep),
			).join("|") + postfix.replace(" ", "") + "\n";
	}
	return res.trimEnd();

	function alignCell(value: string, width: number, align: "l" | "c" | "r")
	{
		if (compact) return value;
		const padding = width - value.length;
		const left = !alignCellContents || align == "l" ? 0 : align == "r" ? padding : Math.floor(padding / 2);
		return " ".repeat(left) + value + " ".repeat(padding - left);
	}
}

function transformCell(text: string, prose: (value: string) => string, code: (value: string) => string): string
{
	const literals: string[] = [];
	text = protectCodeSpans(text, value => `\uE018${literals.push(code(value)) - 1}\uE019`);
	return prose(text).replace(/\uE018(\d+)\uE019/g, (_, index: string) => literals[Number(index)]!);
}
