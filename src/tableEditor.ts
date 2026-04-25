import fs from "fs";
import path from "path";
import * as vscode from "vscode";
import { repeat } from "./utils";
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
			{ enableScripts: true, retainContextWhenHidden: true }
		);
		const iconLightTheme = vscode.Uri.file(path.join(context.extensionPath, "imgs", "table_edit.svg"));
		const iconDarkTheme = vscode.Uri.file(path.join(context.extensionPath, "imgs", "table_edit_white.svg"));
		panel.iconPath = {
			light: iconLightTheme,
			dark: iconDarkTheme
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
			.replaceAll("{{data}}", JSON.stringify(data))
			.replaceAll("{{settings}}", JSON.stringify({
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
			context.subscriptions
		);
	};
}

interface Table
{
	align: ("l" | "c" | "r")[],
	rows: string[][],
	bordered: boolean,
}

export function parseTable(text: string)
{
	const table: Table = { rows: [], align: [], bordered: false };
	const lines = text.split("\n");
	const trim = (line: string) =>
	{
		line = line.trim();
		if (line.at(0) == "|") line = line.slice(1);
		if (line.at(-1) == "|") line = line.slice(0, -1);
		return line.trim();
	};

	while (lines[lines.length - 1].trim() == "")
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
			table.rows.push(line.split("|").map(v => v.trim()
				.replaceAll("<br>", "\n")
				.replaceAll("&#124;", "|")
				.replaceAll("&lt;", "<")
				.replaceAll("&gt;", ">")
			));
	}
	const cols = Math.max(...table.rows.map(l => l.length));
	for (const row of table.rows)
		while (row.length < cols) row.push("");

	return table;
}

export function stringifyTable(table: Table)
{
	if (table.rows.length == 0) return "";
	const cols = Math.max(...table.rows.map(l => l.length));
	const lens = repeat(cols, 1);
	for (let i = 0; i < table.rows.length; i++)
	{
		const row = table.rows[i];
		for (let j = 0; j < row.length; j++)
		{
			row[j] = row[j].trim()
				.replaceAll("|", "&#124;")
				.replaceAll("<", "&lt;")
				.replaceAll(">", "&gt;")
				.replaceAll("\n", "<br>");
			lens[j] = Math.max(lens[j], row[j].length);
		}
	}

	while (table.align.length < cols) table.align.push("l");
	while (table.align.length > cols) table.align.pop();

	const config = vscode.workspace.getConfiguration("md2gost");
	const borderStyle = config.get<"enclosed" | "none" | "preserve">("tables.borderStyle");
	const compact = config.get<boolean>("tables.compact");
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
			v + (compact ? "" : repeat(lens[i] - v.length, " ").join(""))
		).join(" | ") + postfix).trim() + "\n";
		if (i == 0)
			res += prefix.replace(" ", "") + table.align.map((v, i) => ({
				v, sep: (compact ? "---" : repeat(lens[i] + 1 + (i == 0 && !border ? 0 : 1), "-").join(""))
			})).map(({ v, sep }) =>
				v == "c" ? `:${sep.slice(2)}:` : v == "r" ? `${sep.slice(1)}:` : sep
			).join("|") + postfix.replace(" ", "") + "\n";
	}
	return res.trim();
}