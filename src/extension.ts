import * as vscode from "vscode";
import { render } from "./main";

export function activate(context: vscode.ExtensionContext)
{
	const assets = context.asAbsolutePath("assets");

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
}

export function deactivate() { }


function onRenderCommand(assets: string, uri: vscode.Uri, renderPDF: boolean)
{
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
				const fname = await render(
					(increment, message) => progress.report({ increment, message }),
					assets,
					file,
					renderPDF
				)
				vscode.window.showInformationMessage(`File rendered to ${fname}`);
			}
			catch (x)
			{
				vscode.window.showErrorMessage(`Error occured: ${x}`);
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
	)
}