import path from "path";
import { parseMD, runifyDoc } from "./parser";
import { serializeDocx } from "./serializer";
import { checkIfFileIsBlocked, choice, randomInt, trimEnd, type SetProgressFn } from "./utils";
import { enrichDoc } from "./enricher";
import { spawn } from "child_process";
import fs from "fs/promises";
import { existsSync } from "fs";
import { PDFDocument } from "pdf-lib";
import type { Doc, RunicDoc } from "./doc";
import { alchemist } from "./alchemist";
import PizZip from "pizzip";

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
	useLibreOffice?: boolean;
	logwarn?: (msg: string) => void;
	loginfo?: (msg: string) => void;
	logPS?: (msg: string) => void;
	logPSError?: (msg: string) => void;
}

export async function render({
	progress = (increment: number, message: string) => { },
	assets,
	file,
	output,
	renderPDF = false,
	removeIntermediateDocx = false,
	disableMacros = false,
	useLibreOffice = false,
	logwarn = console.warn,
	loginfo = console.info,
	logPS = msg => console.log(`PS: ${msg}`),
	logPSError = msg => console.error(`PS ERROR: ${msg}`),
}: RenderOptions): Promise<{
	fout: string;
	err?: "inPS" | "noPS" | "vba" | "pdf" | "noWin";
	errS?: any;
}>
{
	const fin = path.resolve(file);
	// progress(10, "Trying to understand your scribbles");
	progress(10, "Пытаемся понять, что вы тут написали...");
	loginfo(`[!1] Parsing file ${fin}`);
	const doc = await parseMD(fin, logwarn);
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
	const ftmp = path.join(fdir, fname + ".tmp.docx");
	const fout = pout ? path.join(pout.dir, pout.name + ".docx") : path.join(fdir, fname + ".docx");
	if (await checkIfFileIsBlocked(ftmp))
		throw new Error(`Закройте docx файл. Output file is busy or locked: ${ftmp}`);
	if (await checkIfFileIsBlocked(fout))
		throw new Error(`Закройте docx файл. Output file is busy or locked: ${fout}`);
	// progress(10, "Rendering to docx");
	progress(10, phrase_renderDocx());
	loginfo("[!3] Serializing to docx");
	await serializeDocx(runicDoc, ftmp, fdir, assets);

	let willRunMacros = !disableMacros && (renderPDF || hasReasonForRunningMacros(runicDoc));

	let limitedRender = false;
	if (process.platform != "win32" && willRunMacros && !useLibreOffice)
	{
		limitedRender = true;
		willRunMacros = false;
	}

	if (willRunMacros)
	{
		// progress(20, "Running complex macros");
		progress(20, phrase_runMacros());
		loginfo("[!4] Starting macros");
		const tmpfolder = path.join(pout ? pout.dir : fdir, ".md2gost_out");
		await fs.rm(tmpfolder, { recursive: true, force: true });
		try
		{
			const macroRunner = useLibreOffice ? runUnoScript : runDocxMacro;
			const ok = await macroRunner(progress, logPS, logPSError, assets, fdir, ftmp, fout, renderPDF);
			if (!ok)
			{
				await fs.rename(ftmp, fout);
				return { fout, err: "inPS" };
			}
		}
		catch (x)
		{
			await fs.rename(ftmp, fout);
			return { fout, err: "noPS", errS: x };
		}
		await fs.unlink(ftmp);
		const errorTxt = path.join(tmpfolder, "error.txt");
		if (existsSync(errorTxt))
		{
			const err = await fs.readFile(errorTxt);
			await fs.rm(tmpfolder, { recursive: true, force: true });
			return { fout, err: "vba", errS: `${err}` };
		}
		loginfo("[!5] Updating metadata");
		await updateMetadata(fout, doc);
		if (renderPDF)
		{
			// progress(10, "Combine all together")
			progress(10, phrase_combine());
			loginfo("[!6] Merging pdfs");
			if (!existsSync(tmpfolder))
				return { fout, err: "pdf" };
			try
			{
				const files = (await fs.readdir(tmpfolder)).sort().map(f => path.join(tmpfolder, f));
				const pdf = pout ? path.join(pout.dir, pout.base) : path.join(fdir, fname + ".pdf");
				await mergePDFs(files, pdf, doc);
				await fs.rm(tmpfolder, { recursive: true, force: true });
				if (removeIntermediateDocx && existsSync(fout)) await fs.unlink(fout);
				return { fout: pdf };
			}
			catch (err)
			{
				return { fout, err: "pdf", errS: err };
			}
		}
	}
	else
	{
		await fs.rename(ftmp, fout);
	}
	loginfo(`[!7] Rendered to ${fout}`);
	return { fout, err: limitedRender ? "noWin" : undefined };
}

