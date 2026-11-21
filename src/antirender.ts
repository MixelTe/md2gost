import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import PizZip from "pizzip";
import { xml2js, type Element } from "xml-js";
import { UserInputError } from "./errors";
import { stringifyTable } from "./markdownTable";
import { protectLinkAddresses } from "./inline";
import { isSpecialHeading } from "./sections";

export interface DocxRune
{
	text: string;
	bold?: boolean;
	italic?: boolean;
	mono?: boolean;
	font?: string;
	image?: string;
	width?: number;
	height?: number;
	unsupported?: string;
	pageBreak?: boolean;
}

export interface DocxWarning
{
	code: string;
	message: string;
	block?: number;
}

export interface DocxImage
{
	id: string;
	part: string;
	name: string;
	/** Embedded bytes. Inspection output includes metadata only. */
	data: Uint8Array;
}

interface DocxNodeProperties
{
	id: number;
	style?: string;
	styleName?: string;
}

export type DocxNode = DocxNodeProperties & (
	| { type: "text", text: DocxRune[], caption?: "table" | "code" | "image" }
	| { type: "title", text: DocxRune[], level: number }
	| { type: "listItem", text: DocxRune[], level: number, ordered: boolean, number: number, label: string, format: string, simple: boolean, mark: "." | ")" }
	| { type: "code", text: string, title?: DocxRune[], inferred: boolean, fonts: string[] }
	| { type: "table", rows: DocxNode[][][], title?: DocxRune[], complex: boolean }
	| { type: "image", image: string, width?: number, height?: number, title?: DocxRune[] }
	| { type: "toc" | "pageBreak" }
	| { type: "unsupported", kind: string, text: string }
);

export interface ParsedDocx
{
	nodes: DocxNode[];
	images: DocxImage[];
	warnings: DocxWarning[];
}

export interface MDReverseConfig
{
	input: string;
	/** Output file or directory. Defaults to <input name>.g.md beside the DOCX. */
	output?: string;
	/** Replace an existing Markdown output. Existing image directories are never replaced. */
	overwrite?: boolean;
	abortSignal?: AbortSignal;
}

export interface MDReverseResult
{
	filePath: string;
	images: string[];
	warnings: DocxWarning[];
}

export interface MDInspectConfig
{
	input: string;
	format?: "text" | "json";
	abortSignal?: AbortSignal;
}

export interface MDInspectResult
{
	content: string;
	warnings: DocxWarning[];
}

interface RunProperties
{
	bold?: boolean;
	italic?: boolean;
	font?: string;
	hidden?: boolean;
}

interface ParagraphProperties
{
	outline?: number;
	numId?: string;
	level?: number;
	pageBreak?: boolean;
}

interface DocxStyle
{
	name: string;
	basedOn?: string;
	run: RunProperties;
	paragraph: ParagraphProperties;
}

function localName(value: string | undefined)
{
	return value?.split(":").at(-1) || "";
}

function elements(node: Element | undefined, name?: string): Element[]
{
	return (node?.elements || []).filter(n => n.type == "element" && (!name || localName(n.name) == name));
}

function child(node: Element | undefined, name: string)
{
	return elements(node, name)[0];
}

function attribute(node: Element | undefined, name: string): string | undefined
{
	const pair = Object.entries(node?.attributes || {}).find(([key]) => localName(key) == name);
	return pair?.[1] === undefined ? undefined : String(pair[1]);
}

function descendants(node: Element | undefined, name: string): Element[]
{
	return elements(node).flatMap(n => [
		...(localName(n.name) == name ? [n] : []),
		...descendants(n, name),
	]);
}

function xmlText(node: Element | undefined): string
{
	return (node?.elements || []).map(n => n.type == "text" ? String(n.text ?? "") : xmlText(n)).join("");
}

function visibleText(node: Element | undefined): string
{
	return descendants(node, "t").map(xmlText).join("");
}

function toggle(node: Element | undefined): boolean | undefined
{
	return node ? !["0", "false", "off"].includes(attribute(node, "val") || "") : undefined;
}

function numberValue(node: Element | undefined, fallback: number)
{
	const value = Number(attribute(node, "val"));
	return node && Number.isFinite(value) ? value : fallback;
}

