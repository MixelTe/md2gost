import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";
import MarkdownIt from "markdown-it";
import { openDocx, xml } from "./helpers/docx";

suite("real VS Code extension host", () =>
{
	let dir: string;
	let extension: vscode.Extension<any>;
	async function document(name: string, text: string)
	{
		const file = path.join(dir, name);
		await fs.writeFile(file, text);
		const doc = await vscode.workspace.openTextDocument(file);
		await vscode.window.showTextDocument(doc);
		return doc;
	}
	async function until(check: () => Promise<boolean> | boolean)
	{
		const deadline = Date.now() + 30000;
		while (Date.now() < deadline)
		{
			if (await check()) return;
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		assert.fail("Timed out waiting for extension result");
	}
	suiteSetup(async function ()
	{
		this.timeout(60000);
		dir = await fs.mkdtemp(path.join(os.tmpdir(), "md2gost-extension-e2e-"));
		extension = vscode.extensions.all.find(e => e.packageJSON.name == "md2gost")!;
		assert.ok(extension, "Development extension is installed");
		await extension.activate();
	});
	suiteTeardown(async () =>
	{
		await vscode.commands.executeCommand("workbench.action.closeAllEditors");
		assert.equal(path.dirname(dir), os.tmpdir());
		assert.ok(path.basename(dir).startsWith("md2gost-extension-e2e-"));
		await fs.rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
	});
	test("registers render, documentation and table commands", async () =>
	{
		const commands = await vscode.commands.getCommands(true);
		for (const name of ["render_docx_fast", "render_docx", "render_pdf", "readme", "whats_new", "edit_table", "reverse_docx", "refresh_docx"])
			assert.ok(commands.includes("md2gost." + name), name);
	});
	test("opens DOCX in the readonly custom editor and refreshes it", async () =>
	{
		const input = vscode.Uri.file(path.join(dir, "viewer.docx"));
		await fs.copyFile(path.join(extension.extensionPath, "resources/gost_example.docx"), input.fsPath);
		const original = await fs.readFile(input.fsPath);
		await vscode.commands.executeCommand("vscode.openWith", input, "md2gost.docxPreview");
		const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
		assert.ok(tab?.input instanceof vscode.TabInputCustom);
		assert.equal(tab.input.viewType, "md2gost.docxPreview");
		assert.equal(tab.input.uri.toString(), input.toString());
		await vscode.commands.executeCommand("md2gost.refresh_docx", input);
		assert.deepEqual(await fs.readFile(input.fsPath), original);
		await vscode.window.tabGroups.close(tab);
	});
	test("formats a real Markdown document without changing URLs or escapes", async () =>
	{
		const doc = await document("format.g.md", "| A | B |\n|:---|---:|\n| a | 123 |\n\nhttps://example.com/a_b \\_literal\\_");
		const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>("vscode.executeFormatDocumentProvider", doc.uri, { tabSize: 4, insertSpaces: false });
		assert.ok(edits?.length);
		const change = new vscode.WorkspaceEdit(); change.set(doc.uri, edits);
		assert.ok(await vscode.workspace.applyEdit(change));
		assert.ok(doc.getText().includes("https://example.com/a_b"));
		assert.ok(doc.getText().includes("\\_literal\\_"));
		assert.match(doc.getText(), /\|\s+A\s+\|\s+B\s+\|/);
		await doc.save();
	});
	test("provides completion and hover through registered providers", async () =>
	{
		const doc = await document("completion.g.md", "!!rule typography nbsp units off\n!!rule typography ");
		const completions = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider", doc.uri, new vscode.Position(1, 18));
		assert.ok(completions.items.some(item => JSON.stringify(item.label).toLowerCase().includes("nbsp")));
		const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", doc.uri, new vscode.Position(0, 24));
		assert.ok(hovers.length > 0);
	});
	test("renders the actual extension Markdown preview hook", () =>
	{
		const md = extension.exports.extendMarkdownIt(new MarkdownIt());
		const html = md.render("!!rule link color 123abc\n!!rule link underline off\n\n# Содержание\n\n# 10.12.3 Длинный заголовок\n\n:::note\n**bold** [link](https://example.org)\n:::", { currentDocument: { fsPath: path.join(dir, "preview.g.md") } });
		assert.ok(html.includes("md2gost_toc-number"));
		assert.ok(html.includes("<strong>bold</strong>"));
		assert.ok(html.includes("color: #123abc"));
	});
	test("exports DOCX through the fast-render command", async function ()
	{
		this.timeout(60000);
		const doc = await document("render.g.md", "# Export\n\nEXT_ITEM_001 **text**\n\nTable\n| A | B |\n|---|---|\n| 1 | 2 |");
		await vscode.commands.executeCommand("md2gost.render_docx_fast", doc.uri);
		const output = path.join(dir, "render.docx");
		await until(async () =>
		{
			try { return xml(openDocx(output), "word/document.xml").includes("EXT_ITEM_001"); }
			catch { return false; }
		});
	});
	test("reports source warnings in Problems and clears them after editing", async function ()
	{
		this.timeout(60000);
		const doc = await document("warnings.g.md", "!!rule unknown_property nope\n\n# Warning");
		await vscode.commands.executeCommand("md2gost.render_docx_fast", doc.uri);
		await until(() => vscode.languages.getDiagnostics(doc.uri).some(d => d.severity == vscode.DiagnosticSeverity.Warning));
		const edit = new vscode.WorkspaceEdit();
		edit.replace(doc.uri, new vscode.Range(0, 0, 0, doc.lineAt(0).text.length), "!!rule text size 14");
		await vscode.workspace.applyEdit(edit);
		await until(() => vscode.languages.getDiagnostics(doc.uri).length == 0);
		await doc.save();
	});
});
