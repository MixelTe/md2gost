import * as vscode from "vscode";

export class TextEditorDecorationBlock
{
	private single: vscode.TextEditorDecorationType;
	private top: vscode.TextEditorDecorationType;
	private middle: vscode.TextEditorDecorationType;
	private bottom: vscode.TextEditorDecorationType;

	constructor(
		options: vscode.DecorationRenderOptions,
	)
	{
		const bw = options.borderWidth || "1px";
		const br = options.borderRadius || "0px";
		this.single = vscode.window.createTextEditorDecorationType(options);
		this.top = vscode.window.createTextEditorDecorationType({
			...options,
			borderWidth: `${bw} ${bw} 0 ${bw}`,
			borderRadius: `${br} ${br} 0 0`,
		});
		this.middle = vscode.window.createTextEditorDecorationType({
			...options,
			borderWidth: `0 ${bw} 0 ${bw}`,
			borderRadius: "0",
			gutterIconPath: undefined,
			light: options.light && { ...options.light, gutterIconPath: undefined },
			dark: options.dark && { ...options.dark, gutterIconPath: undefined },
		});
		this.bottom = vscode.window.createTextEditorDecorationType({
			...options,
			borderWidth: `0 ${bw} ${bw} ${bw}`,
			borderRadius: `0 0 ${br} ${br}`,
			gutterIconPath: undefined,
			light: options.light && { ...options.light, gutterIconPath: undefined },
			dark: options.dark && { ...options.dark, gutterIconPath: undefined },
		});
	}

	public setDecorations(e: vscode.TextEditor, range: vscode.Range | null)
	{
		if (!range)
		{
			e.setDecorations(this.single, []);
			e.setDecorations(this.top, []);
			e.setDecorations(this.middle, []);
			e.setDecorations(this.bottom, []);
			return;
		}
		if (range.isSingleLine)
		{
			e.setDecorations(this.single, [range]);
			e.setDecorations(this.top, []);
			e.setDecorations(this.middle, []);
			e.setDecorations(this.bottom, []);
			return;
		}

		const startLine = range.start.line;
		const endLine = range.end.line;

		const topRange = new vscode.Range(
			range.start,
			e.document.lineAt(startLine).range.end
		);

		const bottomRange = new vscode.Range(
			e.document.lineAt(endLine).range.start,
			range.end
		);

		const middleRanges: vscode.Range[] = [];
		for (let i = startLine + 1; i < endLine; i++)
			middleRanges.push(e.document.lineAt(i).range);

		e.setDecorations(this.single, []);
		e.setDecorations(this.top, [topRange]);
		e.setDecorations(this.middle, middleRanges);
		e.setDecorations(this.bottom, [bottomRange]);
	}
}