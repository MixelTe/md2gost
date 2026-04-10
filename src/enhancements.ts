import { InlineCompletionItem, TextDocument, Position, CompletionItem, CompletionItemKind, Hover, InlayHint, SnippetString, MarkdownString, Range, InlayHintKind } from "vscode";

export function md_completion(document: TextDocument, position: Position): CompletionItem[] | undefined
{
	const linePrefix = document.lineAt(position).text.slice(0, position.character);
	if (!linePrefix.startsWith("!")) return;
	if (linePrefix == "!")
	{
		const item1 = new CompletionItem("!!rule", CompletionItemKind.Keyword);
		item1.insertText = "!rule";

		const item2 = new CompletionItem("Вставить docx", CompletionItemKind.Snippet);
		item2.insertText = new SnippetString('!(${1:путькфайлу}){\n\t"${2:поле}": "${3:значение}",\n}');
		item2.documentation = new MarkdownString("Вставляет блок для вставки docx");
		item2.documentation.appendCodeblock('!(путькфайлу){\n\t"поле": "значение",\n}')

		return [item1, item2];
	}
}

const re_sep = /^(\s*:?-+:?\s*\|)+\s*:?-+:?\s*$/;
export function md_inlineCompletion(document: TextDocument, position: Position): InlineCompletionItem[] | undefined
{
	// if (!document.fileName.endsWith(".g.md")) return;
	if (position.line == 0) return;
	const linePrefix = document.lineAt(position).text.slice(0, position.character);
	if (linePrefix != "") return;
	const prevLine = document.lineAt(position.line - 1).text;
	if (!prevLine.includes("|")) return;
	if (re_sep.test(prevLine)) return;

	return [
		new InlineCompletionItem(
			prevLine.replaceAll(/[^|]/g, "-"),
			new Range(position, position)
		)
	];
}

export function md_hover(document: TextDocument, position: Position): Hover | undefined
{
	// const range = document.getWordRangeAtPosition(position);
	// const word = document.getText(range);
	const line = document.lineAt(position).text;
	if (!line.startsWith("!!rule")) return;
	const lineNorm = line.replaceAll(/\s+/g, " ").trim().toLowerCase();

	if (lineNorm.startsWith("!!rule numbering lazy"))
	{
		const content = new MarkdownString();
		content.appendCodeblock("!!rule numbering lazy");
		content.appendMarkdown("Включает ленивую автонумерации.\n\n");
		content.appendMarkdown("Когда включено, более не нужно писать `[#]` в названиях картинок, таблиц и т.д. - добавляется автоматически");

		return new Hover(content);
	}
}

export function md_inlineHints(document: TextDocument, range: Range): InlayHint[] | undefined
{
	const hints: { position: number, label: string, paddingLeft?: boolean, paddingRight?: boolean }[] = [];
	const text = document.getText(range);
	const startOffset = document.offsetAt(range.start);

	const hashMatches = Array.from(text.matchAll(/\[#\]/g)).map(m => (
		{ m, index: m.index!, type: "hash" as const }
	));

	const re_img = /^!\[(.*)\]\((.*)\)({(.*)})?$/gm;
	const imgMatches = Array.from(text.matchAll(re_img)).map(m => (
		{ m, index: m.index!, type: "img" as const }
	));

	const allMatches = [...hashMatches, ...imgMatches].sort((a, b) => a.index - b.index);

	let counter = 1;
	for (const match of allMatches)
	{
		if (match.type == "img")
			hints.push({ position: match.index + 2, label: `Рисунок ${counter++} - ` });
		else
			hints.push({ position: match.index + 2, label: `${counter}`, paddingLeft: true });
	}

	return hints.map(hint =>
	{
		const pos = document.positionAt(startOffset + hint.position);
		const h = new InlayHint(pos, hint.label, InlayHintKind.Type);
		h.paddingLeft = hint.paddingLeft;
		h.paddingRight = hint.paddingRight;
		return h;
	});
}