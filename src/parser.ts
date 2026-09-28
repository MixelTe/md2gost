import { Doc, tableRow, type AdmonitionType, type DocHeaderFooter, type DocNode, type NodeListItem, type NodeTable, type Rune, type RunicDoc } from "./doc";
import fs from "fs/promises";
import { hslToHex, toCapitalCase, trimEnd, trimStart, type JSONDict, type JSONValue } from "./utils";
import path from "path";
import { preprocess } from "./preprocessor";

export async function parseMD(file: string, variables?: JSONDict, checkFilesIsInsidePath: string | false = false, signal?: AbortSignal | null, logwarn: (msg: string) => void = console.warn)
{
	signal?.throwIfAborted();
	const preprocessed = await preprocess(file, variables, checkFilesIsInsidePath, signal, logwarn);
	signal?.throwIfAborted();
	const lines = preprocessed.split("\n");
	const doc = new Doc();
	const warnAt = (line: number, message: string) => logwarn(`Line ${line}: ${message}`);

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
		const mark = ordered ? (parts[1] == "." ? "." : ")") : (parts[1] == "*" ? "*" : "-");
		const node: DocNode = { type: "list", ordered, mark, startIndex, sourceLine: lineI, items: [{ type: "listItem", text, sourceLine: lineI }] };
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
					node.items.push({ type: "listItem", text: ln.text, sourceLine: lineI + 1 });
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
		return { type: "image", text, src, width, height, sourceLine: lineI };
	}
	function parseCode(text: string)
	{
		const header = text.split(" ");
		const title = header.slice(1).join(" ").trim() || undefined;
		const node: DocNode = { type: "code", lang: header[0]!, title, code: "", sourceLine: lineI };
		const code: string[] = [];
		while (lineI < lines.length)
		{
			const ln = lines[lineI++]!;
			if (ln.startsWith("```")) break;
			code.push(ln);
		}
		node.code = code.join("\n");
		return node;
	}
	function parseSection(text: string): DocNode
	{
		text = text.toLowerCase();
		const match = /from\s+(\d+)/.exec(text);
		const num = match ? parseInt(match[1] || "") : NaN;
		const unpaged = text.includes("unpaged");
		const portrait = text.includes("portrait");
		const landscape = text.includes("landscape");
		return {
			type: "sectionBreak",
			pageStart: unpaged ? -1 : isFinite(num) ? num : null,
			orientation: portrait ? "portrait" : landscape ? "landscape" : null,
			sourceLine: lineI,
		};
	}
	function parseHeaderFooter(kind: "header" | "footer", options: string)
	{
		const value = options.trim().toLowerCase();
		if (value == "none" || (kind == "footer" && value == "auto"))
		{
			setHeaderFooter(kind, { type: value });
			return;
		}
		const align = (value == "" ? "left" : /^align=(left|center|right)$/.exec(value)?.[1]) as "left" | "center" | "right" | undefined;
		if (!align)
		{
			warnAt(lineI, `Wrong ${kind} options: "${options}". Expected align=left, align=center, align=right${kind == "footer" ? ", none, or auto" : ", or none"}.`);
			return;
		}
		const end = `!!end${kind}`;
		const content: string[] = [];
		const initialLineI = lineI;
		let closed = false;
		while (lineI < lines.length)
		{
			const line = lines[lineI++]!;
			if (line.trim().toLowerCase() == end)
			{
				closed = true;
				break;
			}
			content.push(line);
		}
		if (!closed)
		{
			lineI = initialLineI;
			warnAt(initialLineI, `${kind} block is not closed`);
			return;
		}
		const nodes: DocNode[] = [{ type: "text", text: content.join("\n").trim(), sourceLine: initialLineI + 1 }];
		findTables(nodes, false);
		const supported = nodes.filter((node): node is Extract<DocNode, { type: "text" | "table" }> => node.type == "text" || node.type == "table");
		if (supported.length != 1 || supported[0]?.type == "text" && !supported[0].text)
		{
			warnAt(initialLineI, `${kind} must contain text or one table`);
			return;
		}
		setHeaderFooter(kind, { type: "content", align, nodes: supported });

		function setHeaderFooter(kind: "header" | "footer", value: DocHeaderFooter)
		{
			let section: DocNode | undefined;
			for (let i = doc.nodes.length - 1; i >= 0; i--)
			{
				if (doc.nodes[i]?.type == "sectionBreak")
				{
					section = doc.nodes[i];
					break;
				}
			}
			if (section?.type == "sectionBreak") section[kind] = value;
			else doc[kind] = value;
		}
	}
	function parseAdmonition(parts: string[]): DocNode
	{
		const marker = parts[0]!;
		const type = parts[1]! as AdmonitionType;
		const title = parts[2]!;
		const attributes = parts[3]!;
		const content: string[] = [];
		const close = new RegExp(`^${marker}\\s*$`);
		const initialLineI = lineI;
		let closed = false;
		while (lineI < lines.length)
		{
			const line = lines[lineI++]!;
			if (close.test(line))
			{
				closed = true;
				break;
			}
			content.push(line);
		}
		if (!closed) warnAt(initialLineI, `Admonition "${type}" is not closed`);
		return { type: "admonition", admonitionType: type, title, text: content.join("\n").trim(), attributes, sourceLine: initialLineI };
	}
	class RuleError extends Error { };
	function apllyRule(text: string)
	{
		text = text.trim().replaceAll(/\s+/g, " ");
		const textl = text.toLowerCase();
		const rules: Record<string, (v: string) => any> = {
			"highlight code": v => doc.code.highlight = true,  // deprecated
			"rainbow": v => doc.rainbow = true,
			"title": v => doc.title = v,
			"author": v => doc.author = v,
			"etime": v => doc.etime = tryParseInt(v),
			"ctime": v => doc.ctime = tryParseDate(v),
			"mtime": v => doc.mtime = tryParseDate(v),
			"numbering lazy": v => { choices(v, "", "on", "off"); doc.numberingLazy = !v || v == "on"; },
			"numbering sections": v => { choices(v, "", "on", "off"); doc.numberingSections = !v || v == "on"; },
			"numbering autoprefix": v => { choices(v, "", "on", "off"); doc.numberingAutoprefix = v == "on"; },
			"backtick_mono": v => doc.backtickMono = choices(v, "italic", "off", "on", "outline"),
			"hyphenation": v => doc.hyphenation = true,
			"table title style": v => doc.table.title.style = choices(v, "normal", "bold", "italic"),
			"table title size": v => doc.table.title.size = tryParseInt(v),
			"table spacing before": v => doc.table.spacing.before = tryParseInt(v),
			"table spacing after": v => doc.table.spacing.after = tryParseInt(v),
			"table heading style": v => doc.table.heading.style = choices(v, "normal", "bold", "italic"),
			"table heading align": v => doc.table.heading.align = choices(v, "left", "center", "right"),
			"table text size": v => doc.table.text.size = tryParseInt(v),
			"table text line_spacing": v => doc.table.text.line_spacing = tryParseFloat(v),
			"code title style": v => doc.code.title.style = choices(v, "normal", "bold", "italic"),
			"code title size": v => doc.code.title.size = tryParseInt(v),
			"code spacing before": v => doc.code.spacing.before = tryParseInt(v),
			"code spacing after": v => doc.code.spacing.after = tryParseInt(v),
			"code highlight": v => { choices(v, "", "on", "off"); doc.code.highlight = !v || v == "on"; },
			"code text size": v => doc.code.text.size = tryParseInt(v),
			"list ordered style": v => doc.list.ordered.style = choices(v, "bracket", "dot", "keep"),
			"list unordered style": v => doc.list.unordered.style = choices(v, "dash", "bullet", "keep"),
			"list autopunctuation": v => { choices(v, "", "on", "off"); doc.list.autopunctuation = v == "on"; },
			"headings alt_style_1": v =>
			{
				for (let i = 1 as 1 | 2 | 3 | 4 | 5 | 6; i <= 6; i++)
				{
					doc.headings[`h${i}`].indent_full = true;
					doc.headings[`h${i}`].spacing.after = 10;
					doc.headings[`h${i}`].spacing.before = 15;
				}
				doc.headings.h1.size = 18;
				doc.headings.h1.uppercase = true;
				doc.headings.h1.spacing.before = 0;
				doc.headings.h2.size = 16;
			},
			"text size": v => doc.text.size = tryParseInt(v),
			"text line_spacing": v => doc.text.line_spacing = tryParseFloat(v),
			"text indent": v => doc.text.indent = tryParseFloat(v),
			"text spacing after": v => doc.text.spacing.after = tryParseInt(v),
			"img text size": v => doc.img.text.size = tryParseInt(v),
			"img spacing before": v => doc.img.spacing.before = tryParseInt(v),
			"img spacing after": v => doc.img.spacing.after = tryParseInt(v),
			"formula spacing before": v => doc.formula.spacing.before = tryParseInt(v),
			"formula spacing after": v => doc.formula.spacing.after = tryParseInt(v),
		};
		const reRules: { re: RegExp, n: (m: RegExpExecArray) => { rule: string, value: string }, f: (m: RegExpExecArray) => void }[] = [
			{
				re: /^(admonition (all|note|info|tip|warning|danger) (spacing (before|after)|padding|indent|background|color|bar_width|icon size|icon|title_color|title))(.*)/,
				n: m => ({ rule: m[1], value: (m.at(-1) || "").trim() }), f(m)
				{
					const type = m[2] as AdmonitionType | "all";
					const property = m[3];
					const value = (m.at(-1) || "").trim();
					const valueKeepCase = text.slice(m[1]!.length).trim();
					const types: AdmonitionType[] = type == "all" ? ["note", "info", "tip", "warning", "danger"] : [type];
					for (const type of types)
					{
						const style = doc.admonition[type];
						if (property == "spacing before") style.spacing.before = tryParseInt(value);
						else if (property == "spacing after") style.spacing.after = tryParseInt(value);
						else if (property == "indent") style.indent = tryParseFloat(value);
						else if (property == "padding")
						{
							const padding = value.split(" ").map(tryParseInt);
							if (padding.length != 2) throw new RuleError("Two values are required: horizontal vertical");
							style.padding = { top: padding[1]!, right: padding[0]!, bottom: padding[1]!, left: padding[0]! };
						}
						else if (property == "background") style.background = tryParseColor(value);
						else if (property == "color") style.color = tryParseColor(value);
						else if (property == "bar_width") style.bar_width = tryParseFloat(value);
						else if (property == "icon size") style.icon_size = tryParseInt(value);
						else if (property == "icon") { choices(value, "on", "off"); style.icon = value == "on"; }
						else if (property == "title_color") { choices(value, "on", "off"); style.title_color = value == "on"; }
						else if (property == "title") style.title = valueKeepCase;
					}
				},
			},
			{
				re: /^(headings (h[1-6])(\+?) (size|spacing (before|after)|uppercase|indent))(.*)/,
				n: m => ({ rule: m[1], value: (m.at(-1) || "").trim() }), f(m)
				{
					const level = parseInt(m[2][1]);
					const plus = m[3] == "+";
					const property = m[4];
					const value = (m.at(-1) || "").trim();
					for (let i = level as 1 | 2 | 3 | 4 | 5 | 6; i <= (plus ? 6 : level); i++)
					{
						const h = doc.headings[`h${i}`];
						if (property == "size") h.size = tryParseInt(value);
						else if (property == "spacing before") h.spacing.before = tryParseInt(value);
						else if (property == "spacing after") h.spacing.after = tryParseInt(value);
						else if (property == "uppercase") { choices(value, "", "on", "off"); h.uppercase = !value || value == "on"; }
						else if (property == "indent") h.indent_full = choices(value, "first_line", "left") == "left";
					}
				},
			},
		];

		const rulePrefix = Object.keys(rules).find(prefix =>
			textl.startsWith(prefix) && !textl.slice(prefix.length)[0]?.trim(),
		);
		const reRule = rulePrefix ? undefined : reRules.map(({ re, f, n }) => ({ f, n, m: re.exec(textl) })).find(({ m }) => !!m);
		const applyRule = rulePrefix ?
			() => rules[rulePrefix](text.slice(rulePrefix.length).trim()) :
			reRule ? () => reRule.f(reRule.m!) : undefined;
		if (applyRule)
		{
			try { applyRule(); }
			catch (e)
			{
				let rule = rulePrefix;
				let value = rulePrefix && text.slice(rulePrefix.length);
				if (reRule)
				{
					const n = reRule.n(reRule.m!);
					rule = n.rule;
					value = n.value;
				}
				if (e instanceof RuleError) warnAt(lineI, `Rule "${rule}" wrong value: "${value}". ${e.message}`);
				else throw e;
			}
		}
		else
		{
			warnAt(lineI, `Wrong rule: "${text}"`);
		}

		function tryParseInt(v: string)
		{
			const num = parseInt(v);
			if (!isFinite(num)) throw new RuleError("Only integers are allowed");
			return num;
		}
		function tryParseFloat(v: string)
		{
			const num = parseFloat(v);
			if (!isFinite(num)) throw new RuleError("Only integers and floats are allowed");
			return num;
		}
		function tryParseDate(v: string)
		{
			const date = new Date(v);
			if (!isFinite(date.valueOf())) throw new RuleError("Only ISO 8601 date is allowed");
			return date;
		}
		function tryParseColor(v: string)
		{
			const color = /^#?([\da-f]{6})$/i.exec(v)?.[1];
			if (!color) throw new RuleError("Only #RRGGBB colors are allowed");
			return color;
		}
		function choices<V extends string>(v: string, ...vars: V[]): V
		{
			if (vars.includes(v as any)) return v as unknown as V;
			throw new RuleError("Allowed: " + vars.join(", "));
		}
	}
	function skipComment()
	{
		while (lineI - 1 < lines.length && !lines[lineI - 1]!.includes("-->"))
			lineI++;
	}

	let lineI = 0;
	while (lineI < lines.length)
	{
		const line = lines[lineI++]!;
		const { prefix, text, parts } = parseLine(line);
		try
		{
			switch (prefix)
			{
				case "#": doc.appendTitle(text, 1, lineI); break;
				case "##": doc.appendTitle(text, 2, lineI); break;
				case "###": doc.appendTitle(text, 3, lineI); break;
				case "####": doc.appendTitle(text, 4, lineI); break;
				case "#####": doc.appendTitle(text, 5, lineI); break;
				case "######": doc.appendTitle(text, 6, lineI); break;
				case "*": doc.appendNode(parseList(text, parts, false)); break;
				case "1)": doc.appendNode(parseList(text, parts, true)); break;
				case "Img": doc.appendNode(parseImg(parts)); break;
				case "Code": doc.appendNode(parseCode(text)); break;
				case "Admonition": doc.appendNode(parseAdmonition(parts)); break;
				case "Comment": skipComment(); break;
				case "!!section": doc.appendNode(parseSection(text)); break;
				case "!!header": parseHeaderFooter("header", text); break;
				case "!!footer": parseHeaderFooter("footer", text); break;
				case "!!rule": apllyRule(text); break;
				case "---": doc.appendNode({ type: "pageBreak", sourceLine: lineI }); break;

				case "":
				case "\t":
					const last = doc.nodes.at(-1);
					if (line.trim() != "" && last?.type == "text")
					{
						if (last.text == "") last.sourceLine = lineI;
						else last.text += "\n";
						last.text += line.trim();
					}
					else doc.appendText(line.trim(), lineI);
					break;

				default:
					prefix satisfies never;
					throw new Error("switch default");
			}
		}
		catch (error)
		{
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`Line ${lineI}: ${message}`, { cause: error });
		}
	}

	doc.nodes.forEach(node =>
	{
		if (node.type == "admonition" && node.title == "\n")
			node.title = doc.admonition[node.admonitionType].title;
	});
	doc.nodes = doc.nodes.filter(n => n.type != "text" || n.text != "");
	await findDocs(doc.nodes, warnAt);
	findMath(doc.nodes, warnAt); // keep before table recognition so `|` inside LaTex is inert.
	findTables(doc.nodes);

	return doc;
}

