import { Doc, tableRow, type DocNode, type NodeListItem, type NodeTable, type Rune, type RunicDoc, type Runify } from "./doc";
import fs from "fs/promises";
import { hslToHex, toCapitalCase, trimEnd, trimStart, type JSONValue } from "./utils";
import path from "path";

export async function parseMD(file: string, logwarn: (msg: string) => void = console.warn)
{
	const lines = (await fs.readFile(file, { encoding: "utf8" })).split("\n");
	const doc = new Doc();

	try
	{
		doc.title = toCapitalCase(trimEnd(path.parse(file).name, ".g"));
		const stats = await fs.stat(file);
		doc.ctime = stats.birthtime;
	}
	catch { }

	function parseList(text: string, parts: string[], ordered: boolean, level: number = 0)
	{
		const startIndex = isFinite(parseInt(parts[0])) ? parseInt(parts[0]) : 1;
		const node: DocNode = { type: "list", ordered, startIndex, items: [{ type: "listItem", text }] };
		const P: Prefix = ordered ? "1)" : "*";
		function skipEmptyLines()
		{
			let emptyFound = false;
			for (let i = lineI; i < lines.length; i++)
			{
				let ln = parseLine(lines[i]!);
				if (ln.prefix == "\t") ln = parseLine(ln.text);

				if (ln.prefix == "" && ln.text == "") { emptyFound = true; continue; }
				if (ln.prefix == "" && !emptyFound) { lineI = i; return false; }
				if (ln.prefix == "*" || ln.prefix == "1)") { lineI = i; return false; }
				return true;
			}
			return true;
		}
		while (lineI < lines.length)
		{
			if (skipEmptyLines()) break;
			let ln = parseLine(lines[lineI]!);
			const last = node.items.at(-1);
			if (ln.level == level)
			{
				if (ln.prefix == "\t") ln = parseLine(ln.text);
				if (ln.prefix == "" && last?.type == "listItem")
					last.text += "\n" + ln.text;
				else if (ln.prefix == P)
					node.items.push({ type: "listItem", text: ln.text });
				else break;
			}
			else if (ln.level > level)
			{
				if (ln.level == level + 1) ln = parseLine(ln.text);
				if ((ln.prefix == "" || ln.prefix == "\t") && last?.type == "listItem")
					last.text += "\n" + ln.text;
				else if (ln.prefix == "*" || ln.prefix == "1)")
				{
					lineI++;
					node.items.push(parseList(ln.text, ln.parts, ln.prefix == "1)", level + 1));
					continue;
				}
				else break;
			}
			else break;
			lineI++;
		}
		return node;
	}
	function parseImg(parts: string[]): DocNode
	{
		const text = parts[0]!.replaceAll("\\n", "\n").trim() || undefined;
		const size = parts[2];
		let width: number | null = null;
		let height: number | null = null;
		if (size)
		{
			const s = size.split("x");
			const w = parseInt(s[0] || "");
			const h = parseInt(s[1] || "");
			if (isFinite(w)) width = w;
			if (isFinite(h)) height = h;
		}
		const src = trimEnd(trimStart(parts[1]!, "<"), ">");
		return { type: "image", text, src, width, height };
	}
	function parseCode(text: string)
	{
		const header = text.split(" ");
		const title = header.slice(1).join(" ").trim() || undefined;
		const node: DocNode = { type: "code", lang: header[0]!, title, code: "" };
		text = "";
		while (lineI < lines.length)
		{
			let ln = lines[lineI++]!;
			if (ln.startsWith("```")) break;
			text += "\n" + ln;
		}
		node.code = text.trim();
		return node;
	}
	function parseSection(text: string): DocNode
	{
		const match = /from\s+(\d+)/.exec(text);
		const num = match ? parseInt(match[1] || "") : NaN;
		return { type: "sectionBreak", pageStart: isFinite(num) ? num : null };
	}
	function apllyRule(text: string)
	{
		text = text.trim().replaceAll(/\s+/g, " ");
		const textl = text.toLowerCase();
		const rules: Record<string, (v: string) => any> = {
			"highlight code": v => doc.codeHighlighting = true,
			"rainbow": v => doc.rainbow = true,
			"title": v => doc.title = v,
			"author": v => doc.author = v,
			"etime": v => doc.etime = tryParseInt(v),
			"ctime": v => doc.ctime = tryParseDate(v),
			"mtime": v => doc.mtime = tryParseDate(v),
			"numbering lazy": v => doc.numberingLazy = !v || v == "on",
			"numbering sections": v => doc.numberingSections = !v || v == "on",
			"numbering autoprefix": v => doc.numberingAutoprefix = v == "on",
			"backtick_mono": v => doc.backtickMono = choices(v, "italic", "off", "on", "outline"),
		};

		const rulePrefix = Object.keys(rules).find(prefix =>
			textl.startsWith(prefix) && !textl.slice(prefix.length)[0]?.trim()
		);
		if (rulePrefix) rules[rulePrefix](text.slice(rulePrefix.length).trim());
		else logwarn(`Wrong rule: "${text}"`);

		function tryParseInt(v: string)
		{
			const num = parseInt(v);
			return isFinite(num) ? num : undefined;
		}
		function tryParseDate(v: string)
		{
			const date = new Date(v);
			return isFinite(date.valueOf()) ? date : undefined;
		}
		function choices<D extends string, V extends string>(
			v: string,
			def: D,
			...vars: V[]
		): D | V
		{
			return vars.includes(v as any) ? (v as unknown as V) : def;
		}
	}

	let lineI = 0;
	while (lineI < lines.length)
	{
		const line = lines[lineI++]!;
		const { prefix, text, parts } = parseLine(line);
		switch (prefix)
		{
			case "#": doc.appendTitle(text, 1); break;
			case "##": doc.appendTitle(text, 2); break;
			case "###": doc.appendTitle(text, 3); break;
			case "####": doc.appendTitle(text, 4); break;
			case "#####": doc.appendTitle(text, 5); break;
			case "######": doc.appendTitle(text, 6); break;
			case "*": doc.appendNode(parseList(text, parts, false)); break;
			case "1)": doc.appendNode(parseList(text, parts, true)); break;
			case "Img": doc.appendNode(parseImg(parts)); break;
			case "Code": doc.appendNode(parseCode(text)); break;
			case "Comment": break;
			case "!!section": doc.appendNode(parseSection(text)); break;
			case "!!rule": apllyRule(text); break;
			case "---": doc.appendNode({ type: "pageBreak" }); break;

			case "":
			case "\t":
				const last = doc.nodes.at(-1);
				if (line.trim() != "" && last?.type == "text")
				{
					if (last.text != "") last.text += "\n";
					last.text += line.trim();
				}
				else doc.appendText(line.trim());
				break;

			default:
				prefix satisfies never;
				throw new Error("switch default");
		}
	}

	doc.nodes = doc.nodes.filter(n => n.type != "text" || n.text != "");
	findDocs(doc.nodes, logwarn);
	findTables(doc.nodes);
	findPageBreaks(doc.nodes);

	return doc;
}

