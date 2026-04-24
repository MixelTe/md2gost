import path from "path";
import { parseMD, runifyDoc } from "./parser";
import { serializeDocx } from "./serializer";
import { checkIfFileIsBlocked, choice, trimEnd, type SetProgressFn } from "./utils";
import { enrichDoc } from "./enricher";
import { spawn } from "child_process";
import fs from "fs/promises";
import { existsSync } from "fs";
import { PDFDocument } from "pdf-lib";
import type { Doc, RunicDoc } from "./doc";
import { alchemist } from "./alchemist";
import PizZip from "pizzip";

const DISABLE_MACRO = false;

export async function render(progress: SetProgressFn, assets: string, file: string, renderPDF: boolean, disableMacros: boolean, logwarn: (msg: string) => void = console.warn)
{
	// progress(10, "Trying to understand your scribbles");
	progress(10, "Пытаемся понять, что вы тут написали...");
	const fin = path.resolve(file);
	const doc = await parseMD(fin, logwarn);
	// console.log(doc);

	// progress(10, "Trying to understand your scribbles");
	progress(10, "Колдуем над синтаксисом...");
	enrichDoc(doc, logwarn);
	// console.log(doc);

	const runicDoc = runifyDoc(doc);
	// console.log(runicDoc);
	alchemist(runicDoc, logwarn);
	// console.log(runicDoc);

	const p = path.parse(fin);
	const fdir = p.dir;
	const fname = trimEnd(p.name, ".g");
	const ftmp = path.join(fdir, fname + ".tmp.docx");
	const fout = path.join(fdir, fname + ".docx");
	if (await checkIfFileIsBlocked(ftmp))
		throw new Error(`Закройте docx файл. Output file is busy or locked: ${ftmp}`);
	if (await checkIfFileIsBlocked(fout))
		throw new Error(`Закройте docx файл. Output file is busy or locked: ${fout}`);
	// progress(10, "Rendering to docx");
	progress(10, phrase_renderDocx());
	await serializeDocx(runicDoc, ftmp, fdir, assets);

	let willRunMacros = !disableMacros && (renderPDF || hasReasonForRunningMacros(runicDoc));

	let warn = null as null | string;
	if (process.platform != "win32" && willRunMacros)
	{
		warn = "Функционал ограничен, полный функционал только на Windows (more info in readme)";
		willRunMacros = false;
	}

	if (willRunMacros)
	{
		// progress(20, "Running complex macros");
		progress(20, phrase_runMacros());
		const tmpfolder = path.join(fdir, ".md2gost_out");
		await fs.rm(tmpfolder, { recursive: true, force: true });
		try
		{
			const ok = await runDocxMacro(progress, assets, fdir, ftmp, fout, renderPDF);
			if (!ok)
			{
				await fs.rename(ftmp, fout);
				return { fout, err: "inPS" };
			}
		}
		catch (x)
		{
			console.error(x);
			await fs.rename(ftmp, fout);
			return { fout, err: "noPS" };
		}
		await fs.unlink(ftmp);
		const errorTxt = path.join(tmpfolder, "error.txt");
		if (existsSync(errorTxt))
		{
			const err = await fs.readFile(errorTxt);
			await fs.rm(tmpfolder, { recursive: true, force: true });
			console.error(err);
			throw new Error(`Всё сломалось. VBA error: ${err}`);
		}
		await updateMetadata(fout, doc);
		if (renderPDF)
		{
			// progress(40, "Combine all together")
			progress(40, phrase_combine());
			if (!existsSync(tmpfolder))
				throw new Error(`Всё сломалось. PDF render error`);
			const files = (await fs.readdir(tmpfolder)).sort().map(f => path.join(tmpfolder, f));
			const fout = path.join(fdir, fname + ".pdf");
			await mergePDFs(files, fout, doc);
			await fs.rm(tmpfolder, { recursive: true, force: true });
			return { fout };
		}
	}
	else
	{
		await fs.rename(ftmp, fout);
	}
	return { fout, warn };
}

function hasReasonForRunningMacros(doc: RunicDoc)
{
	if (DISABLE_MACRO) return false;
	return doc.nodes.some(n => n.type == "code" || n.type == "table");
}

