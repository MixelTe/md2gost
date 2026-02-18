import { Doc, tableRow, type DocNode, type NodeListItem, type NodeTable, type Rune, type RunicDoc, type Runify } from "./doc";
import fs from "fs/promises";
import { hslToHex } from "./utils";

export async function parseMD(file: string)
{
	const lines = (await fs.readFile(file, { encoding: "utf8" })).split("\n");
	const doc = new Doc();
	const sec = doc.sections[0]!;

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
		const text = parts[0]!.replaceAll("\\n", "\n");
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
		return { type: "image", text, src: parts[1]!, width, height };
	}
	function parseCode(text: string)
	{
		const header = text.split(" ");
		const node: DocNode = { type: "code", lang: header[0]!, title: header.slice(1).join(" "), code: "" };
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
		text = text.trim();
		const textl = text.toLowerCase();
		if (textl == "highlight code") doc.codeHighlighting = true;
		else if (textl == "rainbow") doc.rainbow = true;
		else if (textl.startsWith("title")) doc.title = text.slice("title".length).trim();
		else if (textl.startsWith("author")) doc.author = text.slice("author".length).trim();
		else console.error(`Wrong rule: "${text}"`);
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

			case "":
			case "\t":
				const last = sec.nodes.at(-1);
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

	sec.nodes = sec.nodes.filter(n => n.type != "text" || n.text != "");
	findDocs(sec.nodes);
	findTables(sec.nodes);

	return doc;
}

const re_img = /!\[(.*)\]\((.*)\)({(.*)})?/;

type Prefix = "" | "#" | "##" | "###" | "####" | "#####" | "######" | "*" | "1)" | "\t" | "Img" | "Code" | "Comment" | "!!section" | "!!rule";
function parseLine(line: string): { prefix: Prefix, text: string, level: number, parts: string[] }
{
	let level = 0;
	while (line.startsWith("    ") || line.startsWith("\t"))
	{
		if (line.startsWith("    ")) line = line = line.slice(4);
		else if (line.startsWith("\t")) line = line.slice(1);
		level++;
	}
	if (level > 0) return { prefix: "\t", text: line.trim(), level, parts: [] };
	const splited = line.trim().split(/\s/);
	let prefix = splited[0]!.toLowerCase();
	let text = splited.slice(1).join(" ");
	let parts: string[] = [];
	if (prefix.startsWith("!"))
	{
		const m_img = re_img.exec(line);
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

function findDocs(nodes: DocNode[])
{
	const re_doc = /^!!\((.*)\)\s*{(.*)}$/s;
	const re_remTrailingComma = /,(\s*[}\]])/g;
	for (let i = 0; i < nodes.length; i++)
	{
		const node = nodes[i]!;
		if (node.type != "text") continue;
		const m_doc = re_doc.exec(node.text.replaceAll(re_remTrailingComma, "$1"));
		if (!m_doc) continue;
		let dict = {};
		try { dict = JSON.parse(`{${m_doc[2]!}}`); }
		catch (x) { console.error(`Cant parse doc dict: {${m_doc[2]!.replaceAll("\n", " ")}}`); }
		nodes.splice(i, 1, {
			type: "externalDoc",
			path: m_doc[1]!,
			dict,
		});
	}
}

function findTables(nodes: DocNode[])
{
	const re_sep = /^(\s*-+\s*\|)+\s*-+\s*$/;
	const re_empty_line = /^\|(\s*\|)*$/;
	const trim = (line: string) =>
	{
		line = line.trim();
		if (re_empty_line.test(line)) return line;
		if (line.at(0) == "|") line = line.slice(1);
		if (line.at(-1) == "|") line = line.slice(0, -1);
		return line.trim();
	};

	for (let i = 0; i < nodes.length; i++)
	{
		const node = nodes[i]!;
		if (node.type != "text") continue;
		const lines = node.text.split("\n");
		if (lines.length < 3) continue;
		const sep = trim(lines[1]!);
		if (!re_sep.test(sep)) continue;
		const colN = sep.split("|").length;
		const header = trim(lines[0]!).split("|").map(v => v.trim());
		if (header.length != colN) continue;
		const rows = [tableRow(...header)];
		for (const line of lines.slice(2))
		{
			const row = trim(line).split("|").map(v => v.trim());
			if (row.length != colN) break;
			rows.push(tableRow(...row));
		}
		if (rows.length < 2) continue;
		const table: NodeTable = { type: "table", rows };
		nodes.splice(i, 1, table);
		const prev = nodes[i - 1];
		if (prev?.type == "text")
		{
			nodes.splice(i - 1, 1);
			table.title = prev.text;
		}
	}
}

export function runifyDoc(doc: Doc): RunicDoc
{
	function runifyNode(node: DocNode | NodeListItem)
	{
		if ("text" in node)
			node.text = runifyText(node.text, doc.rainbow) as any;
		if ("title" in node && node.title)
			node.title = runifyText(node.title, doc.rainbow) as any;
		if (node.type == "table")
			node.rows.forEach(row => row.forEach(runifyNode));
		if (node.type == "list")
			node.items.forEach(runifyNode);
	}
	doc.sections.forEach(section =>
		section.nodes.forEach(runifyNode)
	);
	return doc as RunicDoc;
}

let rainbowI = 0;
function runifyText(text: string, rainbow = false): Rune[]
{
	return text.replaceAll(/\s*<br>\s*/g, "\n")
		.replaceAll("—", "-").replaceAll(" - ", " \u2013 ")
		.replaceAll(/"(([^"\n])*?)"/g, "«$1»")
		.split(/(\[.*\]\(.*\))/g)
		.map(p =>
		{
			const m = /\[(.*)\]\((.*)\)/.exec(p);
			if (!m) return { text: p } as Rune;
			return { text: m[1], link: m[2] } as Rune;
		})
		.map(rune => rune.text.split("\n").map((p, i) => ({
			text: p.replaceAll(/\s+/g, " "),
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
		.map(rune => !rainbow ? [rune] : rune.text.split("").map((p, i) => ({
			text: p,
			linebreak: i == 0 && rune.linebreak,
			link: rune.link,
			bold: rune.bold,
			italic: rune.italic,
			color: hslToHex(rainbowI++ % 360, 100, 50),
		}) as Rune)).flat()
		;
}
