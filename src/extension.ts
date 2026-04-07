import * as vscode from "vscode";
import { render } from "./main";
import { openFile, trimStart } from "./utils";
import fs from "fs";
import path from "path";

export function activate(context: vscode.ExtensionContext)
{
	const assets = context.asAbsolutePath("assets");
	showChangelogOnUpdate(context);

	context.subscriptions.push(
		vscode.commands.registerCommand("md2gost.render_pdf",
			(uri: vscode.Uri) => onRenderCommand(assets, uri, true),
		)
	);
	context.subscriptions.push(
		vscode.commands.registerCommand("md2gost.render_docx",
			(uri: vscode.Uri) => onRenderCommand(assets, uri, false),
		)
	);
	context.subscriptions.push(
		vscode.commands.registerCommand("md2gost.render_docx_fast",
			(uri: vscode.Uri) => onRenderCommand(assets, uri, false, true),
		)
	);
}

export function deactivate() { }

let rendering = false;
function onRenderCommand(assets: string, uri: vscode.Uri, renderPDF: boolean, disableMacros = false)
{
	if (rendering)
	{
		vscode.window.showErrorMessage("Already rendering");
		return;
	}
	const file = uri ? uri.fsPath : vscode.window.activeTextEditor?.document.fileName;
	if (!file)
	{
		vscode.window.showErrorMessage("No file opened");
		return;
	}

	vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "Rendering...",
		cancellable: false,
	},
		async (progress, token) =>
		{
			try
			{
				rendering = true;
				await vscode.window.activeTextEditor?.document.save();
				const { fout: fname, err, warn } = await render(
					(increment, message) => progress.report({ increment, message }),
					assets,
					file,
					renderPDF,
					disableMacros,
				);
				if (err == "inPS") vscode.window.showErrorMessage(`Unknown error! Возможно у вас не установлен Word или установлен неправильно`);
				if (err == "noPS") vscode.window.showErrorMessage(`Cant start PowerShell! Возможно он не прописан у вас в PATH`);
				if (warn) vscode.window.showWarningMessage(warn);
				progress.report({ increment: 100, message: "Done!" });
				vscode.window.showInformationMessage(`File rendered to ${fname}`, "Open").then(v =>
				{
					if (v != "Open") return;
					openFile(fname);
				});
			}
			catch (x)
			{
				console.error(x);
				x = trimStart(`${x}`, "Error: ");
				vscode.window.showErrorMessage(`Error: ${x}`);
			}
			finally
			{
				rendering = false;
			}
			// token.onCancellationRequested(() =>
			// {
			// 	console.log("User cancelled the operation.");
			// });
			// for (let i = 0; i < 10; i++)
			// {
			// 	if (token.isCancellationRequested) { return; }

			// 	progress.report({ increment: 10, message: `Step ${i + 1} of 10...` });

			// 	await new Promise(resolve => setTimeout(resolve, 1000));
			// }
		}
	);
}

function showChangelogOnUpdate(context: vscode.ExtensionContext)
{
	const packageVersion = context.extension.packageJSON.version;
	const pageVersion = "2";
	const lastVersion = context.globalState.get<string>("extension_version");

	if (pageVersion !== lastVersion)
	{
		context.globalState.update("extension_version", pageVersion);
		vscode.commands.executeCommand("md2gost.whats_new");
	}

	context.subscriptions.push(
		vscode.commands.registerCommand("md2gost.whats_new", () =>
		{
			const panel = vscode.window.createWebviewPanel(
				"whats_new",
				"md2gost: What's New",
				vscode.ViewColumn.One,
				{
					enableScripts: true,
				}
			);
			const rootUri = panel.webview.asWebviewUri(context.extensionUri);
			const filePath = context.asAbsolutePath(path.join("assets", "whats_new.html"));
			const html = fs.readFileSync(filePath, "utf8");
			panel.webview.html = html.replaceAll("{{root}}", rootUri.toString()).replaceAll("{{currentVersion}}", packageVersion);
		})
	);
}
