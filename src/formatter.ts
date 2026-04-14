import { TextDocument, Range, FormattingOptions, CancellationToken, TextEdit } from "vscode";

export async function md_formatter(document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]>
{
	range = new Range(
		document.lineAt(range.start.line).range.start,
		document.lineAt(range.end.line).range.end
	)
	return [
		// TextEdit.replace(range, document.getText(range).toUpperCase())
	];
}