/** Read document content and styles without writing files or starting Office. */
export async function parseDocx(input: string, signal?: AbortSignal): Promise<ParsedDocx>
{
	signal?.throwIfAborted();
	const buffer = await fs.readFile(input, { signal });
	signal?.throwIfAborted();
	let zip: PizZip;
	try { zip = new PizZip(buffer); }
	catch (cause)
	{
		const error = new UserInputError(`Cannot read DOCX archive: ${input}`);
		error.cause = cause;
		throw error;
	}
	const result: ParsedDocx = { nodes: [], images: [], warnings: [] };
	const mergedBlocks = new Map<number, number>();
	let nextId = 1;
	function warn(block: number | undefined, code: string, message: string)
	{
		if (!result.warnings.some(w => w.block == block && w.code == code && w.message == message))
			result.warnings.push({ code, message, ...(block ? { block } : {}) });
	}
	function readXml(part: string, required = false): Element | undefined
	{
		signal?.throwIfAborted();
		const entry = zip.file(part);
		if (!entry)
		{
			if (required) throw new UserInputError(`DOCX is missing ${part}`);
			return;
		}
		try { return xml2js(entry.asText(), { compact: false, captureSpacesBetweenElements: true }) as Element; }
		catch (cause)
		{
			const error = new UserInputError(`Cannot parse DOCX XML: ${part}`);
			error.cause = cause;
			throw error;
		}
	}
	function relationships(part: string)
	{
		const relPath = part ? path.posix.join(path.posix.dirname(part), "_rels", path.posix.basename(part) + ".rels") : "_rels/.rels";
		return elements(child(readXml(relPath), "Relationships"), "Relationship").map(rel =>
		{
			const target = attribute(rel, "Target") || "";
			const external = attribute(rel, "TargetMode") == "External";
			return {
				id: attribute(rel, "Id") || "", type: attribute(rel, "Type")?.split("/").at(-1), external,
				target: external ? target : path.posix.normalize(target.startsWith("/") ? target.slice(1) : path.posix.join(path.posix.dirname(part), target)),
			};
		});
	}
	const mainPart = relationships("").find(r => r.type == "officeDocument" && !r.external)?.target || "word/document.xml";
	const document = child(readXml(mainPart, true), "document");
	const body = child(document, "body");
	if (!body) throw new UserInputError("DOCX has no document body");
	const rels = relationships(mainPart);
	function related(type: string, fallback: string)
	{
		return rels.find(r => r.type == type && !r.external)?.target || path.posix.join(path.posix.dirname(mainPart), fallback);
	}
	const stylesRoot = child(readXml(related("styles", "styles.xml")), "styles");
	const theme = readXml(related("theme", "theme/theme1.xml"));
	const fontScheme = descendants(theme, "fontScheme")[0];
	function fontName(fonts: Element | undefined)
	{
		const explicit = attribute(fonts, "ascii") || attribute(fonts, "hAnsi") || attribute(fonts, "cs");
		if (explicit) return explicit;
		const reference = attribute(fonts, "asciiTheme") || attribute(fonts, "hAnsiTheme");
		if (!reference) return;
		return attribute(child(child(fontScheme, reference.startsWith("major") ? "majorFont" : "minorFont"), "latin"), "typeface");
	}
	function runProperties(node: Element | undefined): RunProperties
	{
		const values: RunProperties = {
			bold: toggle(child(node, "b")), italic: toggle(child(node, "i")),
			font: fontName(child(node, "rFonts")), hidden: toggle(child(node, "vanish")),
		};
		return Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined));
	}
	function paragraphProperties(node: Element | undefined): ParagraphProperties
	{
		const num = child(node, "numPr");
		return {
			...(child(node, "outlineLvl") ? { outline: numberValue(child(node, "outlineLvl"), 9) } : {}),
			...(child(num, "numId") ? { numId: attribute(child(num, "numId"), "val") } : {}),
			...(child(num, "ilvl") ? { level: numberValue(child(num, "ilvl"), 0) } : {}),
			...(child(node, "pageBreakBefore") ? { pageBreak: toggle(child(node, "pageBreakBefore")) } : {}),
		};
	}
	const defaults = child(stylesRoot, "docDefaults");
	const defaultRun = runProperties(child(child(defaults, "rPrDefault"), "rPr"));
	const defaultParagraph = paragraphProperties(child(child(defaults, "pPrDefault"), "pPr"));
	const styles = new Map<string, DocxStyle>();
	let normalStyle: string | undefined;
	for (const style of elements(stylesRoot, "style"))
	{
		const id = attribute(style, "styleId") || "";
		styles.set(id, {
			name: attribute(child(style, "name"), "val") || id,
			basedOn: attribute(child(style, "basedOn"), "val"),
			run: runProperties(child(style, "rPr")), paragraph: paragraphProperties(child(style, "pPr")),
		});
		if (attribute(style, "type") == "paragraph" && attribute(style, "default") == "1") normalStyle = id;
	}
	function styleProperties(id: string | undefined, seen = new Set<string>()): { run: RunProperties, paragraph: ParagraphProperties }
	{
		if (!id || !styles.has(id)) return { run: {}, paragraph: {} };
		if (seen.has(id))
		{
			warn(undefined, "style-cycle", `Cyclic style inheritance: ${id}`);
			return { run: {}, paragraph: {} };
		}
		seen.add(id);
		const style = styles.get(id)!;
		const base = styleProperties(style.basedOn, seen);
		return { run: { ...base.run, ...style.run }, paragraph: { ...base.paragraph, ...style.paragraph } };
	}
	const normal = styleProperties(normalStyle);
	const bodyRun = { ...defaultRun, ...normal.run };
	const fontTable = child(readXml(related("fontTable", "fontTable.xml")), "fonts");
	const fixedFonts = new Set(elements(fontTable, "font").filter(f => attribute(child(f, "pitch"), "val") == "fixed").map(f => (attribute(f, "name") || "").toLowerCase()));
	function isMono(font: string | undefined)
	{
		return !!font && (fixedFonts.has(font.toLowerCase()) || /(?:mono|courier|consolas|menlo|monaco|lucida console|terminal|fixedsys|cascadia code|source code pro)/i.test(font));
	}
	const numbering = child(readXml(related("numbering", "numbering.xml")), "numbering");
	const numbers = new Map(elements(numbering, "num").map(n => [attribute(n, "numId"), n]));
	const abstracts = new Map(elements(numbering, "abstractNum").map(n => [attribute(n, "abstractNumId"), n]));
	const counters = new Map<string, number[]>();
	function listLevel(id: string, level: number)
	{
		const instance = numbers.get(id);
		const abstract = abstracts.get(attribute(child(instance, "abstractNumId"), "val"));
		const override = elements(instance, "lvlOverride").find(n => Number(attribute(n, "ilvl")) == level);
		const definition = child(override, "lvl") || elements(abstract, "lvl").find(n => Number(attribute(n, "ilvl")) == level);
		return { definition, start: numberValue(child(override, "startOverride"), numberValue(child(definition, "start"), 1)) };
	}
	function listNumber(properties: ParagraphProperties, block: number)
	{
		const id = properties.numId;
		if (!id || id == "0") return;
		const level = Math.max(0, Math.min(8, properties.level || 0));
		const { definition, start } = listLevel(id, level);
		if (!definition)
		{
			warn(block, "numbering", `Missing numbering definition ${id}, level ${level}`);
			return;
		}
		const values = counters.get(id) || [];
		values[level] = values[level] === undefined ? start : values[level]! + 1;
		for (let i = level + 1; i < values.length; i++)
		{
			const restart = numberValue(child(listLevel(id, i).definition, "lvlRestart"), i);
			if (restart > 0 && level < restart) delete values[i];
		}
		counters.set(id, values);
		const format = attribute(child(definition, "numFmt"), "val") || "decimal";
		const pattern = attribute(child(definition, "lvlText"), "val") || (format == "bullet" ? "•" : `%${level + 1}.`);
		const label = pattern.replace(/%([1-9])/g, (_, index: string) =>
		{
			const i = Number(index) - 1;
			const upper = listLevel(id, i);
			return formatNumber(values[i] ?? upper.start, attribute(child(upper.definition, "numFmt"), "val") || "decimal");
		});
		const simple = format == "bullet" || (format == "decimal" && new RegExp(`^%${level + 1}[.)]?$`).test(pattern));
		if (!simple) warn(block, "number-format", `Numbering ${format}/${pattern} is retained as visible text`);
		return { level, number: values[level]!, ordered: format != "bullet", label, format, simple, mark: pattern.endsWith(")") ? ")" as const : "." as const };
	}
	const imageIds = new Map<string, DocxImage>();
	function readImage(id: string, block: number)
	{
		if (imageIds.has(id)) return imageIds.get(id)!;
		const rel = rels.find(r => r.id == id && r.type == "image");
		const entry = rel && !rel.external && zip.file(rel.target);
		if (!entry)
		{
			warn(block, "image", `Embedded image is unavailable: ${rel?.target || id}`);
			return;
		}
		const image: DocxImage = { id, part: rel!.target, name: path.posix.basename(rel!.target), data: entry.asUint8Array() };
		imageIds.set(id, image);
		result.images.push(image);
		if (!/\.(png|jpe?g|gif|bmp|svg)$/i.test(image.name))
			warn(block, "image-format", `Image ${image.name} must be converted before rendering with md2gost`);
		return image;
	}
	const notes = new Map<string, string>();
	for (const kind of ["footnote", "endnote"])
		for (const note of elements(child(readXml(related(kind + "s", kind + "s.xml")), kind + "s"), kind))
			notes.set(kind + attribute(note, "id"), elements(note, "p").map(visibleText).join("\n"));
	const fields: { code: string, result: boolean, suppress: boolean }[] = [];
	function readParagraph(paragraph: Element): DocxNode[]
	{
		signal?.throwIfAborted();
		const id = nextId++;
		const pPr = child(paragraph, "pPr");
		const style = attribute(child(pPr, "pStyle"), "val") || normalStyle;
		const inherited = styleProperties(style);
		const properties = { ...defaultParagraph, ...normal.paragraph, ...inherited.paragraph, ...paragraphProperties(pPr) };
		const paragraphRun = { ...bodyRun, ...inherited.run };
		const base: DocxNodeProperties = { id, ...(style ? { style, styleName: styles.get(style)?.name || style } : {}) };
		const runes: DocxRune[] = [];
		const runFonts = new Set<string | undefined>();
		let toc = false;
		function walkInline(node: Element, formatting: RunProperties)
		{
			const name = localName(node.name);
			if (["pPr", "rPr", "instrText", "fldChar"].includes(name))
			{
				const field = fields.at(-1);
				if (name == "fldChar")
				{
					const type = attribute(node, "fldCharType");
					if (type == "begin") fields.push({ code: "", result: false, suppress: false });
					else if (type == "separate" && field) field.result = true;
					else if (type == "end") fields.pop();
				}
				if (name == "instrText" && field)
				{
					field.code += xmlText(node);
					if (/^\s*TOC\b/i.test(field.code)) { field.suppress = true; toc = true; }
				}
				return;
			}
			if (name == "r")
			{
				const rPr = child(node, "rPr");
				formatting = { ...formatting, ...styleProperties(attribute(child(rPr, "rStyle"), "val")).run, ...runProperties(rPr) };
				if (!formatting.hidden && !fields.some(f => !f.result || f.suppress)) runFonts.add(formatting.font);
			}
			if (["del", "moveFrom"].includes(name)) { warn(id, "revisions", "Tracked changes are read as their final visible version"); return; }
			if (["ins", "moveTo"].includes(name)) warn(id, "revisions", "Tracked changes are read as their final visible version");
			if (name == "AlternateContent")
			{
				const branch = child(node, "Choice") || child(node, "Fallback");
				if (branch) walkInline(branch, formatting);
				return;
			}
			if (name == "fldSimple" && /^\s*TOC\b/i.test(attribute(node, "instr") || "")) { toc = true; return; }
			if (formatting.hidden || fields.some(f => !f.result || f.suppress))
			{
				if (["t", "tab", "br", "drawing", "pict", "oMath", "oMathPara"].includes(name)) return;
			}
			const rune: DocxRune = {
				text: "", ...(formatting.bold ? { bold: true } : {}), ...(formatting.italic ? { italic: true } : {}),
				...(formatting.font ? { font: formatting.font } : {}),
				...(isMono(formatting.font) && !isMono(bodyRun.font) ? { mono: true } : {}),
			};
			if (name == "t") { runes.push({ ...rune, text: xmlText(node) }); return; }
			if (name == "tab" || name == "ptab") { runes.push({ ...rune, text: "\t" }); return; }
			if (name == "noBreakHyphen") { runes.push({ ...rune, text: "\u2011" }); return; }
			if (name == "softHyphen") { runes.push({ ...rune, text: "\u00AD" }); return; }
			if (name == "sym")
			{
				warn(id, "symbol", "Font-specific symbol requires manual conversion");
				runes.push({ text: `${attribute(node, "font") || ""} ${attribute(node, "char") || ""}`, unsupported: "symbol" });
				return;
			}
			if (name == "br" || name == "cr")
			{
				runes.push({ ...rune, text: "\n", ...(attribute(node, "type") == "page" ? { pageBreak: true } : {}) });
				return;
			}
			if (["oMath", "oMathPara", "footnoteReference", "endnoteReference"].includes(name))
			{
				const note = name.startsWith("footnote") ? "footnote" : name.startsWith("endnote") ? "endnote" : undefined;
				const kind = note || "OMML";
				warn(id, kind, `${kind} requires manual conversion`);
				runes.push({ ...rune, unsupported: kind, text: note ? notes.get(note + attribute(node, "id")) || "" : visibleText(node) });
				return;
			}
			if (name == "drawing" || name == "pict" || name == "object")
			{
				const pictures = [...descendants(node, "blip"), ...descendants(node, "imagedata")];
				if (!pictures.length || name == "object") warn(id, "drawing", "Drawing or embedded object requires manual review; available previews are retained");
				for (const picture of pictures)
				{
					const image = attribute(picture, "embed") || attribute(picture, "id") || attribute(picture, "link") || "";
					readImage(image, id);
					const extent = descendants(node, "extent")[0];
					const width = Number(attribute(extent, "cx")) / 9525;
					const height = Number(attribute(extent, "cy")) / 9525;
					runes.push({ text: "", image, ...(width > 0 ? { width: Math.round(width) } : {}), ...(height > 0 ? { height: Math.round(height) } : {}) });
				}
				if (!pictures.length) runes.push({ text: visibleText(node), unsupported: "drawing" });
				return;
			}
			for (const n of elements(node)) walkInline(n, formatting);
		}
		for (const node of elements(paragraph)) walkInline(node, paragraphRun);
		for (let i = 1; i < runes.length; i++)
		{
			const a = runes[i - 1]!;
			const b = runes[i]!;
			if ((a.bold || a.italic) && (b.bold || b.italic) && (a.bold != b.bold || a.italic != b.italic)
				&& /\S$/.test(a.text) && /^\S/.test(b.text) && !a.mono && !b.mono)
				warn(id, "inline-formatting", "Adjacent emphasis is simplified to retain literal text in md2gost");
		}
		if (toc) return [{ ...base, type: "toc" }];
		if (!runes.length && fields.some(f => f.suppress)) return [];
		const output: DocxNode[] = [];
		if (properties.pageBreak) output.push({ id: nextId++, type: "pageBreak" });
		if (runes.some(r => r.image || r.pageBreak))
		{
			let pending: DocxRune[] = [];
			const nextBase = () => ({ ...base, id: output.some(n => n.id == base.id) ? nextId++ : base.id });
			const flush = () => { if (pending.length) output.push({ ...nextBase(), type: "text", text: pending }); pending = []; };
			for (const rune of runes)
			{
				if (rune.image)
				{
					flush();
					output.push({ ...nextBase(), type: "image", image: rune.image,
						...(rune.width ? { width: rune.width } : {}), ...(rune.height ? { height: rune.height } : {}) });
				}
				else if (rune.pageBreak) { flush(); output.push({ id: nextId++, type: "pageBreak" }); }
				else pending.push(rune);
			}
			flush();
			return output;
		}
		const list = listNumber(properties, id);
		const outline = properties.outline;
		const styleLabel = (base.styleName || "").toLowerCase();
		const namedHeading = /^(?:heading|заголовок)\s*([1-6])$/i.exec(styleLabel);
		if ((outline !== undefined && outline < 9) || namedHeading)
		{
			const sourceLevel = outline !== undefined && outline < 9 ? outline + 1 : Number(namedHeading![1]);
			if (sourceLevel > 6) warn(id, "heading-level", `Heading level ${sourceLevel} is reduced to level 6`);
			const level = Math.min(6, sourceLevel);
			return [...output, { ...base, type: "title", level, text: [...(list ? [{ text: list.label + " " }] : []), ...runes] }];
		}
		if (/^(?:toc|contents|оглавление)\s*\d/i.test(styleLabel)) return [...output, { ...base, type: "toc" }];
		if (list) return [...output, { ...base, type: "listItem", text: runes, ...list }];
		const styleNames: string[] = [];
		const seenStyles = new Set<string>();
		for (let current = style; current && !seenStyles.has(current); current = styles.get(current)?.basedOn)
		{
			seenStyles.add(current);
			styleNames.push(current, styles.get(current)?.name || "");
		}
		const styleKey = styleNames.join(" ").replace(/[\s_.-]/g, "");
		const knownCode = /listingcode\d*/i.test(styleKey);
		const textRunes = runes.filter(r => r.text.trim());
		const fontRunes = (textRunes.length ? textRunes : runes).filter(r => r.text);
		// Empty paragraphs can carry their font on the paragraph mark or an empty run.
		const emptyFont = runProperties(child(pPr, "rPr")).font;
		const inferredFonts = fontRunes.length ? fontRunes.map(r => r.font)
			: emptyFont ? [emptyFont] : runFonts.size ? [...runFonts] : [paragraphRun.font];
		const inferred = !isMono(bodyRun.font) && inferredFonts.every(isMono);
		if ((knownCode || inferred) && !runes.some(r => r.unsupported))
			return [...output, { ...base, type: "code", text: runes.map(r => r.text).join(""), inferred: !knownCode,
				fonts: [...new Set(runes.flatMap(r => r.font ? [r.font] : []))] }];
		const text = runes.map(r => r.text).join("");
		const caption = /tablecaption/i.test(styleKey) || /^(?:Таблица|Table)\s+[\dА-ЯA-Z]/iu.test(text) ? "table"
			: /listingcaption/i.test(styleKey) || /^(?:Листинг|Listing)\s+[\dА-ЯA-Z]/iu.test(text) ? "code"
				: /^(?:Рисунок|Рис\.|Figure|Fig\.)\s+[\dА-ЯA-Z]/iu.test(text) ? "image" : undefined;
		output.push({ ...base, type: "text", text: runes, ...(caption ? { caption } : {}) });
		return output;
	}
	function readBlocks(container: Element): DocxNode[]
	{
		const nodes: DocxNode[] = [];
		for (const node of elements(container))
		{
			signal?.throwIfAborted();
			const name = localName(node.name);
			if (name == "p") nodes.push(...readParagraph(node));
			else if (name == "tbl")
			{
				const id = nextId++;
				const complex = descendants(node, "gridSpan").length > 0 || descendants(node, "vMerge").length > 0 || descendants(node, "tbl").length > 0;
				if (complex) warn(id, "table", "Merged cells or nested tables are flattened; review this table");
				const rows = elements(node, "tr").map(row => elements(row, "tc").flatMap(cell =>
				{
					const cells = [readBlocks(cell)];
					const span = numberValue(child(child(cell, "tcPr"), "gridSpan"), 1);
					for (let i = 1; i < Math.min(span, 1000); i++) cells.push([]);
					return cells;
				}));
				if (descendants(node, "oMath").length && rows.length == 1 && rows[0]?.length == 3 && !rows[0][0]?.some(n => nodeText(n).trim()))
				{
					const merge = (items: DocxNode[]) => items.forEach(n => { mergedBlocks.set(n.id, id); if (n.type == "table") n.rows.forEach(row => row.forEach(merge)); });
					rows.forEach(row => row.forEach(merge));
					warn(id, "OMML", "OMML formula and its number require manual conversion");
					nodes.push({ id, type: "unsupported", kind: "OMML", text: rows[0].map(cell => cell.map(nodeText).join("\n")).join(" ").trim() });
				}
				else if (!rows.length)
				{
					warn(id, "table", "Unsupported table structure requires manual conversion");
					nodes.push({ id, type: "unsupported", kind: "table", text: visibleText(node) });
				}
				else nodes.push({ id, type: "table", rows, complex });
			}
			else if (name == "sdt")
			{
				const properties = child(node, "sdtPr");
				const gallery = attribute(descendants(properties, "docPartGallery")[0], "val") || attribute(child(properties, "alias"), "val") || "";
				if (/^(?:toc|table of contents|оглавление|содержание)(?:$|[\s_])/i.test(gallery)
					|| descendants(node, "instrText").some(n => /^\s*TOC\b/i.test(xmlText(n))))
					nodes.push({ id: nextId++, type: "toc" });
				else if (child(node, "sdtContent")) nodes.push(...readBlocks(child(node, "sdtContent")!));
			}
			else if (["customXml", "ins", "moveTo"].includes(name))
			{
				if (name != "customXml") warn(undefined, "revisions", "Tracked changes are read as their final visible version");
				nodes.push(...readBlocks(node));
			}
			else if (["del", "moveFrom"].includes(name)) warn(undefined, "revisions", "Tracked changes are read as their final visible version");
			else if (!["sectPr", "tcPr", "tblPr", "tblGrid", "bookmarkStart", "bookmarkEnd", "proofErr"].includes(name))
			{
				const id = nextId++;
				warn(id, "unsupported", `Unsupported document element: ${name}`);
				nodes.push({ id, type: "unsupported", kind: name, text: visibleText(node) });
			}
		}
		return normalize(nodes);
	}
	function normalize(nodes: DocxNode[])
	{
		const normalized: DocxNode[] = [];
		for (let i = 0; i < nodes.length; i++)
		{
			const node = nodes[i]!;
			const previous = normalized.at(-1);
			if ((node.type == "table" || node.type == "code") && previous?.type == "text" && previous.caption == node.type)
			{
				node.title = previous.text;
				mergedBlocks.set(previous.id, node.id);
				normalized.pop();
			}
			if (node.type == "image" && nodes[i + 1]?.type == "text")
			{
				const caption = nodes[i + 1]!;
				if (caption.type == "text" && caption.caption == "image") { node.title = caption.text; mergedBlocks.set(caption.id, node.id); i++; }
			}
			const last = normalized.at(-1);
			if (node.type == "code" && last?.type == "code" && !node.title)
			{
				last.text += "\n" + node.text;
				last.fonts = [...new Set([...last.fonts, ...node.fonts])];
				mergedBlocks.set(node.id, last.id);
				continue;
			}
			if (node.type == "toc" && last?.type == "toc") { mergedBlocks.set(node.id, last.id); continue; }
			if (node.type == "listItem" && node.level > 0 && (last?.type != "listItem" || last.level < node.level - 1))
			{
				warn(node.id, "list-level", "List level has no parent item; its label is retained as visible text");
				node.simple = false;
			}
			if (node.type == "listItem" && node.ordered && node.level > 0 && last?.type == "listItem" && last.level == node.level && node.number != last.number + 1)
			{
				warn(node.id, "list-restart", "A nested numbering restart is retained as visible text");
				node.simple = false;
			}
			normalized.push(node);
		}
		for (const node of normalized)
			if (node.type == "code" && /^```/m.test(node.text))
				warn(node.id, "code-fence", "Code contains an md2gost closing fence; retained in a comment for manual editing");
		return normalized;
	}
	result.nodes = readBlocks(body);
	for (const warning of result.warnings)
	{
		const seen = new Set<number>();
		while (warning.block && mergedBlocks.has(warning.block) && !seen.has(warning.block))
		{
			seen.add(warning.block);
			warning.block = mergedBlocks.get(warning.block);
		}
	}
	if (fields.length) warn(undefined, "field", "An unclosed Word field was found");
	signal?.throwIfAborted();
	return result;
}

function formatNumber(value: number, format: string): string
{
	if (format == "upperLetter" || format == "lowerLetter")
	{
		let letters = "";
		for (let n = value; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + (n - 1) % 26) + letters;
		return format == "lowerLetter" ? letters.toLowerCase() : letters;
	}
	if ((format == "upperRoman" || format == "lowerRoman") && value > 0 && value < 4000)
	{
		let roman = "";
		for (const [n, letters] of [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]] as const)
			while (value >= n) { roman += letters; value -= n; }
		return format == "lowerRoman" ? roman.toLowerCase() : roman;
	}
	return String(value);
}

function nodeText(node: DocxNode): string
{
	if (node.type == "table") return node.rows.map(row => row.map(cell => cell.map(nodeText).join("\n")).join(" | ")).join("\n");
	if ("text" in node) return typeof node.text == "string" ? node.text : node.text.map(r => r.text).join("");
	return "";
}

function comment(text: string)
{
	// Comment payloads may contain source code; escape HTML reversibly, retaining --.
	return `<!-- DOCX: ${text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")} -->`;
}

function escapeText(text: string)
{
	const addresses: string[] = [];
	text = protectLinkAddresses(text, value => `\uE210${addresses.push(value) - 1}\uE211`);
	return text.replace(/[\\`*_[\]$&<>]/g, "\\$&").replaceAll("{{", "\\{{").replaceAll("\n", "<br>")
		.replace(/\uE210(\d+)\uE211/g, (_, index: string) => addresses[Number(index)]!);
}

function serializeRunes(runes: DocxRune[], onMono: () => void): string
{
	const merged: DocxRune[] = [];
	for (const rune of runes)
	{
		const previous = merged.at(-1);
		const plain = previous && !previous.unsupported && !rune.unsupported && !previous.image && !rune.image;
		const same = plain && !!previous.bold == !!rune.bold && !!previous.italic == !!rune.italic && !!previous.mono == !!rune.mono;
		const adjacentEmphasis = plain && !previous.mono && !rune.mono && (previous.bold || previous.italic) && (rune.bold || rune.italic)
			&& /\S$/.test(previous.text) && /^\S/.test(rune.text);
		if (same || adjacentEmphasis)
		{
			previous!.text += rune.text;
			if (!same) { previous!.bold = !!previous!.bold && !!rune.bold; previous!.italic = !!previous!.italic && !!rune.italic; }
		}
		else merged.push({ ...rune });
	}
	return merged.map(rune =>
	{
		if (rune.unsupported) return comment(`${rune.unsupported}; ${rune.text}`);
		if (rune.mono && rune.text && !rune.text.includes("\n"))
		{
			const length = Math.max(0, ...[...rune.text.matchAll(/`+/g)].map(m => m[0].length)) + 1;
			if (length < 3)
			{
				onMono();
				const ticks = "`".repeat(length);
				return ticks + rune.text + ticks;
			}
		}
		const text = escapeText(rune.text);
		const match = /^(\s*)([\s\S]*?)(\s*)$/.exec(text)!;
		const marker = (rune.bold ? "**" : "") + (rune.italic ? "*" : "");
		return marker && match[2] ? match[1] + marker + match[2] + marker + match[3] : text;
	}).join("");
}

