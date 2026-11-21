import path from "path";
import { parseMD, runifyDoc } from "./parser";
import { serializeDocx } from "./serializer";
import { checkIfFileIsBlocked, choice, randomInt, trimEnd, type JSONDict, type SetProgressFn } from "./utils";
import { enrichDoc } from "./enricher";
import fs from "fs/promises";
import { existsSync } from "fs";
import { PDFDocument } from "pdf-lib";
import { assemblePDFManifest } from "./pdfMerge";
import type { Doc, RunicDoc } from "./doc";
import { alchemist } from "./alchemist";
import PizZip from "pizzip";
import type { TemplateExecOptions } from "./preprocessor";
import { OfficeError, resolveOfficeEngine, runDocxMacro, runLibreOffice, type OfficeEngineType } from "./office";

const DISABLE_MACRO = false;

export interface RenderOptions
{
	progress?: SetProgressFn;
	assets: string;
	file: string;
	output?: string;
	renderPDF?: boolean;
	removeIntermediateDocx?: boolean;
	disableMacros?: boolean;
	engine?: OfficeEngineType;
	sofficePath?: string;
	unoPythonPath?: string;
	checkFilesIsInsidePath?: string | false;
	variables?: JSONDict;
	templateOptions?: TemplateExecOptions;
	logwarn?: (msg: string) => void;
	loginfo?: (msg: string) => void;
	logPS?: (msg: string) => void;
	logPSError?: (msg: string) => void;
	signal?: AbortSignal | null;
}

