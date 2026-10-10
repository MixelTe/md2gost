import * as vscode from "vscode";
import * as path from "node:path";
import * as picomatch from "picomatch";

interface MarkdownImage {
	fullRange: vscode.Range;
	pathRange: vscode.Range;
	path: string;
}

type OverwriteBehavior = "overwrite" | "nameIncrementally";

interface CopyFileConfiguration {
	destination: Record<string, string>;
	overwriteBehavior: OverwriteBehavior;
}

interface ImageTarget {
	uri: vscode.Uri;
	fileName: string;
	overwrite: boolean;
}

export class MarkdownImageReplacePasteProvider implements vscode.DocumentPasteEditProvider
{
	static readonly kind = vscode.DocumentDropOrPasteEditKind.Empty.append("markdown", "image", "replace");

	async provideDocumentPasteEdits(
		document: vscode.TextDocument,
		ranges: readonly vscode.Range[],
		dataTransfer: vscode.DataTransfer,
		_context: vscode.DocumentPasteEditContext,
		token: vscode.CancellationToken,
	): Promise<vscode.DocumentPasteEdit[] | undefined>
	{
		if (ranges.length !== 1 || document.isUntitled) return;

		const clipboardImage = getClipboardImage(dataTransfer);
		if (!clipboardImage) return;

		const image = findMarkdownImageNear(document, ranges[0]);
		if (!image) return;

		const ref = splitLocalReference(image.path);
		if (!ref) return;

		const ext = getImageExtension(clipboardImage.mime, clipboardImage.file.name);
		if (!ext) return;

		const target = await createTarget(document, ref.path, ext, clipboardImage.file.name, token);
		if (!target || token.isCancellationRequested) return;

		const contents = await clipboardImage.file.data();
		if (token.isCancellationRequested) return;

		const newPath = ref.path
			? replaceBasename(ref.path, target.fileName) + ref.suffix
			: makeMarkdownPath(document, target.uri) + ref.suffix;

		const edit = new vscode.WorkspaceEdit();

		edit.createFile(target.uri, { contents, overwrite: target.overwrite });
		edit.replace(document.uri, image.pathRange, newPath);

		const title = image.path
			? `Replace image with ${target.fileName}`
			: `Paste image as ${target.fileName}`;

		const pasteEdit = new vscode.DocumentPasteEdit("", title, MarkdownImageReplacePasteProvider.kind);
		pasteEdit.additionalEdit = edit;
		return [pasteEdit];
	}
}

export function registerMarkdownImageReplacePaste(context: vscode.ExtensionContext)
{
	context.subscriptions.push(vscode.languages.registerDocumentPasteEditProvider(
		{ language: "markdown" },
		new MarkdownImageReplacePasteProvider(),
		{
			pasteMimeTypes: ["image/*"],
			providedPasteEditKinds: [MarkdownImageReplacePasteProvider.kind],
		},
	));
}

function getClipboardImage(dataTransfer: vscode.DataTransfer)
{
	for (const [mime, item] of dataTransfer)
	{
		if (!mime.toLowerCase().startsWith("image/")) continue;
		const file = item.asFile();
		if (file) return { mime: mime.toLowerCase(), file };
	}
	return;
}

function findMarkdownImageNear(document: vscode.TextDocument, range: vscode.Range): MarkdownImage | undefined
{
	if (range.start.line !== range.end.line) return;

	const lineNo = range.start.line;
	const text = document.lineAt(lineNo).text;
	const images = parseMarkdownImages(text, lineNo);
	if (!images.length) return;

	const start = range.start.character;
	const end = range.end.character;

	const intersecting = images.find(image =>
		start <= image.fullRange.end.character &&
		end >= image.fullRange.start.character,
	);
	if (intersecting) return intersecting;

	const nearby = images
		.map(image => ({ image, distance: whitespaceDistance(text, start, image) }))
		.filter((x): x is { image: MarkdownImage; distance: number } => x.distance !== undefined)
		.sort((a, b) => a.distance - b.distance);

	if (nearby.length) return nearby[0].image;

	// Если на строке только одна картинка, считаем её текущей независимо от позиции курсора.
	if (images.length === 1) return images[0];

	return;
}

