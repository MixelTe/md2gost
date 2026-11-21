import { type CancellationToken, type FormattingOptions, type TextDocument, Range, TextEdit, workspace } from "vscode";
import MarkdownIt, { type Token } from "markdown-it";
import { protectCodeSpans, transformProse } from "./inline";
import { parseLine } from "./parser";
import { isSourceHeading, parseHeadingText, SPECIAL_HEADINGS } from "./sections";
import { parseTable, stringifyTable } from "./tableEditor";
import { repeat, trimEnd } from "./utils";

const codeParser = new MarkdownIt();

export async function md_formatter(document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]>
{
	const gmd = document.fileName.endsWith(".g.md");
	const indentChar = options.insertSpaces ? "    " : "\t";
	const config = workspace.getConfiguration("md2gost");
	const replaceEmDash = config.get<boolean>("formatter.replaceEmDash");

	range = new Range(
		document.lineAt(range.start.line).range.start,
		document.lineAt(range.end.line).range.end,
	);

	const re_sep = /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/;
	const re_sep_oneCol = /^\|\s*:?-+:?\s*\|$/;

	const { codeLines, listLines } = findCodeLines(document);

	const edits = [] as TextEdit[];
	for (let i = range.start.line; i <= range.end.line; i++)
	{
		if (token.isCancellationRequested) return [];
		if (codeLines.has(i)) continue;
		const line = document.lineAt(i);
		const text = line.text;
		const textTrim = line.text.trim().replaceAll(/\s+/g, " ");

		if (gmd)
		{
			const keywords = [
				"!!rule",
				"!!section",
				"!!header",
				"!!footer",
				"!!endheader",
				"!!endfooter",
			];
			if (keywords.some(kw => text.startsWith(kw)))
			{
				applyNewText(transformProse(text.trim(), value => value.replaceAll(/\s+/g, " ")));
				continue;
			}
			const m_doc = /(^!!\([^)]+\)\s*)({.*)/.exec(text);
			if (m_doc)
			{
				const prefix = m_doc[1];
				let json = m_doc[2].trimEnd();
				const startI = i;
				let isDoc = true;
				while (true)
				{
					i++;
					if (i > range.end.line || codeLines.has(i)) { isDoc = false; break; }
					const line = document.lineAt(i);
					const text = line.text.trim();
					const { prefix } = parseLine(text);
					if (prefix != "" || text == "" || text.startsWith("!")) { i--; break; }
					json += text;
				}
				if (isDoc)
				{
					const re_remTrailingComma = /,(\s*[}\]])/g;
					let dict = {};
					try { dict = JSON.parse(json.replaceAll(re_remTrailingComma, "$1")); }
					catch { isDoc = false; }
					if (isDoc)
					{
						let addNewline = false;
						if (i + 1 < document.lineCount)
						{
							const line = document.lineAt(i + 1).text.trim();
							const { prefix } = parseLine(line);
							addNewline = prefix == "" && line != "";
						}
						const jsonS = startI == i ?
							JSON.stringify(dict) :
							JSON.stringify(dict, undefined, indentChar).replaceAll(/([\s\n]*)((\}|\]),?)$/gm, ",$1$2");
						edits.push(TextEdit.replace(
							new Range(
								document.lineAt(startI).range.start,
								document.lineAt(i).range.end,
							),
							prefix + jsonS + (addNewline ? "\n" : ""),
						));
						continue;
					}
				}
				i = startI;
			}
			if (textTrim.toUpperCase() == "# РЕФЕРАТ")
			{
				applyNewText("# РЕФЕРАТ");
				const startI = i;
				while (true)
				{
					i++;
					if (i > range.end.line || codeLines.has(i)) { i = startI; break; }
					const line = document.lineAt(i);
					const text = line.text.trim();
					const { prefix } = parseLine(text);
					if (prefix != "" || text.startsWith("!")) { i = startI; break; }
					if (text == "") continue;
					edits.push(TextEdit.replace(
						line.range,
						transformProse(text, value => trimEnd(value.toUpperCase(), ".")),
					));
					break;
				}
				continue;
			}
			if (textTrim.startsWith("# ") && isSourceHeading(textTrim.slice(2)))
			{
				while (i < range.end.line)
				{
					i++;
					if (codeLines.has(i)) { i--; break; }
					const line = document.lineAt(i);
					const text = line.text.trim();
					const { prefix } = parseLine(text);
					if (prefix != "") { i--; break; }
				}
			}
			const header = SPECIAL_HEADINGS.map(value => "# " + value).find(value => value == textTrim.toUpperCase());
			if (header)
			{
				applyNewText(header);
				continue;
			}
		}
		const m_header = /^(#+)\s+(.*)/.exec(text);
		if (m_header)
		{
			const heading = gmd ? parseHeadingText(m_header[2]) : { text: m_header[2] };
			applyNewText(`${m_header[1]} ${heading.notSpecial ? "\\" : ""}${clearText(heading.text)}`);
			continue;
		}

		if (i > range.start.line && !codeLines.has(i - 1) && (re_sep.test(tableTrim(text)) || re_sep_oneCol.test(text)))
		{
			const line = tableTrim(text);
			const prevLine = document.lineAt(i - 1);
			const cols = line.split("|");
			const header = tableTrim(prevLine.text).split("|").map(v => v.trim());
			if (header.length != cols.length) continue;
			const headerFooterBlock = i > 2 && /^!!(footer|header)/.exec(document.lineAt(i - 2).text);
			const headerFooterBlockEnd = headerFooterBlock && `!!end${headerFooterBlock[1]}`;
			while (i <= range.end.line && !codeLines.has(i))
			{
				const line = document.lineAt(i).text;
				if (line.trim() == "" || (headerFooterBlockEnd && line.trim() == headerFooterBlockEnd)) break;
				i++;
			}
			const tableRange = new Range(prevLine.range.start, document.lineAt(i - 1).range.end);
			const oldTable = document.getText(tableRange);
			const table = parseTable(clearText(oldTable));
			const newTable = stringifyTable(table);
			if (oldTable != newTable)
				edits.push(TextEdit.replace(tableRange, newTable));
			i--;
			continue;
		}

		let indentSize = 4;
		if (processList()) continue;

		applyNewText(clearText(text));
		function processList(level = 0)
		{
			const line = document.lineAt(i);
			const text = line.text;
			const listIndent = leadingSpaces(text);
			if (indentLevel(text) != level) return false;
			const textT = text.trim();
			let itemN = -1;
			let sign = "";
			let txt = "";
			const m_ulist = /^(\*|-)\s+(.*)/.exec(textT);
			if (m_ulist)
			{
				sign = m_ulist[1];
				txt = m_ulist[2];
			}
			else
			{
				const m_olist = /^(\d+)(\.|\))\s+(.*)/.exec(textT);
				if (!m_olist) return false;
				itemN = parseInt(m_olist[1]);
				sign = m_olist[2];
				txt = m_olist[3];
			}
			const indentS = listLines.has(i) ? /^[ \t]*/.exec(text)![0] : repeat(level, indentChar).join("");
			txt = clearText(txt);
			const newText = itemN < 0 ?
				`${indentS}${sign} ${txt}` :
				`${indentS}${itemN++}${sign} ${txt}`;
			if (text != newText) edits.push(TextEdit.replace(line.range, newText));

			while (++i <= range.end.line)
			{
				const line = document.lineAt(i);
				const text = line.text;
				if (codeLines.has(i))
				{
					if (leadingSpaces(text) > listIndent) continue;
					i--; break;
				}
				if (text.trim() == "") continue;
				const m = /^(\s*)(((\d+[.)])|\*|-)\s+(.*)|([^\s].*))/.exec(text);
				if (!m) { i--; break; }
				if (m[6])
				{
					const indent = indentLevel(m[1]);
					if (indent <= level) { i--; break; }
					// if (document.lineAt(i - 1).text.trim() == "") { i--; break; }
					const indentS = listLines.has(i) ? m[1] : repeat(level + 1, indentChar).join("");
					const newText = indentS + clearText(m[6]);
					if (text != newText) edits.push(TextEdit.replace(line.range, newText));
					continue;
				}
				if (level == 0) indentSize = -1;
				const indent = indentLevel(m[1]);
				if (indent < level) { i--; break; }
				if (indent == level + 1) { processList(level + 1); continue; }
				const mark = m[3].at(-1);
				const sameListType = itemN < 0 ? (mark == "*" || mark == "-") : (mark == "." || mark == ")");
				if (!sameListType) { i--; break; }
				const txt = clearText(m[5]);
				const prefix = listLines.has(i) ? m[1] : indentS;
				const newText = itemN < 0 ?
					`${prefix}${sign} ${txt}` :
					`${prefix}${itemN++}${sign} ${txt}`;
				if (text != newText) edits.push(TextEdit.replace(line.range, newText));
			}
			return true;
		}

		function applyNewText(newText: string)
		{
			if (text == newText) return;
			edits.push(TextEdit.replace(line.range, newText));
		}

		function indentLevel(line: string)
		{
			let level = 0;
			if (line[0] != " " && line[0] != "\t") return 0;
			if (indentSize <= 0) indentSize = /^(\s+)/.exec(line)?.[1].length || 4;
			const indent = repeat(indentSize, " ").join("");
			while (line.startsWith(indent) || line.startsWith("\t"))
			{
				if (line.startsWith(indent)) line = line = line.slice(indentSize);
				else if (line.startsWith("\t")) line = line.slice(1);
				level++;
			}
			return level;
		}

		function clearText(text: string): string
		{
			if (replaceEmDash)
				return transformProse(text, value => value.replaceAll("—", "–"));
			return text;
		}
	}

	return edits;

	function tableTrim(line: string)
	{
		line = line.trim();
		if (line.at(0) == "|") line = line.slice(1);
		if (line.at(-1) == "|") line = line.slice(0, -1);
		return line.trim();
	};
}