type Prefix = "" | "#" | "##" | "###" | "####" | "#####" | "######" | "*" | "1)" | "---" | "\t" | "Img" | "Code" | "Comment" | "Admonition" | "!!section" | "!!header" | "!!footer" | "!!rule";
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
	const text = splited.slice(1).join(" ");
	let parts: string[] = [];
	if (prefix.startsWith("!"))
	{
		const m_img = /^!\[(.*)\]\((.*)\)({(.*)})?/.exec(line);
		if (m_img) return {
			prefix: "Img",
			text: line.trim(),
			level,
			parts: [m_img[1]!, m_img[2]!, m_img[4]!],
		};
	}
	if (prefix == "-" || prefix == "*")
	{
		parts = ["", prefix];
		prefix = "*";
	}
	if (prefix.endsWith(".") || prefix.endsWith(")"))
	{
		const index = parseInt(prefix.slice(0, -1));
		if (isFinite(index))
		{
			parts = [`${index}`, prefix.at(-1) || ")"];
			prefix = "1)";
		}
	}
	if (prefix.startsWith("```")) return { prefix: "Code", text: line.trim().slice(3), level, parts };
	const m_admonition = /^(:{3,})(note|info|tip|warning|danger)(?:\[([^\]]*)\])?(?:\{([^}]*)\})?\s*$/i.exec(line.trim());
	if (m_admonition) return {
		prefix: "Admonition",
		text: "",
		level,
		parts: [m_admonition[1]!, m_admonition[2]!.toLowerCase(), m_admonition[3] ?? "\n", m_admonition[4] || ""],
	};
	if (prefix.startsWith("<!--")) return { prefix: "Comment", text: line.trim().slice("<!--".length).trim(), level, parts };
	if (["#", "##", "###", "####", "#####", "######", "*", "1)", "!!section", "!!header", "!!footer", "!!rule"].includes(prefix))
		return { prefix: prefix as Prefix, text, level: 0, parts };
	return { prefix: "", text: line.trim(), level, parts };
}