function whitespaceDistance(text: string, cursor: number, image: MarkdownImage): number | undefined
{
	const start = image.fullRange.start.character;
	const end = image.fullRange.end.character;

	if (cursor < start)
	{
		const gap = text.slice(cursor, start);
		return /^\s*$/.test(gap) ? start - cursor : undefined;
	}

	if (cursor > end)
	{
		const gap = text.slice(end, cursor);
		return /^\s*$/.test(gap) ? cursor - end : undefined;
	}

	return 0;
}

function parseMarkdownImages(text: string, line: number): MarkdownImage[]
{
	const result: MarkdownImage[] = [];
	let from = 0;

	while (from < text.length)
	{
		const start = text.indexOf("![", from);
		if (start < 0) break;
		if (isEscaped(text, start))
		{
			from = start + 2;
			continue;
		}

		const altEnd = findClosing(text, start + 1, "[", "]");
		if (altEnd < 0 || text[altEnd + 1] !== "(")
		{
			from = start + 2;
			continue;
		}

		const openParen = altEnd + 1;
		const closeParen = findClosingParen(text, openParen);
		if (closeParen < 0)
		{
			from = openParen + 1;
			continue;
		}

		const destination = parseDestination(text, openParen + 1, closeParen);
		if (destination)
		{
			result.push({
				fullRange: new vscode.Range(line, start, line, closeParen + 1),
				pathRange: new vscode.Range(line, destination.start, line, destination.end),
				path: text.slice(destination.start, destination.end),
			});
		}

		from = closeParen + 1;
	}

	return result;
}

function findClosing(text: string, start: number, open: string, close: string)
{
	let depth = 1;

	for (let i = start + 1; i < text.length; i++)
	{
		if (isEscaped(text, i)) continue;
		if (text[i] === open) depth++;
		if (text[i] === close && --depth === 0) return i;
	}

	return -1;
}

function findClosingParen(text: string, start: number)
{
	let depth = 1;
	let quote: '"' | "'" | undefined;
	let angle = false;

	for (let i = start + 1; i < text.length; i++)
	{
		const ch = text[i];
		if (isEscaped(text, i)) continue;

		if (angle)
		{
			if (ch === ">") angle = false;
			continue;
		}

		if (quote)
		{
			if (ch === quote) quote = undefined;
			continue;
		}

		if (ch === "<" && depth === 1)
		{
			angle = true;
			continue;
		}

		if (ch === '"' || ch === "'")
		{
			quote = ch;
			continue;
		}

		if (ch === "(") depth++;
		if (ch === ")" && --depth === 0) return i;
	}

	return -1;
}

/**
 * Разбирает destination у markdown-картинки.
 *
 * В отличие от обычного варианта, здесь пустой destination тоже
 * считается валидным:
 *
 *     ![image]()
 *
 * pathRange в этом случае будет zero-width range между "(" и ")".
 */
function parseDestination(text: string, start: number, end: number): { start: number; end: number } | undefined
{
	const rawStart = start;
	let i = start;
	while (i < end && /\s/.test(text[i])) i++;

	// ![alt]()
	// или ![alt](   )
	if (i >= end) return { start: rawStart, end };

	// Поддерживаем пустой destination с title:
	//
	// ![alt]( "title")
	// ![alt]( 'title')
	//
	// Вставляем путь до пробела, сохраняя title.
	if (i > rawStart && (text[i] === '"' || text[i] === "'"))
		return { start: rawStart, end: rawStart };

	if (text[i] === "<")
	{
		const pathStart = ++i;
		while (i < end && (text[i] !== ">" || isEscaped(text, i))) i++;
		return i > pathStart && i < end ? { start: pathStart, end: i } : undefined;
	}

	const pathStart = i;
	let depth = 0;

	while (i < end)
	{
		const ch = text[i];

		if (isEscaped(text, i))
		{
			i += 2;
			continue;
		}

		if (ch === "(") depth++;
		else if (ch === ")" && depth > 0) depth--;
		else if (/\s/.test(ch) && depth === 0) break;

		i++;
	}

	return i > pathStart ? { start: pathStart, end: i } : undefined;
}