function leadingSpaces(text: string): number
{
	return /^[ \t]*/.exec(text)![0].replaceAll("\t", "    ").length;
}

function findCodeLines(document: TextDocument): { codeLines: Set<number>, listLines: Set<number> }
{
	let source = document.getText().replace(/\r\n?/g, "\n");
	// md2gost listing captions may contain backticks, unlike Markdown fence info.
	if (document.fileName.endsWith(".g.md"))
		source = source.replace(/^([ \t]*(?:>[ \t]*|(?:[*+-]|\d+[.)])[ \t]+)*`{3,})(.*)$/gm,
			(_, fence: string, caption: string) => fence + caption.replaceAll("`", "'"));
	const tokens: Token[] = [];
	codeParser.block.parse(source, codeParser, {}, tokens);
	const lines = new Set<number>();
	for (const token of tokens)
	{
		if (!token.map) continue;
		const [start, end] = token.map;
		if (token.type == "fence" || token.type == "code_block")
			for (let line = start; line < end; line++) lines.add(line);
		else if (token.type == "inline")
			protectCodeSpans(token.content, (value, from) =>
			{
				// A multiline code span cannot be formatted one line at a time.
				if (value.includes("\n"))
				{
					const first = start + token.content.slice(0, from).split("\n").length - 1;
					const last = first + value.split("\n").length - 1;
					for (let line = first; line <= last; line++) lines.add(line);
				}
				return value;
			});
	}
	// Keep list indentation consistent with the code that remains untouched.
	const listLines = new Set<number>();
	for (const token of tokens)
		if ((token.type == "bullet_list_open" || token.type == "ordered_list_open") && token.map)
		{
			const [start, end] = token.map;
			if (![...lines].some(line => line >= start && line < end)) continue;
			for (let line = start; line < end; line++) listLines.add(line);
		}
	return { codeLines: lines, listLines };
}