async function findDocs(nodes: DocNode[], warnAt: (line: number, message: string) => void)
{
	const { default: JSONC } = await import("jsonc-simple-parser");
	const re_doc = /^!!\(([^{}]*)\)\s*{(.*)}$/s;
	for (let i = 0; i < nodes.length; i++)
	{
		const node = nodes[i]!;
		if (node.type != "text") continue;
		const m_doc = re_doc.exec(node.text.trimEnd());
		if (!m_doc) continue;
		let dict = {};
		try { dict = JSONC.parse(`{${m_doc[2]!}}`); }
		catch { warnAt(node.sourceLine ?? -1, `Cant parse doc dict: {${m_doc[2]!.replaceAll("\n", " ")}}`); }
		nodes.splice(i, 1, {
			type: "externalDoc",
			path: trimEnd(trimStart(m_doc[1]!, "<", '"'), ">", '"'),
			dict: stringifyDict(dict),
			sourceLine: node.sourceLine,
		});
	}
}
export function stringifyDict(dict: Record<string, JSONValue>)
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

function findTables(nodes: DocNode[], hasHeader: boolean = true)
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
		let sourceLine = node.sourceLine + offset;
		const rows = [tableRow(sourceLine++, ...header)];
		for (const line of lines.slice(2 + offset))
		{
			const row = trim(line).split(/(?<!\\)\|/).map(v => v.trim());
			while (row.length < cols.length) row.push("");
			rows.push(tableRow(++sourceLine, ...row));
		}
		const table: NodeTable = { type: "table", align, rows, sourceLine: node.sourceLine, ...(hasHeader ? {} : { header: false }) };
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