type Prefix = "" | "#" | "##" | "###" | "####" | "#####" | "######" | "*" | "1)" | "---" | "\t" | "Img" | "Code" | "Comment" | "!!section" | "!!rule";
export function parseLine(line: string): { prefix: Prefix, text: string, level: number, parts: string[] }
{
	let level = 0;
	while (line.startsWith("    ") || line.startsWith("\t"))
	{
		if (line.startsWith("    ")) line = line = line.slice(4);
		else if (line.startsWith("\t")) line = line.slice(1);
		level++;
	}
	if (level > 0) return { prefix: "\t", text: line.trim(), level, parts: [] };
	if (/^\s*---+\s*$/.test(line)) return { prefix: "---", text: "", level, parts: [] };
	const splited = line.trim().split(/\s/);
	let prefix = splited[0]!.toLowerCase();
	let text = splited.slice(1).join(" ");
	let parts: string[] = [];
	if (prefix.startsWith("!"))
	{
		const m_img = /!\[(.*)\]\((.*)\)({(.*)})?/.exec(line);
		if (m_img) return {
			prefix: "Img",
			text: line.trim(),
			level,
			parts: [m_img[1]!, m_img[2]!, m_img[4]!],
		};
	}
	if (prefix == "-") prefix = "*";
	if (prefix.endsWith(".") || prefix.endsWith(")"))
	{
		const index = parseInt(prefix.slice(0, -1));
		if (isFinite(index))
		{
			prefix = "1)";
			parts = [`${index}`];
		}
	}
	if (prefix.startsWith("```")) return { prefix: "Code", text: line.trim().slice(3), level, parts };
	if (prefix.startsWith("<!--")) return { prefix: "Comment", text: line.trim().slice("<!--".length).trim(), level, parts };
	if (["#", "##", "###", "####", "#####", "######", "*", "1)", "!!section", "!!rule"].includes(prefix))
		return { prefix: prefix as Prefix, text, level: 0, parts };
	return { prefix: "", text: line.trim(), level, parts };
}

