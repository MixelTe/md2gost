import { TextDocument, Range, FormattingOptions, CancellationToken, TextEdit, workspace } from "vscode";
import { parseLine } from "./parser";
import { lt, repeat, trimEnd } from "./utils";
import { parseTable, stringifyTable } from "./tableEditor";

export async function md_formatter(document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]>
{
	const gmd = document.fileName.endsWith(".g.md");
	const indentChar = options.insertSpaces ? "    " : "\t";
	const config = workspace.getConfiguration("md2gost");
	const replaceEmDash = config.get<boolean>("formatter.replaceEmDash");

	range = new Range(
		document.lineAt(range.start.line).range.start,
		document.lineAt(range.end.line).range.end
	);


	const re_sep = /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/;
	const re_sep_oneCol = /^\|\s*:?-+:?\s*\|$/;

	const edits = [] as TextEdit[];
	for (let i = range.start.line; i <= range.end.line; i++)
	{
		if (token.isCancellationRequested) return [];
		const line = document.lineAt(i);
		const text = line.text;
		const textTrim = line.text.trim().replaceAll(/\s+/g, " ");

		if (gmd)
		{
			if ((text.startsWith("!!rule") || text.startsWith("!!section")))
			{
				applyNewText(text.trim().split(/\s+/).join(" "));
				continue;
			}
			const m_doc = /(^!!\([^\)]+\)\s*)({.*)/.exec(text);
			if (m_doc)
			{
				const prefix = m_doc[1];
				let json = m_doc[2].trimEnd();
				const startI = i;
				let isDoc = true;
				while (true)
				{
					i++;
					if (i >= document.lineCount) { isDoc = false; break; }
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
					catch (x) { isDoc = false; }
					if (isDoc)
					{
						let addNewline = false;
						if (i + 1 < document.lineCount)
						{
							const line = document.lineAt(i + 1).text.trim();
							const { prefix } = parseLine(text);
							addNewline = prefix == "" && line != "";
						}
						const jsonS = startI == i ?
							JSON.stringify(dict) :
							JSON.stringify(dict, undefined, indentChar).replaceAll(/([\s\n]*)((\}|\]),?)$/gm, ",$1$2");
						edits.push(TextEdit.replace(
							new Range(
								document.lineAt(startI).range.start,
								document.lineAt(i).range.end
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
					if (i >= document.lineCount) { i = startI; break; }
					const line = document.lineAt(i);
					const text = line.text.trim();
					const { prefix } = parseLine(text);
					if (prefix != "" || text.startsWith("!")) { i = startI; break; }
					if (text == "") continue;
					edits.push(TextEdit.replace(
						line.range,
						trimEnd(text.toUpperCase(), "."),
					));
					break;
				}
				continue;
			}
			const header = [
				"# РЕФЕРАТ",
				"# ОГЛАВЛЕНИЕ",
				"# ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ",
				"# ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ",
				"# ВВЕДЕНИЕ",
				"# ЗАКЛЮЧЕНИЕ",
				"# СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ",
			].find(v => v == textTrim.toUpperCase());
			if (header)
			{
				applyNewText(header);
				continue;
			}
		}
		const m_header = /^(#+)\s+(.*)/.exec(text);
		if (m_header)
		{
			applyNewText(`${m_header[1]} ${clearText(m_header[2])}`);
			continue;
		}

		if (re_sep.test(tableTrim(text)) || re_sep_oneCol.test(text))
		{
			const line = tableTrim(text);
			const prevLine = document.lineAt(i - 1);
			const cols = line.split("|");
			const header = tableTrim(prevLine.text).split("|").map(v => v.trim());
			if (header.length != cols.length) continue;
			while (i < document.lineCount)
			{
				const line = document.lineAt(i).text;
				if (line.trim() == "") break;
				i++;
			}
			const range = new Range(prevLine.range.start, document.lineAt(i - 1).range.end);
			const oldTable = clearText(document.getText(range));
			const table = parseTable(oldTable);
			const newTable = stringifyTable(table);
			if (oldTable != newTable)
				edits.push(TextEdit.replace(range, newTable));
			i--;
			continue;
		}

		if (processList()) continue;

		applyNewText(clearText(text));
		function processList(level = 0)
		{
			const line = document.lineAt(i);
			const text = line.text;
			if (indentLevel(text) != level) return false;
			const textT = text.trim();
			let itemN = -1;
			let sign = "";
			let txt = ""
			const m_ulist = /^(\*|\-)\s+(.*)/.exec(textT);
			if (m_ulist)
			{
				sign = m_ulist[1];
				txt = m_ulist[2];
			}
			else
			{
				const m_olist = /^(\d+)(\.|\))\s+(.*)/.exec(textT)
				if (!m_olist) return false;
				itemN = parseInt(m_olist[1]);
				sign = m_olist[2];
				txt = m_olist[3];
			}
			const indentS = repeat(level, indentChar).join("");
			txt = clearText(txt);
			const newText = itemN < 0 ?
				`${indentS}${sign} ${txt}` :
				`${indentS}${itemN++}${sign} ${txt}`;
			if (text != newText) edits.push(TextEdit.replace(line.range, newText));

			while (++i < document.lineCount)
			{
				const line = document.lineAt(i);
				const text = line.text;
				if (text.trim() == "") continue;
				const m = /^(\s*)(((\d+[\.\)])|\*|\-)\s+(.*)|([^\s].*))/.exec(text);
				if (!m) { i--; break; }
				if (m[6])
				{
					if (document.lineAt(i - 1).text.trim() == "") { i--; break; }
					const indentS = repeat(level + 1, indentChar).join("");
					const newText = indentS + clearText(m[6]);
					if (text != newText) edits.push(TextEdit.replace(line.range, newText));
					continue;
				}
				const indent = indentLevel(m[1]);
				if (indent < level) { i--; break; }
				if (indent == level + 1) { processList(level + 1); continue; }
				const mark = m[3].at(-1);
				const sameListType = itemN < 0 ? (mark == "*" || mark == "-") : (mark == "." || mark == ")")
				if (!sameListType) { i--; break; }
				const txt = clearText(m[5]);
				const newText = itemN < 0 ?
					`${indentS}${sign} ${txt}` :
					`${indentS}${itemN++}${sign} ${txt}`;
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
			while (line.startsWith("    ") || line.startsWith("\t"))
			{
				if (line.startsWith("    ")) line = line = line.slice(4);
				else if (line.startsWith("\t")) line = line.slice(1);
				level++;
			}
			return level;
		}

		function clearText(text: string): string
		{
			if (replaceEmDash)
				return text.replaceAll("—", "–");
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
