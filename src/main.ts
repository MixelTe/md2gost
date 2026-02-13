import path from "path";
import { parseMD } from "./parser";
import { serializeDocx } from "./serializer";
import { checkIfFileIsBlocked, choice, lt, trimEnd, type SetProgressFn } from "./utils";
import { enrichDoc } from "./enricher";
import { execSync, spawn, spawnSync } from "child_process";
import fs from "fs";
import { PDFDocument } from "pdf-lib";
import type { Doc } from "./doc";

const DISABLE_MACRO = false;

export async function render(progress: SetProgressFn, assets: string, file: string, renderPDF: boolean)
{
	// progress(10, "Trying to understand your scribbles")
	progress(10, "Пытаемся понять, что вы тут написали...")
	const fin = path.resolve(file);
	const doc = await parseMD(fin);
	console.log(doc);

	// progress(10, "Trying to understand your scribbles")
	progress(10, "Колдуем над синтаксисом...")
	enrichDoc(doc);
	console.log(doc);

	const p = path.parse(fin);
	const fdir = p.dir;
	const fname = trimEnd(p.name, ".g");
	const ftmp = path.join(fdir, fname + ".tmp.docx");
	const fout = path.join(fdir, fname + ".docx");
	if (await checkIfFileIsBlocked(ftmp))
		throw new Error(`Output file is busy or locked: ${ftmp}`);
	if (await checkIfFileIsBlocked(fout))
		throw new Error(`Output file is busy or locked: ${fout}`);
	// progress(10, "Rendering to docx")
	progress(10, choice("Материализуем бумажный артефакт...", "Куем DOCX в текстовой кузнице...", "Плетем полотно документа...", "Трансмутируем простые символы в величественные страницы..."))
	await serializeDocx(doc, ftmp, fdir, assets)
	if (renderPDF || hasReasonForRunningMacros(doc))
	{
		// progress(20, "Running complex macros")
		progress(20, choice("Пробуждаем древних духов VBA...", "Призываем дух Ворда из бездны офисного пакета..."))
		const tmpfolder = path.join(fdir, ".md2gost_out");
		if (renderPDF) fs.rmSync(tmpfolder, { recursive: true, force: true });
		await runDocxMacro(progress, assets, fdir, ftmp, fout, renderPDF);
		fs.unlinkSync(ftmp);
		if (renderPDF)
		{
			// progress(40, "Combine all together")
			progress(40, choice("Склеиваем всё синей изолентой...", "Скрепляем печатями судьбы последнюю страницу...", "Сплавляем финальный артефакт из множества осколков..."))
			if (!fs.existsSync(tmpfolder))
				throw new Error(`PDF render error`);
			const files = fs.readdirSync(tmpfolder).sort().map(f => path.join(tmpfolder, f));
			const fout = path.join(fdir, fname + ".pdf");
			await mergePDFs(files, fout);
			fs.rmSync(tmpfolder, { recursive: true, force: true });
			return fout;
		}
	}
	else
	{
		fs.renameSync(ftmp, fout);
	}
	return fout;
}

function hasReasonForRunningMacros(doc: Doc)
{
	if (DISABLE_MACRO) return false;
	return doc.sections.some(s => s.nodes.some(n => n.type == "code"));
}

function runDocxMacro(progress: SetProgressFn, assets: string, cwd: string, fin: string, fout: string, renderPDF: boolean)
{
	const script = path.join(assets, "run.ps1");
	const templateMacro = path.join(assets, "template.dotm");
	const template = path.join(assets, "template.dotx");
	console.log(template);
	return new Promise<number | null>((res, rej) =>
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
				// "1": "Fixing breaks",
				"1": choice("Подклеиваем \"продолжение листинга\" на разорванные страницы...", "Укрепляем стены секций связующими словами...", "Наносим руны преемственности на разрывы страниц..."),
				// "2": "Rendering to PDF",
				"2": choice("Собираем документы и превращаем их в PDF-свитки...", "Обращаем живое слово в незыблемый камень PDF...", "Навеки запечатлеваем свитки в кристаллах памяти..."),
			}[m[1]] || "Make some work")
			console.log(`PS: ${data}`)
		});
		child.stderr.on("data", (data) => console.error(`PS: ${data}`));

		child.on("close", res);
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


async function mergePDFs(files: string[], fout: string)
{
	const mergedPdf = await PDFDocument.create();
	for (const file of files)
	{
		const buffer = fs.readFileSync(file);
		const pdf = await PDFDocument.load(buffer);
		const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
		copiedPages.forEach((page) => mergedPdf.addPage(page));
	}
	const pdf = await mergedPdf.save();
	fs.writeFileSync(fout, pdf);
}
