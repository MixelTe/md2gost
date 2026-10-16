#!/usr/bin/env node
// Печатает содержимое DOCX по абзацам, чтобы проверить результат md2gost без Word.
// Использование: node docx-text.mjs файл.docx [--grep <регулярное выражение>]
// Обозначения: [стиль] перед абзацем, ↵ — разрыв строки, ⇥ — табуляция, $…$ — формула,
// {поле X} — поле Word (оглавление, число страниц), [изображение], строки таблиц через «|».
// Зависимостей нет: нужен только Node.js, который уже требуется для md2gost.

import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const args = process.argv.slice(2);
const grepAt = args.indexOf("--grep");
const grep = grepAt >= 0 ? new RegExp(args[grepAt + 1] ?? "", "i") : null;
const file = args.find((a, i) => !a.startsWith("--") && (grepAt < 0 || i !== grepAt + 1));
if (!file)
{
	console.error("Использование: node docx-text.mjs файл.docx [--grep <regex>]");
	process.exit(2);
}

const readEntry = openZip(readFileSync(file));
const documentXml = readEntry("word/document.xml");
if (!documentXml)
{
	console.error(`${file}: нет word/document.xml — это не DOCX`);
	process.exit(1);
}
const styleNames = readStyleNames(readEntry("word/styles.xml") ?? "");

const body = documentXml.slice(documentXml.indexOf("<w:body"), documentXml.lastIndexOf("</w:body>"));
const blockRe = /<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>|<w:p\b[^>]*\/>|<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
for (const [block] of body.matchAll(blockRe))
{
	if (block.startsWith("<w:tbl")) printTable(block);
	else printParagraph(block);
}

function printParagraph(p)
{
	const text = paragraphText(p);
	const styleId = /<w:pStyle w:val="([^"]+)"/.exec(p)?.[1];
	const style = styleId ? `[${styleNames.get(styleId) ?? styleId}] ` : "";
	if (text.trim()) emit(style + text);
	// Каждый разрыв отдельной строкой: два подряд означают пустую страницу.
	for (const _ of p.matchAll(/<w:br\b[^>]*w:type="page"/g)) emit("──── разрыв страницы ────");
	if (/<w:pPr\b[\s\S]*?<w:sectPr\b/.test(p)) emit("──── разрыв раздела ────");
}

function printTable(tbl)
{
	emit("[таблица]");
	for (const [row] of tbl.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/g))
	{
		const cells = [...row.matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
			.map(([cell]) => [...cell.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)].map(([p]) => paragraphText(p)).join("↵"));
		emit(`| ${cells.join(" | ")} |`);
	}
}

function paragraphText(p)
{
	const tokenRe = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<m:t(?:\s[^>]*)?>([^<]*)<\/m:t>|<w:instrText[^>]*>([^<]*)<\/w:instrText>|<w:fldSimple\b[^>]*w:instr="([^"]*)"|<w:fldChar\b[^>]*w:fldCharType="(begin|separate|end)"|<w:tab\/>|<w:br\b([^>]*)\/>|<m:oMath\b(?!Para)[^>]*>|<\/m:oMath>|<w:drawing\b/g;
	let out = "";
	let instr = null;
	for (const m of p.matchAll(tokenRe))
	{
		const [tok, wt, mt, instrText, fldSimple, fldChar, brAttrs] = m;
		if (wt !== undefined) out += decode(wt);
		else if (mt !== undefined) out += decode(mt);
		else if (instrText !== undefined) instr = (instr ?? "") + decode(instrText);
		else if (fldSimple !== undefined) out += fieldLabel(decode(fldSimple));
		else if (fldChar === "begin") instr = "";
		else if (fldChar !== undefined)
		{
			if (instr !== null) out += fieldLabel(instr);
			instr = null;
		}
		else if (tok === "<w:tab/>") out += "⇥";
		else if (tok.startsWith("<w:br")) out += /w:type="page"/.test(brAttrs) ? "" : "↵";
		else if (tok.startsWith("<m:oMath") || tok === "</m:oMath>") out += "$";
		else if (tok.startsWith("<w:drawing")) out += "[изображение]";
	}
	return out;
}

function fieldLabel(instruction)
{
	const name = instruction.trim().split(/\s+/)[0] || "?";
	return name === "TOC" ? "{поле TOC: оглавление, заполняется в Word}" : `{поле ${name}}`;
}

function emit(line)
{
	if (!grep || grep.test(line)) console.log(line);
}

function decode(s)
{
	return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_, e) =>
	{
		if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
		return { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" }[e.toLowerCase()];
	});
}

function readStyleNames(stylesXml)
{
	const names = new Map();
	for (const m of stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g))
		names.set(m[1], /<w:name w:val="([^"]+)"/.exec(m[2])?.[1] ?? m[1]);
	return names;
}

// Минимальное чтение ZIP: центральный каталог → локальный заголовок → deflate.
function openZip(buf)
{
	let eocd = -1;
	for (let i = buf.length - 22; i >= Math.max(0, buf.length - 0xffff - 22); i--)
	{
		if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
	}
	if (eocd < 0) throw new Error("файл не является ZIP-архивом (DOCX)");
	const entries = new Map();
	let p = buf.readUInt32LE(eocd + 16);
	for (let n = buf.readUInt16LE(eocd + 10); n > 0 && buf.readUInt32LE(p) === 0x02014b50; n--)
	{
		const nameLen = buf.readUInt16LE(p + 28);
		entries.set(buf.toString("utf8", p + 46, p + 46 + nameLen), {
			method: buf.readUInt16LE(p + 10),
			size: buf.readUInt32LE(p + 20),
			offset: buf.readUInt32LE(p + 42),
		});
		p += 46 + nameLen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
	}
	return name =>
	{
		const e = entries.get(name);
		if (!e) return null;
		const start = e.offset + 30 + buf.readUInt16LE(e.offset + 26) + buf.readUInt16LE(e.offset + 28);
		const data = buf.subarray(start, start + e.size);
		return (e.method === 8 ? inflateRawSync(data) : data).toString("utf8");
	};
}
