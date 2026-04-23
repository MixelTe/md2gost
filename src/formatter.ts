import { TextDocument, Range, FormattingOptions, CancellationToken, TextEdit, workspace } from "vscode";

export async function md_formatter(document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): Promise<TextEdit[]>
{
	const config = workspace.getConfiguration("md2gost");
	const borderStyle = config.get<"enclosed" | "none" | "preserve">("tables.borderStyle");

	range = new Range(
		document.lineAt(range.start.line).range.start,
		document.lineAt(range.end.line).range.end
	);
	return [
		// TextEdit.replace(range, document.getText(range).toUpperCase())
	];
}