function findDocs(nodes: DocNode[], logwarn: (msg: string) => void = console.warn)
{
	const re_doc = /^!!\(([^{}]*)\)\s*{(.*)}$/s;
	const re_remTrailingComma = /,(\s*[}\]])/g;
	for (let i = 0; i < nodes.length; i++)
	{
		const node = nodes[i]!;
		if (node.type != "text") continue;
		const m_doc = re_doc.exec(node.text.trimEnd().replaceAll(re_remTrailingComma, "$1"));
		if (!m_doc) continue;
		let dict = {};
		try { dict = JSON.parse(`{${m_doc[2]!}}`); }
		catch (x) { logwarn(`Cant parse doc dict: {${m_doc[2]!.replaceAll("\n", " ")}}`); }
		nodes.splice(i, 1, {
			type: "externalDoc",
			path: trimEnd(trimStart(m_doc[1]!, "<", '"'), ">", '"'),
			dict: stringifyDict(dict),
		});
	}
	function stringifyDict(dict: Record<string, JSONValue>)
	{
		const r = {} as Record<string, string>;
		for (const key in dict)
		{
			let v = dict[key];
			if (typeof v == "string" || typeof v == "boolean" || typeof v == "number")
			{
				r[key] = `${v}`;
				continue;
			}
			if (!v) continue;
			if (v instanceof Array)
			{
				const d = {} as Record<string, JSONValue>;
				v.forEach((v, i) => d[`${i}`] = v);
				v = d;
			}
			const d = stringifyDict(v);
			for (const k in d)
				r[key + "." + k] = d[k];
		}
		return r;
	}
}

function findTables(nodes: DocNode[])
{
	const re_sep = /^(\s*:?-+:?\s*(?<!\\)\|)+\s*:?-+:?\s*$/;
	const re_sep_oneCol = /^\|\s*:?-+:?\s*\|$/;
	const trim = (line: string) =>
	{
		line = line.trim();
		if (line.at(0) == "|") line = line.slice(1);
		if (line.at(-1) == "|") line = line.slice(0, -1);
		return line.trim();
	};

	for (let i = 0; i < nodes.length; i++)
	{
		const node = nodes[i]!;
		if (node.type != "text") continue;
		const lines = node.text.split("\n");
		const offset = lines[0].includes("|") ? 0 : 1;
		if (lines.length < 2 + offset) continue;
		const sep = trim(lines[1 + offset]!);
		if (!re_sep.test(sep) && !re_sep_oneCol.test(lines[1 + offset]!)) continue;
		const cols = sep.split("|");
		const header = trim(lines[offset]!).split(/(?<!\\)\|/).map(v => v.trim());
		if (header.length != cols.length) continue;
		const align = cols.map(v => v.trim()).map(v =>
			v.startsWith(":") && v.endsWith(":") ? "c" :
				v.endsWith(":") ? "r" : "l" as const);
		const rows = [tableRow(...header)];
		for (const line of lines.slice(2 + offset))
		{
			const row = trim(line).split(/(?<!\\)\|/).map(v => v.trim());
			while (row.length < cols.length) row.push("");
			rows.push(tableRow(...row));
		}
		const table: NodeTable = { type: "table", align, rows };
		nodes.splice(i, 1, table);
		const prev = nodes[i - 1];
		if (offset > 0)
		{
			table.title = lines[0];
		}
		else if (prev?.type == "text")
		{
			nodes.splice(i - 1, 1);
			table.title = prev.text;
			i--;
		}
	}
}