function isEscaped(text: string, index: number)
{
	let count = 0;
	for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) count++;
	return count % 2 === 1;
}

function splitLocalReference(raw: string): { path: string; suffix: string } | undefined
{
	if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return;

	const query = raw.indexOf("?");
	const hash = raw.indexOf("#");
	let index = -1;

	if (query >= 0 && hash >= 0) index = Math.min(query, hash);
	else index = Math.max(query, hash);

	return index < 0
		? { path: raw, suffix: "" }
		: { path: raw.slice(0, index), suffix: raw.slice(index) };
}

/**
 * Если у markdown-картинки уже есть путь, сохраняем старое поведение:
 *
 *     ![](imgs/foo.png)
 *       ->
 *     ![](imgs/foo1.png)
 *
 * Если путь пустой:
 *
 *     ![]()
 *
 * используем markdown.copyFiles.destination и
 * markdown.copyFiles.overwriteBehavior.
 */
async function createTarget(
	document: vscode.TextDocument,
	oldMarkdownPath: string,
	extension: string,
	clipboardFileName: string,
	token: vscode.CancellationToken,
): Promise<ImageTarget | undefined>
{
	const decoded = safeDecodeURIComponent(oldMarkdownPath).replace(/\\/g, "/");

	if (!decoded)
		return createTargetForEmptyPath(document, clipboardFileName, extension, token);

	let oldUri: vscode.Uri;

	if (decoded.startsWith("/"))
	{
		const folder = vscode.workspace.getWorkspaceFolder(document.uri);
		if (!folder) return;
		oldUri = folder.uri.with({ path: path.posix.join(folder.uri.path, decoded.slice(1)) });
	}
	else
	{
		const dir = document.uri.with({ path: path.posix.dirname(document.uri.path) });
		oldUri = dir.with({ path: path.posix.resolve(dir.path, decoded) });
	}

	const dir = oldUri.with({ path: path.posix.dirname(oldUri.path) });
	const oldName = path.posix.basename(oldUri.path);
	const oldExt = path.posix.extname(oldName);
	const oldStem = oldExt ? oldName.slice(0, -oldExt.length) : oldName;
	const stem = sequenceBase(oldStem);

	for (let n = 1; n < 10000; n++)
	{
		if (token.isCancellationRequested) return;
		const fileName = `${stem}${n}.${extension}`;
		const uri = dir.with({ path: path.posix.join(dir.path, fileName) });
		if (!(await exists(uri))) return { uri, fileName, overwrite: false };
	}

	return;
}

async function createTargetForEmptyPath(document: vscode.TextDocument, clipboardFileName: string, extension: string, token: vscode.CancellationToken): Promise<ImageTarget | undefined>
{
	const fileName = normalizeClipboardFileName(clipboardFileName, extension);
	const config = getCopyFileConfiguration(document);
	const desiredUri = getDesiredCopyFileUri(document, fileName, config.destination);

	if (config.overwriteBehavior === "overwrite")
		return { uri: desiredUri, fileName: path.posix.basename(desiredUri.path), overwrite: true };

	const uri = await findAvailableTarget(desiredUri, token);
	if (!uri) return;

	return {
		uri,
		fileName: path.posix.basename(uri.path),
		overwrite: false,
	};
}

function getCopyFileConfiguration(document: vscode.TextDocument): CopyFileConfiguration
{
	const config = vscode.workspace.getConfiguration("markdown", document.uri);
	return {
		destination: config.get<Record<string, string>>("copyFiles.destination") ?? {},
		overwriteBehavior: config.get<string>("copyFiles.overwriteBehavior") === "overwrite" ? "overwrite" : "nameIncrementally",
	};
}

/**
 * Повторяет семантику markdown.copyFiles.destination.
 *
 * Например:
 *
 * {
 *     "*": "${documentDirName}/imgs/${fileName}"
 * }
 */
function getDesiredCopyFileUri(document: vscode.TextDocument, fileName: string, destinations: Record<string, string>)
{
	for (const [rawGlob, destination] of Object.entries(destinations))
	{
		for (const glob of parseCopyFileGlob(rawGlob))
		{
			if (picomatch.isMatch(document.uri.path, glob, { dot: true }))
				return resolveCopyDestination(document.uri, fileName, destination);
		}
	}

	// Поведение VS Code по умолчанию:
	// сохранить файл рядом с Markdown-документом.
	const dir = path.posix.dirname(document.uri.path);

	return document.uri.with({ path: path.posix.join(dir, fileName) });
}

