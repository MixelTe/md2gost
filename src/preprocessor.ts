import fs from "fs/promises";
import { deepOverwrite, getSafePathResolver, trimEnd, trimStart, type JSONDict } from "./utils";
import path from "path";
import { UserInputError } from "./errors";

/* TODO:
- Доработать nested include: резолвить относительные пути относительно текущего подключаемого файла, а не корня.
- Убрать regex-удаление trailing comma и заменить на безопасный парсинг, чтобы не портить строки внутри JSON.
- Улучшить ошибки include: показывать цепочку файлов в безопасном относительном виде, без абсолютных путей.
*/

export async function preprocess(file: string, variables: JSONDict | undefined, checkFilesIsInsidePath: string | false, logwarn: (msg: string) => void = console.warn): Promise<string>
{
	// variables ||= { zero: "ZZZ", sds: [0], one: { one: 1 } };
	const resolvePath = getSafePathResolver(path.parse(file).dir, checkFilesIsInsidePath);
	return processInclude({ type:"include", path: file, dict: {} }, variables, resolvePath, [], logwarn);
}

async function processInclude(node: INodeInclude, variables: JSONDict | undefined, resolvePath: (fname: string) => string, stack: string[], logwarn: (msg: string) => void): Promise<string>
{
	const path = resolvePath(node.path);
	if (stack.length > 100) throw new UserInputError("Maximum include depth exceeded");
	if (stack.includes(path)) throw new UserInputError("Circular include detected");
	const rawContent = await fs.readFile(path, { encoding: "utf8" });
	let content = rawContent;
	if (variables)
	{
		variables = deepOverwrite(variables, node.dict);
		const nodes = parseFExpr(rawContent);
		// _printNodes(nodes);
		content = processExpressions(nodes, variables || {}, logwarn);
	}
	else variables = {};
	const includes = await parseIncludes(content, logwarn);
	let result = "";
	for (const node of includes)
	{
		if (node.type == "text") result += node.value;
		else result += await processInclude(node, variables, resolvePath, [...stack, path], logwarn);
	}
	return result;
}

type FNode = FNodeText | FNodeExpression;
interface FNodeText
{
	type: "text";
	value: string;
}
interface FNodeExpression
{
	type: "expr";
	value: string;
	hasQuotes: boolean;
}

function parseFExpr(content: string): FNode[]
{
	const nodes: FNode[] = [];
	let textStart = 0;

	function pushText(start: number, end: number)
	{
		if (start >= end) return;

		const value = content.slice(start, end);
		const prev = nodes.at(-1);

		if (prev?.type == "text")
			prev.value += value;
		else
			nodes.push({ type: "text", value });
	}

	function isEscaped(i: number)
	{
		let slashes = 0;
		for (i--; i >= 0 && content[i] == "\\"; i--)
			slashes++;
		return slashes % 2 != 0;
	}

	for (let i = 0; i < content.length; i++)
	{
		if (content.startsWith("<!--", i))
		{
			const end = content.indexOf("-->", i + 4);
			if (end < 0) break;
			i = end + 2;
			continue;
		}

		if (!content.startsWith("{{", i))
			continue;
		if (isEscaped(i))
		{
			pushText(textStart, i - 1);
			pushText(i, i + 2);
			textStart = i + 2;
			i++;
			continue;
		}

		let end = -1;
		let inString = false;
		let escaped = false;
		for (let j = i + 2; j < content.length - 1; j++)
		{
			const ch = content[j];
			if (inString)
			{
				if (escaped) escaped = false;
				else if (ch === "\\") escaped = true;
				else if (ch === '"') inString = false;
				continue;
			}
			if (ch == '"') { inString = true; continue; }
			if (ch === "}" && content[j + 1] === "}")
			{
				end = j;
				break;
			}
		}
		if (end < 0) continue;

		/*
			{{ expr }}   -> hasQuotes: false
			"{{ expr }}" -> hasQuotes: true
		*/
		const hasQuotes = i > 0 && content[i - 1] == '"' && !isEscaped(i - 1) && content[end + 2] === '"';
		const textEnd = hasQuotes ? i - 1 : i;
		pushText(textStart, textEnd);
		nodes.push({ type: "expr", value: content.slice(i + 2, end), hasQuotes });

		const next = hasQuotes ? end + 3 : end + 2;
		textStart = next;
		i = next - 1;
	}

	pushText(textStart, content.length);
	return nodes;
}