function findPageBreaks(nodes: DocNode[])
{
	const re_sep = /^\s*---+\s*$/;
	for (let i = 0; i < nodes.length; i++)
	{
		const node = nodes[i]!;
		if (node.type != "text") continue;
		if (!node.text.includes("---")) continue;
		const lines = node.text.split("\n");
		const newNodes = [] as DocNode[];
		for (const line of lines)
		{
			if (re_sep.test(line)) newNodes.push({ type: "pageBreak" });
			else
			{
				const last = newNodes.at(-1);
				if (last?.type == "text") last.text += "\n" + line;
				else newNodes.push({ type: "text", text: line, noIndent: node.noIndent, noMargin: node.noMargin });
			}
		}
		nodes.splice(i, 1, ...newNodes);
		i += newNodes.length - 1;
	}
}

export function runifyDoc(doc: Doc): RunicDoc
{
	function runifyNode(node: DocNode | NodeListItem)
	{
		if ("text" in node && node.text)
			node.text = runifyText(node.text, doc.rainbow) as any;
		if ("title" in node && node.title)
			node.title = runifyText(node.title, doc.rainbow) as any;
		if (node.type == "table")
			node.rows.forEach(row => row.forEach(runifyNode));
		if (node.type == "list")
			node.items.forEach(runifyNode);
	}
	doc.nodes.forEach(runifyNode);
	return doc as RunicDoc;
}

