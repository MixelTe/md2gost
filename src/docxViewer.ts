import * as vscode from "vscode";
import MarkdownIt from "markdown-it";
import { parseDocx, type DocxNode, type DocxRune, type ParsedDocx } from "./antirender";

const viewType = "md2gost.docxPreview";
const escapeHtml = new MarkdownIt("zero").utils.escapeHtml;

export function registerDocxViewer(context: vscode.ExtensionContext, logger: vscode.LogOutputChannel)
{
	const provider = new DocxViewerProvider(logger);
	context.subscriptions.push(
		provider,
		vscode.window.registerCustomEditorProvider(viewType, provider, {
			supportsMultipleEditorsPerDocument: true,
			webviewOptions: { enableFindWidget: true },
		}),
		vscode.commands.registerCommand("md2gost.refresh_docx", (uri?: vscode.Uri) => provider.refresh(uri)),
	);
}

class DocxDocument implements vscode.CustomDocument
{
	private readonly changed = new vscode.EventEmitter<void>();
	readonly onDidChange = this.changed.event;
	private readonly watcher: vscode.FileSystemWatcher;
	private controller?: AbortController;
	private timer?: ReturnType<typeof setTimeout>;
	private disposed = false;
	html = page('<p role="status">Загрузка DOCX…</p>');

	constructor(readonly uri: vscode.Uri, private readonly logger: vscode.LogOutputChannel, private readonly onDispose: () => void)
	{
		// Watch the parent directory so replacing a file also refreshes the preview.
		this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.joinPath(uri, ".."), "*"));
		const update = (changed: vscode.Uri) =>
		{
			if (changed.toString() != uri.toString() || this.disposed) return;
			clearTimeout(this.timer);
			this.timer = setTimeout(() => { void this.reload(); }, 150);
		};
		this.watcher.onDidChange(update);
		this.watcher.onDidCreate(update);
		this.watcher.onDidDelete(update);
	}

	async reload()
	{
		if (this.disposed) return;
		clearTimeout(this.timer);
		this.controller?.abort();
		const controller = this.controller = new AbortController();
		try
		{
			if (this.uri.scheme != "file" && this.uri.scheme != "vscode-remote")
				throw new Error("Просмотр доступен только для файлов на диске.");
			const doc = await parseDocx(this.uri.fsPath, controller.signal);
			if (controller.signal.aborted) return;
			this.html = docxHtml(doc);
		}
		catch (error)
		{
			if (controller.signal.aborted) return;
			const message = error instanceof Error ? error.message : String(error);
			this.logger.error(`DOCX preview: ${this.uri.fsPath}: ${message}`);
			this.html = page(`<p role="alert">Не удалось прочитать DOCX: ${escapeHtml(message)}</p><p>Обновите просмотр после исправления файла.</p>`);
		}
		if (!controller.signal.aborted) this.changed.fire();
	}

	dispose()
	{
		if (this.disposed) return;
		this.disposed = true;
		clearTimeout(this.timer);
		this.controller?.abort();
		this.watcher.dispose();
		this.changed.dispose();
		this.onDispose();
	}
}

class DocxViewerProvider implements vscode.CustomReadonlyEditorProvider<DocxDocument>, vscode.Disposable
{
	private readonly documents = new Set<DocxDocument>();
	private readonly panels = new Map<vscode.WebviewPanel, DocxDocument>();

	constructor(private readonly logger: vscode.LogOutputChannel) {}

	async openCustomDocument(uri: vscode.Uri, _context: vscode.CustomDocumentOpenContext, token: vscode.CancellationToken)
	{
		if (token.isCancellationRequested) throw new vscode.CancellationError();
		const doc = new DocxDocument(uri, this.logger, () => this.documents.delete(doc));
		this.documents.add(doc);
		const cancellation = token.onCancellationRequested(() => doc.dispose());
		try
		{
			await doc.reload();
			if (token.isCancellationRequested) throw new vscode.CancellationError();
			return doc;
		}
		catch (error) { doc.dispose(); throw error; }
		finally { cancellation.dispose(); }
	}

	resolveCustomEditor(doc: DocxDocument, panel: vscode.WebviewPanel, token: vscode.CancellationToken)
	{
		if (token.isCancellationRequested) return;
		panel.webview.options = { enableScripts: false, localResourceRoots: [], enableCommandUris: false };
		panel.webview.html = doc.html;
		this.panels.set(panel, doc);
		const subscription = doc.onDidChange(() => { panel.webview.html = doc.html; });
		panel.onDidDispose(() =>
		{
			subscription.dispose();
			this.panels.delete(panel);
		});
	}

	async refresh(uri?: vscode.Uri)
	{
		for (const [panel, doc] of this.panels)
			if (uri ? doc.uri.toString() == uri.toString() : panel.active) { await doc.reload(); return; }
	}

	dispose()
	{
		for (const doc of this.documents) doc.dispose();
		this.panels.clear();
	}
}