function findMath(nodes: DocNode[], warnAt: (line: number, message: string) => void)
{
	for (let i = 0; i < nodes.length; i++)
	{
		const node = nodes[i];
		if (node?.type != "text") continue;
		const lines = node.text.split("\n");
		const replacement: DocNode[] = [];
		let text: string[] = [];
		let textStart = 0;
		const flush = () =>
		{
			if (text.length)
				replacement.push({ type: "text", text: text.join("\n"), sourceLine: (node.sourceLine ?? 0) + textStart });
			text = [];
		};

		for (let line = 0; line < lines.length; line++)
		{
			if (lines[line]?.trim() != "$$")
			{
				if (!text.length) textStart = line;
				text.push(lines[line]!);
				continue;
			}

			const start = line;
			let end = line + 1;
			while (end < lines.length && lines[end]?.trim() != "$$") end++;
			if (end >= lines.length)
			{
				warnAt((node.sourceLine ?? 0) + start, "Formula is not closed");
				if (!text.length) textStart = line;
				text.push(lines[line]!);
				continue;
			}
			let id: string | undefined;
			let manualNumber: string | undefined;
			const idMatch = /^\s*(\[[a-zA-Zа-яА-ЯёЁ_\d#]+\])\s*$/.exec(text.at(-1) || "");
			const numberMatch = /^\s*(\(.*\))\s*$/.exec(text.at(-1) || "");
			if (idMatch) { id = `(${idMatch[1]})`; text.pop(); }
			else if (numberMatch) { manualNumber = numberMatch[1]; text.pop(); }
			flush();
			replacement.push({
				type: "math",
				latex: lines.slice(start + 1, end).join("\n").trim(),
				title: id ?? manualNumber,
				sourceLine: (node.sourceLine ?? 0) + start,
			});
			line = end;
			textStart = end + 1;
		}
		flush();
		if (replacement.some(n => n.type == "math"))
		{
			nodes.splice(i, 1, ...replacement);
			i += replacement.length - 1;
		}
	}
}

export function runifyDoc(doc: Doc): RunicDoc
{
	function runifyNode(node: DocNode | NodeListItem)
	{
		if ("text" in node && node.text !== undefined)
			node.text = runifyText(node.text, doc.rainbow) as any;
		if ("title" in node && node.title !== undefined)
			node.title = runifyText(node.title, doc.rainbow) as any;
		if (node.type == "table")
			node.rows.forEach(row => row.forEach(runifyNode));
		if (node.type == "list")
			node.items.forEach(runifyNode);
		if (node.type == "sectionBreak")
		{
			runifyHeaderFooter(node.header);
			runifyHeaderFooter(node.footer);
		}
	}
	doc.nodes.forEach(runifyNode);
	runifyHeaderFooter(doc.header);
	runifyHeaderFooter(doc.footer);
	return doc as RunicDoc;

	function runifyHeaderFooter(value: DocHeaderFooter | undefined)
	{
		if (value?.type != "content") return;
		value.nodes.forEach(runifyNode);
	}
}

let rainbowI = 0;
function runifyText(text: string, rainbow = false): Rune[]
{
	const formulas: string[] = [];
	let preprocessedText = "";
	for (let i = 0; i < text.length;)
	{
		const fence = text.startsWith("```", i) ? "```" : text[i] == "`" ? "`" : "";
		if (fence)
		{
			const end = text.indexOf(fence, i + fence.length);
			const next = end < 0 ? text.length : end + fence.length;
			preprocessedText += text.slice(i, next); i = next; continue;
		}
		if (text[i] == "$" && text[i - 1] != "\\" && text[i + 1] != "$")
		{
			let end = i + 1;
			while (end < text.length && text[end] != "\n" && (text[end] != "$" || text[end - 1] == "\\")) end++;
			if (end < text.length && text[end] == "$")
			{
				formulas.push(text.slice(i + 1, end));
				preprocessedText += `\uE000${formulas.length - 1}\uE001`; i = end + 1; continue;
			}
		}
		preprocessedText += text[i++];
	}
	text = preprocessedText.replaceAll("\\$", "$");
	return replaceAmpCodes(text).replaceAll("\n", "&Tab;\n").replaceAll(/\s*<br>\s*/g, "\n")
		.replaceAll("—", "-").replaceAll(" - ", " \u2013 ")
		.replaceAll(/(?<=[\p{L}\p{N}])-(?=[\p{L}\p{N}])/gu, "\u2011")
		.replaceAll(/(^|[^\p{L}\d_])"([\p{L}\d_])/gu, "$1«$2")
		.replaceAll(/([\p{L}\d_])"([^\p{L}\d_]|$)/gu, "$1»$2")
		.replaceAll(/(^|\s)(\*+)($|\s)/g, sub => sub.replaceAll("*", "&Star;"))
		.split(/(\[[^\]]*\]\([^)]*\))/g)
		.map(p =>
		{
			const m = /\[([^\]]*)\]\(([^)]*)\)/.exec(p);
			if (!m) return { text: p } as Rune;
			return { text: m[1], link: m[2] } as Rune;
		})
		.map(rune => rune.text.split("\n").map((p, i) => ({
			text: p.replaceAll(/\s+/g, " ").replaceAll("&nbsp;", "\u00A0").replaceAll("&Tab;", "\t"),
			linebreak: i > 0,
			link: rune.link,
		}) as Rune)).flat()
		.map(rune => rune.text.split("***").map((p, i, arr) => ({
			text: p,
			linebreak: i == 0 && rune.linebreak,
			link: rune.link,
			bold: i % 2 == 1 && i != arr.length - 1,
			italic: i % 2 == 1 && i != arr.length - 1,
		}) as Rune)).flat()
		.map(rune => rune.text.split("**").map((p, i, arr) => ({
			text: p,
			linebreak: i == 0 && rune.linebreak,
			link: rune.link,
			bold: (i % 2 == 1 && i != arr.length - 1) || rune.bold,
			italic: rune.italic,
		}) as Rune)).flat()
		.map(rune => rune.text.split("*").map((p, i, arr) => ({
			text: p,
			linebreak: i == 0 && rune.linebreak,
			link: rune.link,
			bold: rune.bold,
			italic: (i % 2 == 1 && i != arr.length - 1) || rune.italic,
		}) as Rune)).flat()
		.map(rune => rune.text.split("```").map((p, i, arr) => ({
			...rune,
			text: p,
			linebreak: i == 0 && rune.linebreak,
			mono: (i % 2 == 1 && i != arr.length - 1),
		}) as Rune)).flat()
		.map(rune => rune.mono ? rune : rune.text.split("`").map((p, i, arr) => ({
			...rune,
			text: p,
			linebreak: i == 0 && rune.linebreak,
			mono: (i % 2 == 1 && i != arr.length - 1),
		}) as Rune)).flat()
		.map(rune => rune.mono ? [rune] : rune.text.split(/(\uE000\d+\uE001)/).map((p, i) =>
		{
			const m = /^\uE000(\d+)\uE001$/.exec(p);
			return { ...rune, text: m ? formulas[parseInt(m[1]!)]! : p, type: m ? "math" : rune.type, linebreak: i == 0 && rune.linebreak } as Rune;
		})).flat()
		.map(rune => rune.link ? [rune] : rune.text.split(/(\[!?[a-zA-Zа-яА-ЯёЁ_\d#]+\s*[+-]?\s*\d*\])/g).map((p, i) =>
		{
			const m = /\[(!?([a-zA-Zа-яА-ЯёЁ_\d]+|#)(\s*[-+]\s*\d+)?)\]/.exec(p);
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
			...(!rune.type || rune.type == "text" ? {
				text: rune.text
					.replaceAll("&Star;", "*")
					.replaceAll("&#x200B;", ""),
			} : {}),
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
		"&amp;": "&",
		"&shy;": "\u00AD",
		"&laquo;": "«",
		"&raquo;": "»",
		"&lsaquo;": "‹",
		"&rsaquo;": "›",
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