let rainbowI = 0;
function runifyText(text: string, rainbow = false): Rune[]
{
	return replaceAmpCodes(text).replaceAll("\n", "&Tab;\n").replaceAll(/\s*<br>\s*/g, "\n")
		.replaceAll("—", "-").replaceAll(" - ", " \u2013 ")
		.replaceAll(/(\s)"(\w)/g, "$1«$2")
		.replaceAll(/(\w)"(\s)/g, "$1»$2")
		.replaceAll(/(^|\s)(\*+)($|\s)/g, sub => sub.replaceAll("*", "&Star;"))
		.split(/(\[.*\]\(.*\))/g)
		.map(p =>
		{
			const m = /\[(.*)\]\((.*)\)/.exec(p);
			if (!m) return { text: p } as Rune;
			return { text: m[1], link: m[2] } as Rune;
		})
		.map(rune => rune.text.split("\n").map((p, i) => ({
			text: p.replaceAll(/\s+/g, " ").replaceAll("&nbsp;", "\u00A0").replaceAll("&Tab;", "\t"),
			linebreak: i > 0,
			link: rune.link,
		}) as Rune)).flat()
		.map(rune => rune.text.split("***").map((p, i) => ({
			text: p,
			linebreak: i == 0 && rune.linebreak,
			link: rune.link,
			bold: i % 2 == 1,
			italic: i % 2 == 1,
		}) as Rune)).flat()
		.map(rune => rune.text.split("**").map((p, i) => ({
			text: p,
			linebreak: i == 0 && rune.linebreak,
			link: rune.link,
			bold: i % 2 == 1 || rune.bold,
			italic: rune.italic,
		}) as Rune)).flat()
		.map(rune => rune.text.split("*").map((p, i) => ({
			text: p,
			linebreak: i == 0 && rune.linebreak,
			link: rune.link,
			bold: rune.bold,
			italic: i % 2 == 1 || rune.italic,
		}) as Rune)).flat()
		.map(rune => rune.text.split("`").map((p, i) => ({
			...rune,
			text: p,
			linebreak: i == 0 && rune.linebreak,
			mono: i % 2 == 1,
		}) as Rune)).flat()
		.map(rune => rune.link ? [rune] : rune.text.split(/(\[!?[a-zA-Zа-яА-ЯёЁ_\d#]+\s*[+\-]?\s*\d*\])/g).map((p, i) =>
		{
			const m = /\[(!?([a-zA-Zа-яА-ЯёЁ_\d]+|#)(\s*[-\+]\s*\d+)?)\]/.exec(p);
			const v = m && m[1];
			const isVal = v?.at(0) == "!";
			return {
				...rune,
				text: v ? (isVal ? v.slice(1) : v) : p,
				type: v ? (isVal ? "val" : "ref") : rune.type,
				linebreak: i == 0 && rune.linebreak,
			} as Rune;
		})).flat()
		.map(rune => ({
			...rune,
			...(rune.type == "text" ? {
				text: rune.text
					.replaceAll("&Star;", "*")
					.replaceAll("&#x200B;", ""),
			} : {})
		}) as Rune)
		.map(rune => !rainbow || (rune.type && rune.type != "text") ? [rune] : rune.text.split("").map((p, i) => ({
			...rune,
			text: p,
			linebreak: i == 0 && rune.linebreak,
			color: hslToHex(rainbowI++ % 360, 100, 50),
		}) as Rune)).flat()
		;
}

function replaceAmpCodes(text: string)
{
	const codes = {
		"&#124;": "|",
		"&shy;": "\u00AD",
		"&alpha;": "α",
		"&beta;": "β",
		"&gamma;": "γ",
		"&delta;": "δ",
		"&epsilon;": "ε",
		"&zeta;": "ζ",
		"&eta;": "η",
		"&theta;": "θ",
		"&iota;": "ι",
		"&kappa;": "κ",
		"&lambda;": "λ",
		"&mu;": "μ",
		"&nu;": "ν",
		"&xi;": "ξ",
		"&omicron;": "ο",
		"&pi;": "π",
		"&rho;": "ρ",
		"&sigma;": "σ",
		"&tau;": "τ",
		"&upsilon;": "υ",
		"&phi;": "φ",
		"&chi;": "χ",
		"&psi;": "ψ",
		"&omega;": "ω",
		"&Delta;": "Δ",
		"&Sigma;": "Σ",
		"&Omega;": "Ω",
		"&infin;": "∞",
		"&sum;": "∑",
		"&prod;": "∏",
		"&radic;": "√",
		"&int;": "∫",
		"&part;": "∂",
		"&asymp;": "≈",
		"&ne;": "≠",
		"&lt;": "<",
		"&gt;": ">",
		"&le;": "≤",
		"&ge;": "≥",
		"&plusmn;": "±",
		"&times;": "×",
		"&divide;": "÷",
		"&copy;": "©",
		"&reg;": "®",
		"&trade;": "™",
		"&sect;": "§",
		"&para;": "¶",
		"&hellip;": "…",
		"&bull;": "•",
		"&middot;": "·",
		"&deg;": "°",
		"&euro;": "€",
		"&pound;": "£",
		"&yen;": "¥",
		"&cent;": "¢",
		"&curren;": "¤",
		"&fnof;": "ƒ",
		"&permil;": "‰",
	};

	for (const code in codes)
	{
		if (!Object.hasOwn(codes, code)) continue;
		const char = codes[code as keyof typeof codes];
		text = text.replaceAll(code, char);
	}

	return text;
}