function runDocxMacro(progress: SetProgressFn, assets: string, cwd: string, fin: string, fout: string, renderPDF: boolean)
{
	const script = path.join(assets, "run.ps1");
	const templateMacro = path.join(assets, "template.dotm");
	const template = path.join(assets, "template.dotx");
	// console.log(template);
	return new Promise<boolean>((res, rej) =>
	{
		const child = spawn("powershell", [
			"-NoProfile", "-ExecutionPolicy", "Bypass",
			"-File", script,
			"-InputDoc", fin,
			"-OutputDoc", fout,
			"-MacroTemplate", templateMacro,
			"-Template", template,
			...(renderPDF ? ["-RenderPDF"] : []),
		], { cwd });
		// ], { cwd, detached: true, shell: true });

		child.stdout.on("data", (data) =>
		{
			data = `${data}`;
			const m = /\[\*(\d)\]/.exec(data);
			if (m) progress(20, {
				// "1": "Fixing breaks (listings)",
				"1": render_fixingBreaks(),
				// "2": "Fixing breaks (tables)",
				"2": render_fixingBreaks(),
				// "3": "Rendering to PDF",
				"3": render_renderPDF(),
			}[m[1]] || "Make some work");
			console.log(`PS: ${data}`);
		});
		let ok = true;
		child.stderr.on("data", (data) =>
		{
			ok = false;
			console.error(`PS: ${data}`);
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


async function mergePDFs(files: string[], fout: string, doc?: Doc)
{
	const mergedPdf = await PDFDocument.create();
	if (doc?.title) mergedPdf.setTitle(doc.title, { showInWindowTitleBar: true });
	if (doc?.author) mergedPdf.setAuthor(doc.author);
	if (doc?.ctime) mergedPdf.setCreationDate(doc.ctime);
	if (doc?.mtime) mergedPdf.setModificationDate(doc.mtime);
	for (const file of files)
	{
		const bytes = await fs.readFile(file);
		const pdf = await PDFDocument.load(bytes);
		const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
		pages.forEach((page) => mergedPdf.addPage(page));
	}
	const pdfBytes = await mergedPdf.save();
	await fs.writeFile(fout, pdfBytes);
}

async function updateMetadata(docfile: string, doc: Doc)
{
	if (!(doc.ctime || doc.mtime || doc.author || doc.etime)) return;
	const content = await fs.readFile(docfile);
	const zip = new PizZip(content);

	function replaceTag(xml: string, tag: string, value: string): string
	{
		const regex = new RegExp(`(<${tag}\\b[^>]*>)(.*?)(</${tag}>)`, "gs");
		return xml.replace(regex, (m, otag, old, ctag) =>
			`${otag}${escapeXml(value)}${ctag}`
		);
	}

	let coreXml = zip.file("docProps/core.xml")!.asText();
	// if (doc.title) coreXml = replaceTag(coreXml, "dc:title", doc.title);
	// if (doc.subject) coreXml = replaceTag(coreXml, "dc:subject", doc.subject);
	if (doc.ctime) coreXml = replaceTag(coreXml, "dcterms:created", doc.ctime.toISOString());
	if (doc.mtime) coreXml = replaceTag(coreXml, "dcterms:modified", doc.mtime.toISOString());
	if (doc.author) coreXml = replaceTag(coreXml, "cp:lastModifiedBy", doc.author);
	zip.file("docProps/core.xml", coreXml);

	if (doc.etime)
	{
		let appXml = zip.file("docProps/app.xml")!.asText();
		appXml = replaceTag(appXml, "TotalTime", `${doc.etime}`);
		zip.file("docProps/app.xml", appXml);
	}

	const buffer = zip.generate({ type: "nodebuffer" });
	await fs.writeFile(docfile, buffer);

	function escapeXml(unsafe: string)
	{
		return unsafe.replaceAll(/[<>&"']/g, (ch) =>
		{
			switch (ch)
			{
				case '<': return '&lt;';
				case '>': return '&gt;';
				case '&': return '&amp;';
				case '"': return '&quot;';
				case "'": return '&apos;';
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
