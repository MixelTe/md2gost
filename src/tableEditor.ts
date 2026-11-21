import fs from "fs";
import path from "path";
import * as vscode from "vscode";
import { parseTable, stringifyTable as formatMarkdownTable, type MarkdownTable } from "./markdownTable";
export { parseTable } from "./markdownTable";
import { RangeTracker } from "./rangeTracker";
import { TextEditorDecorationBlock } from "./textEditorDecorationBlock";

const OpenedEditors: Record<string, { panel: vscode.WebviewPanel, isDirty: boolean }> = {};

export function onEditTableCommand(context: vscode.ExtensionContext)
{
	return async function (uri: vscode.Uri, range: vscode.Range)
	{
		const uriStr = uri.toString();
		if (OpenedEditors[uriStr] && OpenedEditors[uriStr].isDirty)
		{
			OpenedEditors[uriStr].panel.reveal();
			return;
		}
		OpenedEditors[uriStr]?.panel.dispose();
		const panel = vscode.window.createWebviewPanel(
			"md2gost.tableEditor",
			"Table Editor",
			vscode.ViewColumn.Active,
			{ enableScripts: true, retainContextWhenHidden: true },
		);
		const iconLightTheme = vscode.Uri.file(path.join(context.extensionPath, "imgs", "table_edit.svg"));
		const iconDarkTheme = vscode.Uri.file(path.join(context.extensionPath, "imgs", "table_edit_white.svg"));
		panel.iconPath = {
			light: iconLightTheme,
			dark: iconDarkTheme,
		};

		const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === uri.toString());
		if (!document)
		{
			vscode.window.showErrorMessage(`Document not found: ${uri}`);
			return;
		}
		OpenedEditors[uriStr] = { panel, isDirty: false };
		const data = parseTable(document.getText(range));

		const rootUri = panel.webview.asWebviewUri(context.extensionUri);
		const filePath = context.asAbsolutePath(path.join("assets", "tableEditor.html"));
		const html = fs.readFileSync(filePath, "utf8");
		panel.webview.html = html
			.replaceAll("{{root}}", rootUri.toString())
			.replaceAll("{{data}}", serializeWebviewData(data))
			.replaceAll("{{settings}}", serializeWebviewData({
				wide: context.globalState.get("tableEditor_wide", false),
				autosave: context.globalState.get("tableEditor_autosave", true),
			}));

		const trackedRangeDecoration = new TextEditorDecorationBlock({
			backgroundColor: "rgba(255, 165, 0, 0.1)",
			gutterIconPath: iconDarkTheme,
			gutterIconSize: "12px",
			light: {
				gutterIconPath: iconLightTheme,
				gutterIconSize: "12px",
			},
			border: "1px dashed orange",
			borderWidth: "1px",
			borderRadius: "6px",
			overviewRulerColor: "orange",
			overviewRulerLane: vscode.OverviewRulerLane.Right,
			rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
			isWholeLine: true,
		});
		const tracker = new RangeTracker(document, range, trackedRangeDecoration, true);
		tracker.onUnvalidated(() =>
		{
			if (!OpenedEditors[uriStr].isDirty)
				return panel.dispose();
			panel.title = "Table Editor (Locked)";
			panel.webview.postMessage({ command: "disable" });
		});
		let skip_changes = false;
		tracker.onContentChange(() =>
		{
			if (skip_changes || !tracker.isValid) return;
			const data = parseTable(document.getText(tracker.range));
			panel.webview.postMessage({ command: "set_data", data });
		});

		panel.webview.onDidReceiveMessage(async message =>
		{
			if (message.command == "saveSetting")
			{
				context.globalState.update("tableEditor_" + message.key, message.value);
				return;
			}
			if (message.command == "setDirty")
			{
				OpenedEditors[uriStr].isDirty = true;
				if (!tracker.isValid) return;
				panel.title = "● Table Editor";
				return;
			}
			if (message.command == "close")
			{
				panel.dispose();
				return;
			}
			if (message.command != "saveData") return;
			if (!tracker.isValid)
			{
				vscode.window.showErrorMessage("The document has been changed too much, open the editor again");
				return;
			}
			panel.title = "Table Editor";
			OpenedEditors[uriStr].isDirty = false;
			const edit = new vscode.WorkspaceEdit();
			const table = stringifyTable({ ...message.newData, bordered: data.bordered });
			edit.replace(uri, tracker.range, table);
			skip_changes = true;
			await vscode.workspace.applyEdit(edit);
			skip_changes = false;
			if (!message.silent)
				vscode.window.showInformationMessage("File was updated");
		});
		panel.onDidChangeViewState(e =>
		{
			const webviewPanel = e.webviewPanel;
			if (webviewPanel.active)
				webviewPanel.webview.postMessage({ command: "restore_focus" });
		}, null, context.subscriptions);
		panel.onDidDispose(
			() =>
			{
				delete OpenedEditors[uriStr];
				tracker.dispose();
			},
			null,
			context.subscriptions,
		);
	};
}

function serializeWebviewData(value: unknown)
{
	return JSON.stringify(value)
		.replaceAll("<", "\\u003c")
		.replaceAll(">", "\\u003e")
		.replaceAll("&", "\\u0026")
		.replaceAll("\u2028", "\\u2028")
		.replaceAll("\u2029", "\\u2029");
}

export function stringifyTable(table: MarkdownTable)
{
	const config = vscode.workspace.getConfiguration("md2gost");
	return formatMarkdownTable(table, {
		borderStyle: config.get("tables.borderStyle", "preserve"),
		compact: config.get("tables.compact", false),
		alwaysAddLeftColon: config.get("tables.alwaysAddLeftColon", false),
		alignCellContents: config.get("tables.alignCellContents", true),
	});
}