/**
 * VS Code трактует:
 *
 *     "*"
 *
 * как:
 *
 *     "** /*"
 *
 * А glob, начинающийся с "/", привязывается к workspace root.
 */
function parseCopyFileGlob(rawGlob: string): Iterable<string>
{
	if (rawGlob.startsWith("/"))
		return (vscode.workspace.workspaceFolders ?? []).map(folder =>
			vscode.Uri.joinPath(folder.uri, rawGlob).path,
		);

	if (!rawGlob.startsWith("**"))
		return [`**/${rawGlob}`];

	return [rawGlob];
}

/**
 * Разрешает правую часть markdown.copyFiles.destination.
 *
 * Поддерживаются:
 *
 * ${documentDirName}
 * ${documentRelativeDirName}
 * ${documentFileName}
 * ${documentBaseName}
 * ${documentExtName}
 * ${documentFilePath}
 * ${documentRelativeFilePath}
 * ${documentWorkspaceFolder}
 * ${fileName}
 * ${fileExtName}
 * ${unixTime}
 * ${isoTime}
 *
 * А также transforms:
 *
 * ${documentBaseName/(.).*\/$1/}
 */
function resolveCopyDestination(documentUri: vscode.Uri, fileName: string, destination: string)
{
	const resolved = resolveCopyDestinationSetting(documentUri, fileName, destination);

	if (resolved.startsWith("/"))
		return documentUri.with({ path: path.posix.normalize(resolved) });

	const documentDir = path.posix.dirname(documentUri.path);

	return documentUri.with({
		path: path.posix.resolve(documentDir, resolved),
	});
}

function resolveCopyDestinationSetting(documentUri: vscode.Uri, fileName: string, destination: string)
{
	let result = destination.trim();
	if (!result) result = "${fileName}";

	// Начальный "/" в markdown.copyFiles.destination
	// означает путь от корня workspace.
	if (result.startsWith("/"))
		result = "${documentWorkspaceFolder}/" + result.slice(1);

	// Если указан только каталог, VS Code автоматически
	// добавляет имя файла.
	if (result.endsWith("/"))
		result += "${fileName}";

	const documentDir = path.posix.dirname(documentUri.path);
	const documentFileName = path.posix.basename(documentUri.path);
	const documentExtName = path.posix.extname(documentFileName);
	const documentBaseName = documentExtName
		? documentFileName.slice(0, -documentExtName.length)
		: documentFileName;
	const workspaceFolder = vscode.workspace.getWorkspaceFolder(documentUri)?.uri;
	const workspacePath = workspaceFolder?.path ?? documentDir;
	const variables = new Map<string, string>([
		["documentDirName", documentDir],
		[
			"documentRelativeDirName",
			workspaceFolder ? path.posix.relative(workspaceFolder.path, documentDir) : documentDir,
		],
		["documentFileName", documentFileName],
		["documentBaseName", documentBaseName],
		["documentExtName", documentExtName.replace(".", "")],
		["documentFilePath", documentUri.path],
		[
			"documentRelativeFilePath",
			workspaceFolder ? path.posix.relative(workspaceFolder.path, documentUri.path) : documentUri.path,
		],
		["documentWorkspaceFolder", workspacePath],
		["fileName", fileName],
		["fileExtName", path.posix.extname(fileName).replace(".", "")],
		["unixTime", Date.now().toString()],
		["isoTime", new Date().toISOString()],
	]);

	/*
	 * Поддерживает:
	 *
	 * ${fileName}
	 *
	 * и:
	 *
	 * ${documentBaseName/(.).*\/$1/}
	 *
	 * Также \$ позволяет экранировать "$".
	 */
	const variablePattern = /(\\\$)|(?<!\\)\$\{(\w+)(?:\/((?:\\\/|[^}/])+)\/((?:\\\/|[^}/])*)\/)?\}/g;

	return result.replace(variablePattern,
		(
			match,
			escapedDollar: string | undefined,
			name: string | undefined,
			pattern: string | undefined,
			replacement: string | undefined,
		) =>
		{
			if (escapedDollar) return "$";
			if (!name) return match;

			const value = variables.get(name);
			if (value === undefined) return match;

			if (pattern !== undefined && replacement !== undefined)
			{
				try
				{
					return value.replace(
						new RegExp(replaceTransformEscapes(pattern)),
						replaceTransformEscapes(replacement),
					);
				}
				catch
				{
					return value;
				}
			}

			return value;
		},
	);
}

