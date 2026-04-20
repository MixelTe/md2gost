import * as vscode from 'vscode';
import { TextEditorDecorationBlock } from './textEditorDecorationBlock';

export class RangeTracker
{
	private _range: vscode.Range;
	private _disposable: vscode.Disposable[];
	private _isValid = true;
	private _onUnvalidated: (() => void)[] = []

	constructor(
		private document: vscode.TextDocument,
		initialRange: vscode.Range,
		private decorationType: vscode.TextEditorDecorationType | TextEditorDecorationBlock,
		trackLines = false,
	)
	{
		this._range = initialRange;
		this.applyDecoration();
		this._disposable = [
			vscode.workspace.onDidChangeTextDocument(e =>
			{
				if (e.document == this.document)
				{
					if (trackLines)
						this._updateRange_textLine(e.contentChanges);
					else
						this._updateRange_textBlock(e.contentChanges);
					this.applyDecoration();
				}
			}),
			vscode.window.onDidChangeActiveTextEditor(editor =>
			{
				if (editor?.document == this.document)
					this.applyDecoration(editor);
			}),
			vscode.window.onDidChangeVisibleTextEditors(editors =>
			{
				editors.forEach(editor =>
				{
					if (editor.document == this.document)
						this.applyDecoration(editor);
				});
			})
		];
	}

	public onUnvalidated(f: () => void)
	{
		this._onUnvalidated.push(f);
	}

	private applyDecoration(editor?: vscode.TextEditor)
	{
		const apply = (e: vscode.TextEditor) =>
			this.decorationType instanceof TextEditorDecorationBlock ?
				this.decorationType.setDecorations(e, this._isValid ? this._range : null)
				:
				e.setDecorations(this.decorationType, this._isValid ? [this._range] : []);
		if (editor) apply(editor);
		else vscode.window.visibleTextEditors.forEach(e =>
		{
			if (e.document == this.document)
				apply(e);
		});
	}

	public get range() { return this._range; }
	public get isValid() { return this._isValid }

	private _updateRange_textBlock(changes: readonly vscode.TextDocumentContentChangeEvent[])
	{
		if (!this._isValid || changes.length === 0) return;

		let startOffset = this.document.offsetAt(this._range.start);
		let endOffset = this.document.offsetAt(this._range.end);

		let startDelta = 0;
		let endDelta = 0;

		for (const change of changes)
		{
			const changeStart = change.rangeOffset;
			const changeEnd = change.rangeOffset + change.rangeLength;
			const diff = change.text.length - change.rangeLength;

			if (changeEnd <= startOffset)
			{
				startDelta += diff;
				endDelta += diff;
			}
			else if (changeStart >= startOffset && changeEnd <= endOffset)
			{
				endDelta += diff;
			}
			else if (changeStart > endOffset) { }
			else
			{
				this._isValid = false;
				this._onUnvalidated.forEach(f => f());
				break;
			}
		}

		if (!this._isValid) return;
		const newStart = startOffset + startDelta;
		const newEnd = endOffset + endDelta;

		this._range = new vscode.Range(
			this.document.positionAt(newStart),
			this.document.positionAt(newEnd)
		);
	}

	private _updateRange_textLine(changes: readonly vscode.TextDocumentContentChangeEvent[])
	{
		if (!this._isValid || changes.length === 0) return;

		let startLine = this._range.start.line;
		let endLine = this._range.end.line;

		for (const change of changes)
		{
			const changeStartLine = change.range.start.line;
			const changeEndLine = change.range.end.line;

			const linesAdded = change.text.split('\n').length - 1;
			const linesRemoved = changeEndLine - changeStartLine;
			const lineDelta = linesAdded - linesRemoved;

			if (changeEndLine < startLine || (changeEndLine == startLine && change.range.end.character == 0))
			{
				startLine += lineDelta;
				endLine += lineDelta;
			}
			else if (changeStartLine >= startLine && changeEndLine <= endLine)
			{
				endLine += lineDelta;
			}
			else if (changeStartLine > endLine) { }
			else
			{
				this._isValid = false;
				this._onUnvalidated.forEach(f => f());
				break;
			}
		}

		if (!this._isValid) return;

		const validatedStart = Math.max(0, startLine);
		const validatedEnd = Math.min(this.document.lineCount - 1, endLine);

		const startPos = new vscode.Position(validatedStart, 0);
		const endPos = this.document.lineAt(validatedEnd).range.end;

		this._range = new vscode.Range(startPos, endPos);
	}

	dispose()
	{
		this._disposable.forEach(d => d.dispose());
		vscode.window.visibleTextEditors.forEach(e =>
		{
			if (e.document === this.document)
				this.decorationType instanceof TextEditorDecorationBlock ?
					this.decorationType.setDecorations(e, null)
					:
					e.setDecorations(this.decorationType, []);
		});
	}
}