export function docxHtml(doc: ParsedDocx): string
{
	const images = new Map(doc.images.map(image =>
	{
		const format = /\.(png|jpe?g|gif|bmp|svg)$/i.exec(image.name)?.[1].toLowerCase();
		const mime = format == "svg" ? "svg+xml" : format == "jpg" ? "jpeg" : format;
		return [image.id, { name: image.name, url: mime ? `data:image/${mime};base64,${Buffer.from(image.data).toString("base64")}` : undefined }];
	}));
	function image(id: string, width?: number, height?: number)
	{
		const picture = images.get(id);
		if (!picture?.url) return `<span class="unsupported">Изображение недоступно: ${escapeHtml(picture?.name || id)}</span>`;
		const dimension = (name: string, value?: number) => value && Number.isFinite(value) && value > 0 ? ` ${name}="${value}"` : "";
		return `<img src="${picture.url}" alt="Изображение"${dimension("width", width)}${dimension("height", height)}>`;
	}
	function inline(runes: DocxRune[]): string
	{
		return runes.map(rune =>
		{
			if (rune.image) return image(rune.image, rune.width, rune.height);
			if (rune.pageBreak) return '<span class="unsupported">[Разрыв страницы]</span>';
			let text = escapeHtml(rune.text);
			if (rune.mono) text = `<code>${text}</code>`;
			if (rune.italic) text = `<em>${text}</em>`;
			if (rune.bold) text = `<strong>${text}</strong>`;
			if (rune.unsupported) text = `<span class="unsupported" title="${escapeHtml(rune.unsupported)}">[${escapeHtml(rune.unsupported)}] ${text}</span>`;
			return text;
		}).join("");
	}
	function nodes(items: DocxNode[]): string
	{
		return items.map(node =>
		{
			const id = `id="block-${node.id}"`;
			const caption = "title" in node && node.title ? `<figcaption>${inline(node.title)}</figcaption>` : "";
			switch (node.type)
			{
				case "title":
					const level = Math.max(1, Math.min(6, node.level));
					return `<h${level} ${id}>${inline(node.text)}</h${level}>`;
				case "text": return `<p ${id}>${inline(node.text) || "<br>"}</p>`;
				case "listItem": return `<div ${id} class="list-item" style="margin-left: ${node.level * 1.5}em"><span class="list-label">${escapeHtml(node.label)}</span><div>${inline(node.text)}</div></div>`;
				case "code": return `<figure ${id}>${caption}<pre><code>${escapeHtml(node.text)}</code></pre></figure>`;
				case "table": return `<figure ${id}>${caption}<div class="table"><table>${node.rows.map(row => `<tr>${row.map(cell => `<td>${nodes(cell)}</td>`).join("")}</tr>`).join("")}</table></div></figure>`;
				case "image": return `<figure ${id} class="image">${image(node.image, node.width, node.height)}${caption}</figure>`;
				case "pageBreak": return `<div ${id} class="page-break">Разрыв страницы</div>`;
				case "toc": return `<p ${id} class="unsupported">Оглавление (поле Word)</p>`;
				case "unsupported": return `<p ${id} class="unsupported">[${escapeHtml(node.kind)}] ${escapeHtml(node.text)}</p>`;
			}
		}).join("\n");
	}
	const warnings = doc.warnings.length ? `<details class="warnings"><summary>Предупреждения (${doc.warnings.length})</summary><ul>${doc.warnings.map(warning => `<li>${warning.block ? `<a href="#block-${warning.block}">Блок ${warning.block}</a>: ` : ""}${escapeHtml(warning.message)}</li>`).join("")}</ul></details>` : "";
	return page(`${warnings}<article>${nodes(doc.nodes) || "<p>Документ пуст.</p>"}</article>`);
}

function page(content: string): string
{
	return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Просмотр DOCX</title>
<style>
body { font-family: var(--vscode-font-family); color: var(--vscode-editor-foreground); background: var(--vscode-editor-background); font-size: var(--vscode-font-size); line-height: 1.6; padding: 20px; max-width: 960px; margin: auto; overflow-wrap: anywhere; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.5em 0 .75em; }
p { margin: .75em 0; white-space: pre-wrap; }
figure { margin: 1.25em 0; }
figcaption { white-space: pre-wrap; margin: .5em 0; }
.image { text-align: center; }
img { max-width: 100%; height: auto; vertical-align: middle; }
pre, code { font-family: var(--vscode-editor-font-family); }
code { white-space: pre-wrap; }
pre { background: var(--vscode-textCodeBlock-background); padding: 12px; overflow-x: auto; overflow-wrap: normal; }
pre code { white-space: pre; background: transparent; }
.table { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
td { border: 1px solid var(--vscode-panel-border); padding: 6px 10px; vertical-align: top; min-width: 40px; }
td > p:first-child { margin-top: 0; }
td > p:last-child { margin-bottom: 0; }
.list-item { display: flex; gap: .6em; margin-top: .25em; }
.list-item > div { white-space: pre-wrap; min-width: 0; }
.list-label { flex-shrink: 0; }
.unsupported, .page-break { color: var(--vscode-descriptionForeground); }
.page-break { border-top: 1px dashed var(--vscode-panel-border); margin: 24px 0; text-align: center; font-size: .85em; }
.warnings { border: 1px solid var(--vscode-editorWarning-foreground); padding: 8px 12px; }
a { color: var(--vscode-textLink-foreground); }
:target { outline: 1px solid var(--vscode-focusBorder); }
</style>
</head>
<body><main>${content}</main></body>
</html>`;
}
