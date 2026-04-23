import { TextDocument, Range, FormattingOptions, CancellationToken, TextEdit, workspace } from "vscode";
import { parseLine } from "./parser";

export async function md_formatter(document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]>
{
	const gmd = document.fileName.endsWith(".g.md");
	const config = workspace.getConfiguration("md2gost");
	const borderStyle = config.get<"enclosed" | "none" | "preserve">("tables.borderStyle");

	range = new Range(
		document.lineAt(range.start.line).range.start,
		document.lineAt(range.end.line).range.end
	);

	const edits = [] as TextEdit[];
	for (let i = range.start.line; i <= range.end.line; i++)
	{
		const line = document.lineAt(i);
		const text = line.text;
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
					if (prefix != "") { isDoc = false; break; }
					if (text == "" || text.startsWith("!")) { i--; break; }
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
							JSON.stringify(dict, undefined, 4).replaceAll(/([\s\n]*)((\}|\]),?)$/gm, ",$1$2");
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
		}
		const m_header = /^(#+)\s+(.*)/.exec(text);
		if (m_header)
		{
			applyNewText(`${m_header[1]} ${m_header[2]}`);
			continue;
		}


		function applyNewText(newText: string)
		{
			if (text == newText) return;
			edits.push(TextEdit.replace(line.range, newText));
		}
	}

	// TextEdit.replace(range, document.getText(range).toUpperCase())
	return edits;
}