function replaceTransformEscapes(value: string)
{
	return value.replace(/\\\//g, "/");
}

/**
 * При nameIncrementally:
 *
 * image.png
 * image-1.png
 * image-2.png
 * ...
 */
async function findAvailableTarget(desiredUri: vscode.Uri, token: vscode.CancellationToken): Promise<vscode.Uri | undefined>
{
	const dir = path.posix.dirname(desiredUri.path);
	const ext = path.posix.extname(desiredUri.path);
	const fileName = path.posix.basename(desiredUri.path);
	const stem = ext ? fileName.slice(0, -ext.length) : fileName;

	for (let n = 0; n < 10000; n++)
	{
		if (token.isCancellationRequested) return;

		const candidateName = n === 0
			? `${stem}${ext}`
			: `${stem}-${n}${ext}`;

		const candidate = desiredUri.with({
			path: path.posix.join(dir, candidateName),
		});

		if (!(await exists(candidate)))
			return candidate;
	}

	return;
}

/**
 * DataTransferFile.name обычно уже содержит нормальное имя
 * вроде image.png.
 *
 * Если расширения нет, дописываем расширение, определённое
 * через MIME.
 */
function normalizeClipboardFileName(fileName: string, extension: string)
{
	const normalized = fileName.replace(/\\/g, "/");
	let name = path.posix.basename(normalized);
	if (!name) return `image.${extension}`;
	if (!path.posix.extname(name)) name += `.${extension}`;
	return name;
}

/**
 * Строит ссылку относительно текущего Markdown-документа.
 *
 * /project/docs/readme.md
 * /project/docs/imgs/image.png
 *
 * ->
 *
 * imgs/image.png
 */
function makeMarkdownPath(document: vscode.TextDocument, target: vscode.Uri)
{
	const documentDir = path.posix.dirname(document.uri.path);
	const relative = path.posix.relative(documentDir, target.path);
	return relative || path.posix.basename(target.path);
}

function sequenceBase(stem: string)
{
	// foo3 -> foo, screenshot12 -> screenshot.
	// "2024" оставляем как есть, чтобы не получить пустую базу.
	const match = stem.match(/^(.+?\D)\d+$/);
	return sanitizeStem(match?.[1] ?? stem) || "image";
}

function replaceBasename(oldPath: string, fileName: string)
{
	const normalized = oldPath.replace(/\\/g, "/");
	const slash = normalized.lastIndexOf("/");
	return slash < 0 ? fileName : normalized.slice(0, slash + 1) + fileName;
}

async function exists(uri: vscode.Uri)
{
	try
	{
		await vscode.workspace.fs.stat(uri);
		return true;
	}
	catch
	{
		return false;
	}
}

function sanitizeStem(value: string)
{
	return value.trim()  // eslint-disable-next-line no-control-regex
		.replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
		.replace(/\s+/g, "-")
		.replace(/-+/g, "-");
}

function safeDecodeURIComponent(value: string)
{
	try
	{
		return decodeURIComponent(value);
	}
	catch
	{
		return value;
	}
}

function getImageExtension(mime: string, fileName: string)
{
	const extensions: Record<string, string> = {
		"image/png": "png",
		"image/jpeg": "jpg",
		"image/webp": "webp",
		"image/gif": "gif",
		"image/avif": "avif",
		"image/bmp": "bmp",
		"image/tiff": "tiff",
		"image/svg+xml": "svg",
	};

	if (extensions[mime]) return extensions[mime];

	const ext = path.posix.extname(fileName).slice(1).toLowerCase();
	return /^[a-z0-9]+$/.test(ext) ? ext : undefined;
}