function protectParagraph(text: string)
{
	if (/^\d+[.)]\s/.test(text)) return text.replace(/^(\d+)([.)])/, "$1\\$2");
	if (/^(?:[!#|]|[-*]\s|:::|---)/.test(text)) return "\\" + text;
	if (/^ {4}|^\t/.test(text)) return "&Tab;" + text.trimStart();
	return text;
}

/** Serialize the shared representation; paths map image IDs to extracted files. */
export function serializeMD(document: ParsedDocx, imagePaths: ReadonlyMap<string, string> = new Map()): string
{
	const rules = new Set<string>();
	const inline = (runes: DocxRune[]) => serializeRunes(runes, () => rules.add("backtick_mono on"));
	function image(node: Extract<DocxNode, { type: "image" }>)
	{
		const source = imagePaths.get(node.image) || "";
		const supported = !source || /\.(png|jpe?g|gif|bmp|svg)$/i.test(source);
		const caption = inline(node.title || []);
		const dimensions = node.width || node.height ? `{${node.width || ""}x${node.height || ""}}` : "";
		return [!supported ? comment(`Convert image ${source} to a supported format`) : "",
			`![${caption}](${supported && source ? `<${source}>` : ""})${dimensions}`].filter(Boolean).join("\n");
	}
	function blocks(nodes: DocxNode[]): string
	{
		const output: string[] = [];
		let previous: DocxNode | undefined;
		let listNumbers: number[] = [];
		for (const node of nodes)
		{
			let text = "";
			if (node.type == "text") text = protectParagraph(inline(node.text));
			else if (node.type == "title")
			{
				let title = inline(node.text.map(r => ({ ...r, bold: false, italic: false, mono: false })));
				// Imported special sections already contain their generated content.
				if (node.level == 1 && isSpecialHeading(nodeText(node)))
					title = "\\" + title;
				text = "#".repeat(node.level) + " " + title;
			}
			else if (node.type == "listItem")
			{
				const simple = node.simple && node.level < 6;
				if (simple)
				{
					if (node.ordered && node.mark == ".") rules.add("list ordered style keep");
					rules.add("list autopunctuation off");
				}
				if (simple && node.ordered && listNumbers[node.level] !== undefined && node.number != listNumbers[node.level]! + 1)
				{
					output.push(comment("List numbering restart"));
					previous = undefined;
					listNumbers = [];
				}
				if (simple) { listNumbers[node.level] = node.number; listNumbers.length = node.level + 1; }
				text = simple ? "    ".repeat(node.level) + (node.ordered ? `${node.number}${node.mark} ` : "- ") + inline(node.text)
					: protectParagraph(escapeText(node.label) + " " + inline(node.text));
			}
			else if (node.type == "code")
			{
				text = /^```/m.test(node.text) ? comment(`Block ${node.id}; edit code fence manually\n${node.text}`)
					: "```text" + (node.title ? " " + inline(node.title) : "") + "\n" + node.text + "\n```";
			}
			else if (node.type == "image") text = image(node);
			else if (node.type == "table")
			{
				const rows = node.rows.map(row => row.map(cell => cell.map(n =>
					"text" in n && Array.isArray(n.text) ? inline(n.text) : escapeText(nodeText(n))).join("\n")));
				// Retain escaped literal angle brackets through the table formatter's HTML escaping.
				const literals: string[] = [];
				const protectedRows = rows.map(row => row.map(value => value.replace(/\\[<>]/g, value => `\uE212${literals.push(value) - 1}\uE213`)));
				text = [node.complex ? comment(`Block ${node.id}; review flattened merged cells or nested tables`) : "",
					node.title ? inline(node.title) : "<br>",
					stringifyTable({ rows: protectedRows, align: [], bordered: true }, { compact: true })
						.replace(/\uE212(\d+)\uE213/g, (_, index: string) => literals[Number(index)]!)].filter(Boolean).join("\n").trimEnd();
				const cellImages = (items: DocxNode[]): DocxNode[] => items.flatMap(n => n.type == "table" ? n.rows.flatMap(row => row.flatMap(cellImages)) : n.type == "image" ? [n] : []);
				const images = node.rows.flatMap(row => row.flatMap(cellImages));
				if (images.length) text += "\n\n" + blocks(images);
			}
			else if (node.type == "toc")
			{
				if (previous && /^(?:содержание|оглавление)$/iu.test(nodeText(previous).trim()))
				{
					output.pop();
					text = "# " + escapeText(nodeText(previous).trim());
				}
				else text = "# СОДЕРЖАНИЕ";
			}
			else if (node.type == "pageBreak") text = "---";
			else if (node.type == "unsupported") text = comment(`Block ${node.id}; ${node.kind} requires manual conversion\n${node.text}`);
			if (!text.trim()) continue;
			if (node.type == "listItem" && node.simple && previous?.type == "listItem" && previous.simple) output[output.length - 1] += "\n" + text;
			else output.push(text);
			if (node.type != "listItem") listNumbers = [];
			previous = node;
		}
		return output.join("\n\n");
	}
	const content = blocks(document.nodes);
	const header = [...rules].map(rule => "!!rule " + rule).join("\n");
	return (header ? header + "\n\n" : "") + content + "\n";
}

/** Inspection contains all body text and image metadata, without embedded bytes. */
export function serializeInspection(document: ParsedDocx, format: "text" | "json" = "text"): string
{
	if (format == "json")
		return JSON.stringify({ nodes: document.nodes, images: document.images.map(({ data: _, ...image }) => image), warnings: document.warnings }, null, 2) + "\n";
	if (format != "text") throw new UserInputError(`Unknown inspection format: ${format}`);
	function blocks(nodes: DocxNode[], indent = ""): string
	{
		return nodes.map(node =>
		{
			const heading = `${indent}[${node.id}] ${node.type}` + (node.type == "title" ? ` level=${node.level}` : "")
				+ (node.style ? ` style=${node.style}` : "") + (node.styleName && node.styleName != node.style ? ` (${node.styleName})` : "");
			if (node.type == "table") return heading + ` rows=${node.rows.length}\n` + node.rows.map((row, i) => row.map((cell, j) =>
				`${indent}  Cell ${i + 1},${j + 1}:\n${blocks(cell, indent + "    ")}`).join("\n")).join("\n");
			if (node.type == "image")
			{
				const image = document.images.find(i => i.id == node.image);
				return heading + ` ${image?.part || node.image}` + (node.width ? ` ${node.width}x${node.height || ""}` : "")
					+ (node.title ? "\n" + node.title.map(r => r.text).join("") : "");
			}
			const details = node.type == "code" ? ` fonts=${node.fonts.join(",")} inferred=${node.inferred}`
				: node.type == "listItem" ? ` level=${node.level} label=${node.label}` : node.type == "unsupported" ? ` ${node.kind}` : "";
			const text = nodeText(node);
			return heading + details + ("title" in node && node.title ? "\n" + node.title.map(r => r.text).join("") : "") + (text ? "\n" + text : "");
		}).join("\n\n");
	}
	return blocks(document.nodes) + (document.warnings.length ? "\n\nWarnings:\n" + document.warnings.map(w =>
		`${w.block ? `[${w.block}] ` : ""}${w.code}: ${w.message}`).join("\n") : "") + "\n";
}

export async function inspectDocx(config: MDInspectConfig): Promise<MDInspectResult>
{
	if (config.format !== undefined && !["text", "json"].includes(config.format)) throw new UserInputError(`Unknown inspection format: ${config.format}`);
	const document = await parseDocx(config.input, config.abortSignal);
	return { content: serializeInspection(document, config.format), warnings: document.warnings };
}

/** Reverse DOCX into an editable .g.md file and an adjacent image directory. */
export async function reverseDocx(config: MDReverseConfig): Promise<MDReverseResult>
{
	const signal = config.abortSignal;
	signal?.throwIfAborted();
	const document = await parseDocx(config.input, signal);
	let output = path.resolve(config.output || path.join(path.dirname(config.input), path.parse(config.input).name + ".g.md"));
	const outputInfo = await fs.stat(output).catch(error => { if (error.code != "ENOENT") throw error; return undefined; });
	if (outputInfo?.isDirectory() || config.output?.endsWith("/") || config.output?.endsWith("\\") || (config.output && !path.extname(config.output)))
		output = path.join(output, path.parse(config.input).name + ".g.md");
	if (path.resolve(config.input) == output) throw new UserInputError("The reverse output must differ from the input DOCX");
	if (!output.toLowerCase().endsWith(".g.md")) throw new UserInputError("The reverse output must have the .g.md extension");
	if (!config.overwrite && await fs.stat(output).then(() => true, error => { if (error.code != "ENOENT") throw error; return false; }))
		throw new UserInputError(`Output already exists: ${output}. Use overwrite or --force to replace it.`);
	signal?.throwIfAborted();
	await fs.mkdir(path.dirname(output), { recursive: true });
	const imagePaths = new Map<string, string>();
	const images: string[] = [];
	let imageDir: string | undefined;
	const temporary = path.join(path.dirname(output), `.${path.basename(output)}.${randomUUID()}.tmp`);
	try
	{
		if (document.images.length)
		{
			const prefix = output.slice(0, -".g.md".length) + ".images";
			for (let i = 0; ; i++)
			{
				const candidate = prefix + (i ? `-${i + 1}` : "");
				try { await fs.mkdir(candidate); imageDir = candidate; break; }
				catch (error: any) { if (error.code != "EEXIST") throw error; }
			}
			for (const [i, image] of document.images.entries())
			{
				signal?.throwIfAborted();
				const extension = (path.extname(image.name).replace(/[^.a-z0-9]/gi, "").toLowerCase() || ".bin").replace(/^\.jpeg$/, ".jpg");
				const file = path.join(imageDir, `image${String(i + 1).padStart(3, "0")}${extension}`);
				const handle = await fs.open(file, "wx");
				images.push(file);
				try { await handle.writeFile(image.data, { signal }); }
				finally { await handle.close(); }
				imagePaths.set(image.id, path.relative(path.dirname(output), file).split(path.sep).join("/"));
			}
		}
		await fs.writeFile(temporary, serializeMD(document, imagePaths), { encoding: "utf8", flag: "wx", signal });
		signal?.throwIfAborted();
		if (config.overwrite)
		{
			if (await fs.realpath(config.input) == await fs.realpath(output).catch(error => { if (error.code != "ENOENT") throw error; return undefined; }))
				throw new UserInputError("The reverse output must differ from the input DOCX");
			await fs.rename(temporary, output);
		}
		else await fs.link(temporary, output);
	}
	catch (error)
	{
		await Promise.all(images.map(file => fs.unlink(file).catch(() => {})));
		if (imageDir) await fs.rmdir(imageDir).catch(() => {});
		throw error;
	}
	finally { await fs.unlink(temporary).catch(() => {}); }
	return { filePath: output, images, warnings: document.warnings };
}