export async function render({
	progress = (increment: number, message: string) => { },
	assets,
	file,
	output,
	renderPDF = false,
	removeIntermediateDocx = false,
	disableMacros = false,
	engine = "auto",
	sofficePath,
	unoPythonPath,
	checkFilesIsInsidePath = "",
	templateOptions = { allowIncludes: true, allowLoops: true },
	variables,
	logwarn = console.warn,
	loginfo = console.info,
	logPS = msg => console.log(`PS: ${msg}`),
	logPSError = msg => console.error(`PS ERROR: ${msg}`),
	signal = null,
}: RenderOptions): Promise<{
	fout: string;
	err?: "inPS" | "noPS" | "vba" | "pdf" | "noOffice" | "office";
	errS?: unknown;
}>
{
	signal?.throwIfAborted();

	const fin = path.resolve(file);
	// progress(10, "Trying to understand your scribbles");
	progress(10, "Пытаемся понять, что вы тут написали...");
	loginfo(`[!1] Parsing file ${fin}`);
	const doc = await parseMD(fin, variables, templateOptions, checkFilesIsInsidePath, signal, logwarn);
	signal?.throwIfAborted();
	// console.log(doc);

	// progress(10, "Trying to understand your scribbles");
	progress(10, "Колдуем над синтаксисом...");
	loginfo("[!2] Processing document");
	enrichDoc(doc, logwarn);
	// console.log(doc);

	const runicDoc = runifyDoc(doc);
	// console.log(runicDoc);
	alchemist(runicDoc, logwarn);
	// console.log(runicDoc);

	const pout = output && path.parse(path.resolve(output));
	if (pout) await fs.mkdir(pout.dir, { recursive: true });
	const p = path.parse(fin);
	const fdir = p.dir;
	const fname = trimEnd(p.name, ".g");
	const fout = pout ? path.join(pout.dir, pout.name + ".docx") : path.join(fdir, fname + ".docx");
	if (await checkIfFileIsBlocked(fout))
		throw new Error(`Закройте docx файл. Output file is busy or locked: ${fout}`);
	const workdir = await fs.mkdtemp(path.join(path.dirname(fout), ".md2gost-"));
	const ftmp = path.join(workdir, "input.docx");
	const processed = path.join(workdir, "output.docx");
	const tmpfolder = path.join(workdir, ".md2gost_out");
	try
	{
		signal?.throwIfAborted();
		progress(10, phrase_renderDocx());
		loginfo("[!3] Serializing to docx");
		await serializeDocx(runicDoc, ftmp, fdir, assets, checkFilesIsInsidePath, logwarn);
		const willRunMacros = !disableMacros && (renderPDF || hasReasonForRunningMacros(runicDoc));
		if (!willRunMacros)
		{
			signal?.throwIfAborted();
			await fs.rename(ftmp, fout);
			return { fout };
		}
		let selected: Exclude<OfficeEngineType, "auto"> | undefined;
		try
		{
			signal?.throwIfAborted();
			selected = await resolveOfficeEngine(engine, signal);
			progress(20, phrase_runMacros(selected == "word"));
			loginfo(`[!4] Starting ${selected}`);
			if (selected == "libreoffice")
				await runLibreOffice({
					assets, input: ftmp, output: processed, cwd: fdir, workdir, renderPDF, signal, sofficePath, unoPythonPath,
					log: logPS, logError: logPSError,
					progress: stage => progress(12, stage == "3" ? render_renderPDF() : render_fixingBreaks()),
				});
			else if (!await runDocxMacro(
				stage => progress(12, { "1": render_fixingBreaks(), "3": render_renderPDF() }[stage] || "Make some work"),
				logPS, logPSError, assets, fdir, ftmp, processed, renderPDF, signal,
			))
			{
				await fs.rename(ftmp, fout);
				return { fout, err: "inPS" };
			}
		}
		catch (error)
		{
			signal?.throwIfAborted();
			await fs.rename(ftmp, fout);
			if (process.platform == "win32" && engine == "auto" && selected == "libreoffice" && error instanceof OfficeError && error.code == "noOffice")
			{
				logPSError(error.message + "\n");
				return { fout, err: "noOffice", errS: new OfficeError("noOffice", "Не удалось использовать ни Microsoft Word, ни LibreOffice. Установите или настройте один из них.", { cause: error }) };
			}
			return { fout, err: error instanceof OfficeError ? error.code : selected == "libreoffice" ? "office" : "noPS", errS: error };
		}
		signal?.throwIfAborted();
		const errorTxt = path.join(tmpfolder, "error.txt");
		if (existsSync(errorTxt))
		{
			const err = await fs.readFile(errorTxt, "utf8");
			await fs.rename(ftmp, fout);
			return { fout, err: "vba", errS: err };
		}
		loginfo("[!5] Updating metadata");
		await updateMetadata(processed, doc);
		if (renderPDF)
		{
			signal?.throwIfAborted();
			progress(10, phrase_combine());
			loginfo("[!6] Merging pdfs");
			try
			{
				const files = (await fs.readdir(tmpfolder)).sort().map(f => path.join(tmpfolder, f));
				const pdf = pout ? path.join(pout.dir, pout.name + ".pdf") : path.join(fdir, fname + ".pdf");
				const temporaryPDF = path.join(workdir, "output.pdf");
				await mergePDFs(files, temporaryPDF, doc, signal || undefined);
				signal?.throwIfAborted();
				if (!removeIntermediateDocx) await fs.rename(processed, fout);
				await fs.rename(temporaryPDF, pdf);
				if (removeIntermediateDocx && existsSync(fout)) await fs.unlink(fout);
				return { fout: pdf };
			}
			catch (error)
			{
				signal?.throwIfAborted();
				if (existsSync(processed)) await fs.rename(processed, fout);
				return { fout, err: "pdf", errS: error };
			}
		}
		await fs.rename(processed, fout);
		loginfo(`[!7] Rendered to ${fout}`);
		return { fout };
	}
	finally
	{
		await fs.rm(workdir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
}

function hasReasonForRunningMacros(doc: RunicDoc)
{
	if (DISABLE_MACRO) return false;
	return doc.nodes.some(n => n.type == "code" || n.type == "table" || n.type == "tableOfContents");
}


async function mergePDFs(files: string[], fout: string, doc?: Doc, signal?: AbortSignal)
{
	const pdfFiles = files.filter(file => file.toLowerCase().endsWith(".pdf"));
	let mainPdfIndex = -1;
	for (let i = 0; i < pdfFiles.length; i++)
	{
		if (pdfFiles[i].toLowerCase().endsWith("-main.pdf"))
			mainPdfIndex = i;
	}

	let mergedPdf: PDFDocument;
	const manifest = files.find(file => path.basename(file) === "manifest.json");
	if (manifest)
	{
		mergedPdf = await assemblePDFManifest(manifest, signal);
	}
	else if (mainPdfIndex >= 0)
	{
		const bytes = await fs.readFile(pdfFiles[mainPdfIndex], { signal });
		mergedPdf = await PDFDocument.load(bytes);
		signal?.throwIfAborted();

		let insertionIndex = 0;
		for (const file of pdfFiles.slice(0, mainPdfIndex))
		{
			const sourceBytes = await fs.readFile(file, { signal });
			const pdf = await PDFDocument.load(sourceBytes);
			signal?.throwIfAborted();
			const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
			for (const page of pages)
				mergedPdf.insertPage(insertionIndex++, page);
			signal?.throwIfAborted();
		}

		for (const file of pdfFiles.slice(mainPdfIndex + 1))
		{
			const sourceBytes = await fs.readFile(file, { signal });
			const pdf = await PDFDocument.load(sourceBytes);
			signal?.throwIfAborted();
			const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
			pages.forEach(page => mergedPdf.addPage(page));
			signal?.throwIfAborted();
		}
	}
	else
	{
		mergedPdf = await PDFDocument.create();
		for (const file of pdfFiles)
		{
			const bytes = await fs.readFile(file, { signal });
			const pdf = await PDFDocument.load(bytes);
			signal?.throwIfAborted();
			const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
			pages.forEach(page => mergedPdf.addPage(page));
			signal?.throwIfAborted();
		}
	}

	if (doc?.title) mergedPdf.setTitle(doc.title, { showInWindowTitleBar: true });
	if (doc?.author) mergedPdf.setAuthor(doc.author);
	if (doc?.ctime) mergedPdf.setCreationDate(doc.ctime);
	if (doc?.mtime) mergedPdf.setModificationDate(doc.mtime);
	const pdfBytes = await mergedPdf.save();
	await fs.writeFile(fout, pdfBytes, { signal });
}

async function updateMetadata(docfile: string, doc: Doc)
{
	const content = await fs.readFile(docfile);
	const zip = new PizZip(content);

	function replaceTag(xml: string, tag: string, value: string): string
	{
		const regex = new RegExp(`(<${tag}\\b[^>]*>)(.*?)(</${tag}>)`, "gs");
		return xml.replace(regex, (m, otag, old, ctag) =>
			`${otag}${escapeXml(value)}${ctag}`,
		);
	}

	let coreXml = zip.file("docProps/core.xml")!.asText();
	coreXml = replaceTag(coreXml, "dc:title", doc.title || "Document");
	// if (doc.subject) coreXml = replaceTag(coreXml, "dc:subject", doc.subject);
	if (doc.ctime) coreXml = replaceTag(coreXml, "dcterms:created", doc.ctime.toISOString());
	if (doc.mtime) coreXml = replaceTag(coreXml, "dcterms:modified", doc.mtime.toISOString());
	coreXml = replaceTag(coreXml, "dc:creator", doc.author || "Student");
	coreXml = replaceTag(coreXml, "cp:lastModifiedBy", doc.author || "Student");
	zip.file("docProps/core.xml", coreXml);

	let appXml = zip.file("docProps/app.xml")!.asText();
	appXml = replaceTag(appXml, "TotalTime", `${doc.etime || randomInt(30, 120)}`);
	zip.file("docProps/app.xml", appXml);

	const buffer = zip.generate({ type: "nodebuffer" });
	await fs.writeFile(docfile, buffer);

	function escapeXml(unsafe: string)
	{
		return unsafe.replaceAll(/[<>&"']/g, ch =>
		{
			switch (ch)
			{
				case "<": return "&lt;";
				case ">": return "&gt;";
				case "&": return "&amp;";
				case '"': return "&quot;";
				case "'": return "&apos;";
				default: return ch;
			}
		});
	}
}


// Эпос офисной магии
const phrase_renderDocx = () => choice(
	"Материализуем бумажный артефакт...",
	"Куем DOCX в текстовой кузнице...",
	"Плетем полотно документа...",
	"Трансмутируем простые символы в величественные страницы...",
	"Выковываем страницы из руды символов...",
	"Отливаем форму будущих страниц...",
	"Закладываем фундамент великого трактата...",
	"Переплавляем мысли в стройные абзацы...",
	"Слагаем страницы в гармонию структуры...",
);

const phrase_runMacros = (isWord: boolean) => choice(
	isWord ? "Пробуждаем древних духов VBA..." : "Пробуждаем древних духов автоматизации...",
	isWord ? "Призываем дух Ворда из бездны офисного пакета..." : "Призываем помощников из бездны офисного пакета...",
	"Вдыхаем ману в спящие руны автоматизации...",
	"Отпираем тайные функции офисной магии...",
);

const render_fixingBreaks = () => choice(
	"Подклеиваем \"продолжение листинга\" на разорванные страницы...",
	"Подклеиваем \"продолжение таблицы\" на разорванные страницы...",
	"Укрепляем стены секций связующими словами...",
	"Наносим руны преемственности на разрывы страниц...",
	"Чиним баг разрыва повествования...",
	"Соединяем осколки листинга в единое полотно...",
	"Накладываем чары непрерывности на текст...",
);

const render_renderPDF = () => choice(
	"Собираем документы и превращаем их в PDF-свитки...",
	"Обращаем живое слово в незыблемый камень PDF...",
	"Навеки запечатлеваем свитки в кристаллах памяти...",
	"Запечатываем текст в янтаре формата PDF...",
);

const phrase_combine = () => choice(
	"Склеиваем всё синей изолентой...",
	"Скрепляем печатями судьбы последнюю страницу...",
	"Сплавляем финальный артефакт из множества осколков...",
);