// ANSI Escape Codes for backgrounds
// const BG_GREEN = "\x1b[42m\x1b[30m";  // Green bg, Black text
const BG_BLUE = "\x1b[44m\x1b[37m";   // Blue bg, White text
const RESET = "\x1b[0m";
function _printNodes(nodes: FNode[]): void
{
	console.log("\n------------------------------");
	console.log(nodes.reduce((txt, node) => txt + (
		node.type === "expr" ?
			`${BG_BLUE}${node.value.replaceAll("\n", "\n" + BG_BLUE)}${RESET}`
			: node.value
	), "\n"));
}

function getPathValue(value: unknown, path: (string | number)[]): unknown
{
	for (const key of path)
	{
		if (value === null || value === undefined)
			return value;

		const obj = Object(value);
		if (!Object.hasOwn(obj, key))
			return undefined;

		value = obj[key];
	}
	return value;
}

function processExpressions(nodes: FNode[], variables: JSONDict, logwarn: (msg: string) => void): string
{
	const re = /^\s*([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\.\d+|\[\d+\])*)(?:\s*(\?\?|\|\|)\s*"(?:\\.|[^"\\])*")?\s*$/;
	const re_path = /[A-Za-z_$][A-Za-z0-9_$]*|\d+/g;
	return nodes.map(node =>
	{
		if (node.type == "text") return node.value;
		const m = re.exec(node.value);
		const rawValue = node.hasQuotes ? `"{{${node.value}}}"` : `{{${node.value}}}`;
		if (!m) { logwarn("Unsupported expression: " + rawValue); return rawValue; }
		const name = m[1];
		const operator = m[2];
		const defval = m[3] === undefined ? undefined : JSON.parse(m[3]) as string;
		const path = name.match(re_path)?.map(part => /^\d+$/.test(part) ? Number(part) : part);
		const v = path ? getPathValue(variables, path) : undefined;
		const value =
			operator == "||" ? v || defval
				: operator == "??" ? v ?? defval : v;
		if (value === undefined) logwarn("Undefined variable: " + rawValue);
		const result = value === undefined ? rawValue
			: typeof value == "object" ? JSON.stringify(value) : `${value}`;
		// console.log(`[${path}] [${operator}] [${defval}] => [${result}]`);
		return result;
	}).join("");
}

type INode = INodeText | INodeInclude;
interface INodeText
{
	type: "text";
	value: string;
}
interface INodeInclude
{
	type: "include";
	path: string;
	dict: { [key: string]: string };
}

async function parseIncludes(content: string, logwarn: (msg: string) => void): Promise<INode[]>
{
	const { default: JSONC } = await import("jsonc-simple-parser");
	const re_doc = /^!!\(([^{}]*)\)\s*{(.*)}$/s;
	const re_codeFence = /^( {0,3})(`{3,})([^`]*)$/;
	const nodes: INode[] = [];

	let textStart = 0;
	function pushText(start: number, end: number)
	{
		if (start >= end) return;

		const value = content.slice(start, end);
		const prev = nodes.at(-1);

		if (prev?.type === "text")
			prev.value += value;
		else
			nodes.push({ type: "text", value });
	}

	let codeFence = 0;
	for (let i = 0; i < content.length; i++)
	{
		if (i != 0 && content[i - 1] != "\n") continue;

		const lineEnd = content.indexOf("\n", i);
		const line = content.slice(i, lineEnd < 0 ? content.length : lineEnd).replace(/\r$/, "");
		const m_fence = re_codeFence.exec(line);
		if (m_fence)
		{
			const ticks = m_fence[2]!.length;
			const suffix = m_fence[3]!;
			if (codeFence == 0) { codeFence = ticks; continue; }
			if (ticks >= codeFence && suffix.trim() == "") { codeFence = 0; continue; }
		}
		if (codeFence != 0) continue;
		if (content.slice(i, i + 3) !== "!!(") continue;

		const rest = content.slice(i);
		const paragraphBreak = rest.search(/\r?\n[^\S\r\n]*\r?\n/);
		const endOfParagraph = paragraphBreak < 0 ? content.length : i + paragraphBreak;

		const paragraph = content.slice(i, endOfParagraph).trimEnd();
		const m_doc = re_doc.exec(paragraph);
		if (!m_doc) continue;

		const path = trimEnd(trimStart(m_doc[1]!, "<", '"'), ">", '"');
		if (!path.toLowerCase().endsWith(".md")) continue;

		let dict = {};
		try { dict = JSONC.parse(`{${m_doc[2]!}}`); }
		catch { logwarn(`Can't parse include dict: {${m_doc[2]!.replaceAll("\n", " ")}}`); continue; }

		pushText(textStart, i);
		nodes.push({ type: "include", path, dict: stringifyDict(dict) });

		textStart = endOfParagraph;
		i = endOfParagraph - 1;
	}

	pushText(textStart, content.length);

	return nodes;
}