function hasReasonForRunningMacros(doc: RunicDoc)
{
	if (DISABLE_MACRO) return false;
	return doc.nodes.some(n => n.type == "code" || n.type == "table");
}

function runDocxMacro(progress: SetProgressFn, log: (msg: string) => void, logError: (msg: string) => void, assets: string, cwd: string, fin: string, fout: string, renderPDF: boolean)
{
	const script = path.join(assets, "run.ps1");
	const templateMacro = path.join(assets, "template.dotm");
	// console.log(template);
	return new Promise<boolean>((res, rej) =>
	{
		const child = spawn("powershell", [
			"-NoProfile", "-ExecutionPolicy", "Bypass",
			"-File", script,
			"-InputDoc", fin,
			"-OutputDoc", fout,
			"-MacroTemplate", templateMacro,
			...(renderPDF ? ["-RenderPDF"] : []),
		], { cwd });
		// ], { cwd, detached: true, shell: true });

		child.stdout.on("data", data =>
		{
			data = `${data}`;
			const m = /\[\*(\d)\]/.exec(data);
			if (m) progress(12, {
				// "1": "Fixing breaks (listings)",
				"1": render_fixingBreaks(),
				// "2": "Fixing breaks (tables)",
				"2": render_fixingBreaks(),
				// "3": "Rendering to PDF",
				"3": render_renderPDF(),
			}[m[1]] || "Make some work");
			log(data);
		});
		let ok = true;
		child.stderr.on("data", data =>
		{
			ok = false;
			logError(`${data}`);
		});

		child.on("close", () => res(ok));
		child.on("error", rej);
	});
	// spawnSync("powershell", [
	// 	"-NoProfile", "-ExecutionPolicy", "Bypass",
	// 	"-File", script,
	// 	"-InputDoc", fin,
	// 	"-OutputDoc", fout,
	// 	"-MacroTemplate", templateMacro,
	// 	"-Template", template,
	// 	...(renderPDF ? ["-RenderPDF"] : []),
	// ], { stdio: "inherit", cwd });
	// execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File macros\\run.ps1 -InputDoc "${fin}" -OutputDoc "${fout}" -MacroTemplate macros\\template.dotm`);
}

/**
 * Resolves the Python executable. On Windows, it attempts to use LibreOffice's bundled python
 * to guarantee the 'uno' library is present without requiring global environment configuration.
 */
function getPythonExecutable(): string
{
	if (process.platform === "win32")
	{
		const loPython = "C:\\Program Files\\LibreOffice\\program\\python.exe";
		if (existsSync(loPython)) return loPython;
	}
	return process.env.UNO_PYTHON_PATH || "python3";
}

function runUnoScript(progress: (inc: number, msg: string) => void, log: (msg: string) => void, logError: (msg: string) => void, assets: string, cwd: string, fin: string, fout: string, renderPDF: boolean): Promise<boolean>
{
	const script = path.join(assets, "macro_engine.py");
	const pythonExec = getPythonExecutable();

	return new Promise<boolean>((res, rej) =>
	{
		const args = [
			script,
			"--input", fin,
			"--output", fout,
		];
		if (renderPDF) args.push("--render-pdf");

		const child = spawn(pythonExec, args, { cwd });

		child.stdout.on("data", data =>
		{
			const lines = `${data}`.split("\n");
			for (const line of lines)
			{
				log(line.trimEnd());
				if (!line.trimEnd()) continue;
				const m = /\[\*(\d)\]/.exec(line);
				if (m)
				{
					const msg = {
						"1": render_fixingBreaks(),
						"2": render_fixingBreaks(),
						"3": render_renderPDF(),
					}[m[1]] || "Processing document...";
					progress(12, msg);
				}
			}
		});

		let ok = true;
		child.stderr.on("data", data =>
		{
			ok = false;
			logError(`${data}`);
		});

		child.on("close", code => res(ok && code == 0));
		child.on("error", rej);
	});
}


async function mergePDFs(files: string[], fout: string, doc?: Doc)
{
	const mergedPdf = await PDFDocument.create();
	if (doc?.title) mergedPdf.setTitle(doc.title, { showInWindowTitleBar: true });
	if (doc?.author) mergedPdf.setAuthor(doc.author);
	if (doc?.ctime) mergedPdf.setCreationDate(doc.ctime);
	if (doc?.mtime) mergedPdf.setModificationDate(doc.mtime);
	for (const file of files)
	{
		if (!file.endsWith(".pdf")) continue;
		const bytes = await fs.readFile(file);
		const pdf = await PDFDocument.load(bytes);
		const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
		pages.forEach(page => mergedPdf.addPage(page));
	}
	const pdfBytes = await mergedPdf.save();
	await fs.writeFile(fout, pdfBytes);
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

const phrase_runMacros = () => choice(
	"Пробуждаем древних духов VBA...",
	"Призываем дух Ворда из бездны офисного пакета...",
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
