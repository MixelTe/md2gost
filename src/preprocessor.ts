import fs from "fs/promises";
import { deepOverwrite, getSafePathResolver, isLocalFilePath, trimEnd, trimStart, type JSONDict } from "./utils";
import path from "path";
import { UserInputError } from "./errors";

export interface TemplateExecOptions
{
	allowLoops?: boolean;
	allowIncludes?: boolean;

	maxLoopIterations?: number;
	maxTotalIterations?: number;

	maxDepth?: number;

	maxIncludeDepth?: number;
	maxIncludes?: number;

	maxFileLength?: number;
	maxTotalInputLength?: number;
	maxGeneratedLength?: number;
}

interface ExecContext
{
	options: TemplateExecOptions;
	includes: number;
	iterations: number;
	inputLength: number;
	generatedLength: number;
	signal: AbortSignal | undefined;
	logwarn: (msg: string) => void;
	countAsOutput: (v: string) => string;
}

export async function preprocess(file: string, variables: JSONDict | undefined, checkFilesIsInsidePath: string | false, options: TemplateExecOptions, signal?: AbortSignal | null, logwarn: (msg: string) => void = console.warn): Promise<string>
{
	const { resolvePath, getRelative } = getSafePathResolver(path.parse(file).dir, checkFilesIsInsidePath);
	const ctx: ExecContext = {
		options, includes: 0, iterations: 0, inputLength: 0, generatedLength: 0, signal: signal || undefined, logwarn, countAsOutput(v)
		{
			ctx.generatedLength += v.length;
			if (options.maxGeneratedLength !== undefined && ctx.generatedLength > options.maxGeneratedLength)
				throw new UserInputError(`Maximum output length exceeded (${options.maxGeneratedLength})`);
			return v;
		},
	};
	return processInclude({ type:"include", path: file, dict: {} }, variables, resolvePath, getRelative, [], ctx);
}

async function processInclude(node: INodeInclude, variables: JSONDict | undefined, resolvePath: (fname: string, origin?: string) => string, getRelative: (fname: string) => string, stack: string[], ctx: ExecContext): Promise<string>
{
	ctx.signal?.throwIfAborted();
	const fpath = resolvePath(node.path);
	const relativePath = getRelative(fpath);
	const dir = path.dirname(fpath);
	if (ctx.options.maxIncludeDepth !== undefined && stack.length > ctx.options.maxIncludeDepth)
		throw new UserInputError(`Maximum include depth exceeded while including "${relativePath}":\n${stack.join(" -> ")}`);
	if (stack.length > 0)
	{
		ctx.includes++;
		const maxIncludes = ctx.options.maxIncludes === undefined ? 1000 : ctx.options.maxIncludes;
		if (ctx.includes > maxIncludes)
			throw new UserInputError(`Maximum include count exceeded (${maxIncludes})`);
	}

	let rawContent: string;
	try
	{
		if (ctx.options.maxFileLength !== undefined)
		{
			const size = (await fs.stat(fpath)).size;
			if (size > ctx.options.maxFileLength * 3)
				throw new UserInputError(`File is too large (${size} > ${ctx.options.maxFileLength * 3}) "${relativePath}"`);
		}
		rawContent = await fs.readFile(fpath, { encoding: "utf8", signal: ctx.signal });
		if (ctx.options.maxFileLength !== undefined && rawContent.length > ctx.options.maxFileLength)
			throw new UserInputError(`File is too large (${rawContent.length} > ${ctx.options.maxFileLength}) "${relativePath}"`);
		ctx.inputLength += rawContent.length;
		if (ctx.options.maxTotalInputLength !== undefined && ctx.inputLength > ctx.options.maxTotalInputLength)
			throw new UserInputError(`Maximum total input length exceeded (${ctx.inputLength} > ${ctx.options.maxTotalInputLength})`);
	}
	catch (err)
	{
		ctx.signal?.throwIfAborted();
		if (err instanceof UserInputError) throw err;
		const reason = err instanceof Error ? err.message : String(err);
		throw new UserInputError(`Failed to read included file "${relativePath}": ${reason}`);
	}

	let content = rawContent;
	if (variables)
	{
		variables = deepOverwrite(variables, node.dict);
		const nodes = parseFExpr(rawContent);
		nodes.forEach(n => n.type == "expr" && (n.source.fname = relativePath));
		// _printNodes(nodes);
		content = processExpressions(nodes, variables || {}, ctx);
	}
	else
	{
		variables = {};
		ctx.countAsOutput(content);
	}
	content = await fixLinks(content, fixLink);
	if (!ctx.options.allowIncludes) return content;
	const includes = await parseIncludes(content, ctx.logwarn);
	let result = "";
	for (const node of includes)
	{
		if (node.type == "text") result += node.value;
		else result += await processInclude(node, variables, resolvePath, getRelative, [...stack, relativePath], ctx);
	}
	if (node.sourceLineCount)
	{
		const delta = result.split("\n").length - node.sourceLineCount + 1;
		result += "\n\uE100" + delta + "\uE101";
	}
	return result;

	function fixLink(oldpath: string)
	{
		if (!isLocalFilePath(oldpath)) return oldpath;
		return getRelative(resolvePath(oldpath, dir));
	}
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
	source: NodeSource;
}
type WithSource<T> = T & { source: NodeSource };
interface NodeSource
{
	ln: number;
	col: number;
	fname?: string;
}

function parseFExpr(content: string): FNode[]
{
	const nodes: FNode[] = [];
	let textStart = 0;
	let ln = 1;

	function pushText(start: number, end: number)
	{
		if (start >= end) return;

		const value = content.slice(start, end);
		const prev = nodes.at(-1);

		for (let i = start; i < end; i++)
			if (content[i] == "\n") ln++;

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
		const lineStart = content.lastIndexOf("\n", i + 2);
		const source = { ln, col: lineStart < 0 ? i + 1 : i - lineStart };
		nodes.push({ type: "expr", value: content.slice(i + 2, end), hasQuotes, source });

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

function getByPath(value: unknown, path: (string | number)[]): unknown
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

function processExpressions(nodes: FNode[], variables: JSONDict, ctx: ExecContext): string
{
	const expr = parseExp(nodes, ctx);
	const tree = buildExpTree(expr, ctx);
	const res = execExpTree(tree, variables, ctx);
	return res.join("");
}

type ENode = ENodeText | WithSource<ENodeVar | ENodeFor | ENodeForEnd | ENodeIf | ENodeIfEnd | ENodeElse>;
type VarPath = (string | number)[];
interface ENodeText
{
	type: "text";
	value: string;
}
interface ENodeVar
{
	type: "var";
	path: VarPath
	def?: string;
	defPipe: boolean;
	hasQuotes: boolean;
}
interface ENodeFor
{
	type: "for";
	varValue: string;
	varKey?: string;
	arrayPath: VarPath;
}
interface ENodeForEnd
{
	type: "forEnd";
}
interface ENodeIf
{
	type: "if";
	left: { t: "val", val: any } | { t: "var", path: VarPath };
	operator?: "==" | "!=" | "<" | "<=" | ">" | ">=" | "in";
	right?: { t: "val", val: any } | { t: "var", path: VarPath };
}
interface ENodeIfEnd
{
	type: "ifEnd";
}
interface ENodeElse
{
	type: "else";
}

function parseExp(nodes: FNode[], ctx: ExecContext): ENode[]
{
	const reVar = String.raw`[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*|\.\d+|\[\d+\])*`;
	const reIdent = String.raw`[A-Za-z_$][A-Za-z0-9_$]*`;
	const reStr = String.raw`"(?:\\.|[^"\\])*"`;
	const reNum = String.raw`-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?`;
	const reVal = String.raw`(?:${reStr}|${reNum}|true|false|null)`;
	const re_var = new RegExp(String.raw`^\s*(${reVar})(?:\s*(\?\?|\|\|)\s*(${reStr}))?\s*$`);
	const re_val = new RegExp(String.raw`^${reVal}$`);
	const re_str = new RegExp(String.raw`^\s*(${reStr})\s*$`);
	const re_else = /^:else\s*$/;
	const re_for = new RegExp(String.raw`^#for\s+(${reIdent})(?:\s*,\s*(${reIdent}))?\s+in\s+(${reVar})$`);
	const re_forEnd = /^\/for\s*$/;
	const re_if = new RegExp(String.raw`^#if\s+((?:${reVar})|${reVal})\s*(?:(==|!=|<=|>=|<|>|\bin\b)\s*((?:${reVar})|${reVal}))?$`);
	const re_ifEnd = /^\/if\s*$/;
	const re_path = /[A-Za-z_$][A-Za-z0-9_$]*|\d+/g;
	return nodes.map((node): ENode  =>
	{
		ctx.signal?.throwIfAborted();
		if (node.type == "text") return { type: "text", value: node.value };
		const enode = node;
		const source = node.source;
		const rawValue = node.hasQuotes ? `"{{${node.value}}}"` : `{{${node.value}}}`;
		function retWarn(msg: string)
		{
			ctx.logwarn(msg + pos(enode));
			return { type: "text", value: rawValue } as const;
		}
		const mvar = re_var.exec(node.value);
		if (mvar)
		{
			const name = mvar[1];
			const operator = mvar[2];
			const defval = mvar[3] === undefined ? undefined : safeParse(mvar[3]);
			if (mvar[3] !== undefined && typeof defval !== "string") return retWarn("Cant parse string: " + mvar[3]);
			const path = parsePath(name);
			if (!path) return retWarn("Unsupported expression: " + rawValue);
			return { type: "var", path, def: defval, defPipe: operator == "||", source, hasQuotes: node.hasQuotes };
		}
		const mstr = re_str.exec(node.value);
		if (mstr)
		{
			const str = safeParse(node.value);
			if (str === undefined) return retWarn("Cant parse string: " + node.value);
			return { type: "text", value: node.hasQuotes ? JSON.stringify(str) : `${str}` };
		}
		const mfor = re_for.exec(node.value);
		if (mfor)
		{
			if (!ctx.options.allowLoops) return retWarn("Loop expressions are not allowed");
			const varValue = mfor[1];
			const varKey = mfor[2];
			const arrayPathStr = mfor[3];
			const arrayPath = parsePath(arrayPathStr);
			if (!arrayPath) return retWarn("Unsupported expression: " + rawValue);
			return { type: "for", varValue, varKey, arrayPath, source };
		}
		const mif = re_if.exec(node.value);
		if (mif)
		{
			function parseOperand(value: string | undefined)
			{
				if (!value) return undefined;
				if (re_val.test(value))
				{
					const val = safeParse(value);
					if (val === undefined) return null;
					return { t: "val", val } as const;
				}
				const path = parsePath(value);
				if (!path) return null;
				return { t: "var", path } as const;
			}
			const left = parseOperand(mif[1]);
			if (!left) return retWarn("Unsupported expression: " + rawValue);
			const operator = mif[2] as ENodeIf["operator"] | undefined;
			if (!operator) return { type: "if", left, source };
			const right = parseOperand(mif[3]);
			if (!right) return retWarn("Unsupported expression: " + rawValue);
			return { type: "if", left, operator, right, source };
		}
		if (re_else.exec(node.value)) return { type: "else", source };
		if (re_ifEnd.exec(node.value)) return { type: "ifEnd", source };
		if (re_forEnd.exec(node.value))
		{
			if (!ctx.options.allowLoops) return retWarn("Loop expressions are not allowed");
			return { type: "forEnd", source };
		}
		return retWarn("Unsupported expression: " + rawValue);
	});
	function pos(node: { source: NodeSource; })
	{
		return ` [Ln ${node.source.ln}, Col ${node.source.col}] (${node.source.fname})`;
	}
	function safeParse(value: string)
	{
		try { return JSON.parse(value); }
		catch { return undefined; }
	}
	function parsePath(value: string | undefined): VarPath | undefined
	{
		const parts = value?.match(re_path);
		if (!parts?.length) return undefined;
		return parts.map(part => /^\d+$/.test(part) ? Number(part) : part);
	}
}

type TNode = TNodeText | WithSource<TNodeVar | TNodeFor | TNodeIf>;
type TNodeText = ENodeText;
type TNodeVar = ENodeVar;
type TNodeFor = ENodeFor &
{
	body: TNode[];
	bodyElse?: TNode[];
};
type TNodeIf = ENodeIf &
{
	body: TNode[];
	bodyElse?: TNode[];
};

function buildExpTree(nodes: ENode[], ctx: ExecContext, depth = 0, source?: NodeSource): TNode[]
{
	ctx.signal?.throwIfAborted();
	if (ctx.options.maxDepth !== undefined && depth >= ctx.options.maxDepth)
	{
		ctx.logwarn(`Maximum expression nesting depth exceeded (${ctx.options.maxDepth})${source ? pos({ source }) : ""}`);
		return nodes.map(n =>
		{
			if (n.type == "text" || n.type == "var") return n;
			if (n.type == "else" || n.type == "forEnd" || n.type == "ifEnd")
			{
				const str = n.type == "else" ? "{:else}" : n.type == "ifEnd" ? "{#if}" : "{#for}";
				return { type: "text", value: str };
			}
			if (n.type == "for")
			{
				const second = n.varKey ? `, ${n.varKey}` : "";
				return { type: "text", value: `{/for ${n.varValue}${second} in ${n.arrayPath.join(".")}}` };
			}
			if (n.type == "if")
			{
				const v = (v: ENodeIf["left"]) => v.t == "val" ? JSON.stringify(v.val) : v.path.join(".");
				const right = n.right ? ` ${n.operator} ${v(n.right)}` : "";
				return { type: "text", value: `{/if ${v(n.left)}${right}}` };
			}
			n satisfies never;
			return { type: "text", value: "" };
		});
	}
	const tree = [] as TNode[];
	for (let i = 0; i < nodes.length; i++)
	{
		const node = nodes[i];
		if (node.type == "text" || node.type == "var")
		{
			tree.push(node);
		}
		if (node.type == "else" || node.type == "forEnd" || node.type == "ifEnd")
		{
			const str = node.type == "else" ? "{:else}" : node.type == "ifEnd" ? "{#if}" : "{#for}";
			ctx.logwarn(`Unexpected expression (${str})` + pos(node));
			tree.push({ type: "text", value: str });
		}
		if (node.type == "for" || node.type == "if")
		{
			const r = parseBlockWithElse(i);
			if (!r)
			{
				if (node.type == "for")
				{
					const second = node.varKey ? `, ${node.varKey}` : "";
					tree.push({ type: "text", value: `{/for ${node.varValue}${second} in ${node.arrayPath.join(".")}}` });
				}
				else if (node.type == "if")
				{
					const v = (v: ENodeIf["left"]) => v.t == "val" ? JSON.stringify(v.val) : v.path.join(".");
					const right = node.right ? ` ${node.operator} ${v(node.right)}` : "";
					tree.push({ type: "text", value: `{/if ${v(node.left)}${right}}` });
				}
			}
			else
			{
				const { body, bodyElse, endI } = r;
				i = endI;
				tree.push({ ...node, body, bodyElse });
			}
		}
	}
	return tree;
	function pos(node: { source: NodeSource; })
	{
		return ` [Ln ${node.source.ln}, Col ${node.source.col}] (${node.source.fname})`;
	}
	type BlockType = "for" | "if";
	function findBlockEnd(startI: number, type: BlockType, skipElse: boolean)
	{
		const stack = [] as BlockType[];
		for (let i = startI; i < nodes.length; i++)
		{
			const node = nodes[i];
			if (node.type == "if") stack.push("if");
			else if (node.type == "for") stack.push("for");
			else if (node.type == "forEnd" && stack.at(-1) == "for") stack.pop();
			else if (node.type == "ifEnd" && stack.at(-1) == "if") stack.pop();
			else if (stack.length == 0)
			{
				if (node.type == "else" && !skipElse) return i;
				if (node.type == "forEnd" && type == "for") return i;
				if (node.type == "ifEnd" && type == "if") return i;
			}
		}
		return -1;
	}
	function parseBlockWithElse(startI: number)
	{
		const node = nodes[startI];
		if (node.type != "for" && node.type != "if") return null;
		const n = node;
		const type = n.type;
		const unclosed = (m: string) => ctx.logwarn(`Unclosed ${type} ${m}` + pos(n));
		const bodyEnd = findBlockEnd(startI + 1, type, false);
		if (bodyEnd < 0) { unclosed("body"); return null; }
		const bodyNodes = nodes.slice(startI + 1, bodyEnd);
		const body = buildExpTree(bodyNodes, ctx, depth + 1, n.source);
		let endI = bodyEnd;
		let bodyElse: TNode[] | undefined;
		if (nodes[bodyEnd].type == "else")
		{
			const bodyElseEnd = findBlockEnd(bodyEnd + 1, type, true);
			if (bodyElseEnd < 0) { unclosed("else block"); return null; }
			const bodyElseNodes = nodes.slice(bodyEnd + 1, bodyElseEnd);
			bodyElse = buildExpTree(bodyElseNodes, ctx, depth + 1, n.source);
			endI = bodyElseEnd;
		}
		return { body, bodyElse, endI };
	}
}

function execExpTree(tree: TNode[], variables: JSONDict, ctx: ExecContext): string[]
{
	return tree.flatMap((node): string | string[] =>
	{
		ctx.signal?.throwIfAborted();
		if (node.type == "text") return ctx.countAsOutput(node.value);
		if (node.type == "var")
		{
			const v = getByPath(variables, node.path);
			const value = node.def === undefined ? v : (node.defPipe ? v || node.def : v ?? node.def);
			const rawValue = node.hasQuotes ? `"{{${node.path.join(".")}}}"` : `{{${node.path.join(".")}}}`;
			if (value === undefined) ctx.logwarn("Undefined variable: " + rawValue + pos(node));
			const result = value === undefined ? rawValue
				: typeof value == "object" || node.hasQuotes ? JSON.stringify(value) : `${value}`;
			return ctx.countAsOutput(result);
		}
		if (node.type == "if")
		{
			const left = node.left.t == "val" ? node.left.val : getByPath(variables, node.left.path);
			let result: boolean;
			if (node.operator && node.right)
			{
				const right = node.right.t == "val" ? node.right.val : getByPath(variables, node.right.path);
				if (node.operator == "==") result = isEqual(left, right);
				else if (node.operator == "!=") result = !isEqual(left, right);
				else if (node.operator == "<=") result = left < right || isEqual(left, right);
				else if (node.operator == ">=") result = left > right || isEqual(left, right);
				else if (node.operator == "<") result = left < right;
				else if (node.operator == ">") result = left > right;
				else if (node.operator == "in") result = !!right && typeof right == "object" &&
					(Array.isArray(right) ? right : Object.keys(right)).some(v => isEqual(v, left));
				else { node.operator satisfies never; result = false; }
			}
			else
			{
				if (left && typeof left == "object")
					result = (Array.isArray(left) ? left : Object.keys(left)).length > 0;
				else result = !!left;
			}
			if (result) return execExpTree(node.body, variables, ctx);
			if (node.bodyElse) return execExpTree(node.bodyElse, variables, ctx);
			return "";
		}
		if (node.type == "for")
		{
			if (!ctx.options.allowLoops) throw new UserInputError("Loop expressions are not allowed");
			const arr = getByPath(variables, node.arrayPath);
			if (!arr || typeof arr == "object" && (Array.isArray(arr) ? arr : Object.keys(arr)).length == 0)
			{
				if (node.bodyElse) return execExpTree(node.bodyElse, variables, ctx);
				return "";
			}
			const values = (() =>
			{
				const n = node;
				function checkLoopIterations(count: number, final = true)
				{
					const max = ctx.options.maxLoopIterations;
					if (max !== undefined && count > max)
						throw new UserInputError(`Maximum loop iterations exceeded (${final ? count + " " : ""}> ${max})` + pos(n));
				}
				if (typeof arr == "number" && Number.isInteger(arr))
				{
					if (arr < 0) { ctx.logwarn(`For loop source is a negative integer (${arr})` + pos(node)); return []; }
					checkLoopIterations(arr);
					return Array.from({ length: arr }, (_, i) => ({ k: i, v: i + 1 }));
				}
				if (typeof arr == "object")
				{
					if (Array.isArray(arr))
					{
						checkLoopIterations(arr.length);
						return arr.map((v, i) => ({ k: i, v }));
					}
					const keys = Object.keys(arr);
					checkLoopIterations(keys.length);
					return keys.map(k => ({ k, v: (arr as any)[k] }));
				}
				if (typeof arr == "string")
				{
					// arr.length is wrong for unicode
					const values: { k: number; v: string }[] = [];
					for (const v of arr)
					{
						values.push({ k: values.length, v });
						checkLoopIterations(values.length, false);
					}
					return values;
				}
			})();
			if (!values) { ctx.logwarn(`For loop source is not object, string or integer (${arr})` + pos(node)); return ""; }
			return values.flatMap(({ k, v }) =>
			{
				ctx.signal?.throwIfAborted();
				ctx.iterations++;
				if (ctx.options.maxTotalIterations !== undefined && ctx.iterations > ctx.options.maxTotalIterations)
					throw new UserInputError(`Maximum total loop iterations exceeded (${ctx.options.maxTotalIterations})`);
				// to protect from __proto__
				const locals = Object.assign(Object.create(null), variables) as JSONDict;
				locals[node.varValue] = v;
				if (node.varKey) locals[node.varKey] = k;
				return execExpTree(node.body, locals, ctx);
			});
		}
		node satisfies never;
		return "";
	});
	function pos(node: { source: NodeSource; })
	{
		return ` [Ln ${node.source.ln}, Col ${node.source.col}] (${node.source.fname})`;
	}
	function isEqual(obj1: any, obj2: any)
	{
		if (obj1 === obj2) return true;
		if (obj1 == null || obj2 == null || typeof obj1 !== "object" || typeof obj2 !== "object")
			return obj1 == obj2;
		const keys1 = Object.keys(obj1);
		const keys2 = Object.keys(obj2);
		if (keys1.length !== keys2.length) return false;
		for (const key of keys1)
			if (!Object.hasOwn(obj2, key) || !isEqual(obj1[key], obj2[key]))
				return false;
		return true;
	}
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
	sourceLineCount?: number;
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

		const paragraph = content.slice(i, endOfParagraph);
		const m_doc = re_doc.exec(paragraph.trimEnd());
		if (!m_doc) continue;

		const path = trimEnd(trimStart(m_doc[1]!, "<", '"'), ">", '"');
		if (!path.toLowerCase().endsWith(".md")) continue;

		let dict = {};
		try { dict = JSONC.parse(`{${m_doc[2]!}}`); }
		catch { logwarn(`Can't parse include dict: {${m_doc[2]!.replaceAll("\n", " ")}}`); continue; }

		pushText(textStart, i);
		nodes.push({ type: "include", path, dict, sourceLineCount: paragraph.split("\n").length });

		textStart = endOfParagraph;
		i = endOfParagraph - 1;
	}

	pushText(textStart, content.length);

	return nodes;
}

async function fixLinks(content: string, fixLink: (oldpath: string) => string): Promise<string>
{
	const { default: JSONC } = await import("jsonc-simple-parser");
	const re_codeFence = /^( {0,3})(`{3,})([^`]*)$/;
	let result = "";

	let textStart = 0;
	function append(start: number, end: number)
	{
		if (start >= end) return;
		result += content.slice(start, end);
	}

	let codeFence = 0;
	for (let i = 0; i < content.length; i++)
	{
		if (i != 0 && content[i - 1] != "\n") continue;

		const lineEnd = content.indexOf("\n", i);
		const lineTextEnd = lineEnd < 0 ? content.length : lineEnd - (content[lineEnd - 1] == "\r" ? 1 : 0);
		const line = content.slice(i, lineTextEnd);
		const m_fence = re_codeFence.exec(line);
		if (m_fence)
		{
			const ticks = m_fence[2]!.length;
			const suffix = m_fence[3]!;
			if (codeFence == 0) { codeFence = ticks; continue; }
			if (ticks >= codeFence && suffix.trim() == "") { codeFence = 0; continue; }
		}
		if (codeFence != 0) continue;
		if (content.at(i) != "!") continue;

		const m_img = /^!\[(.*)\]\((.*)\)({(.*)})?$/.exec(line);
		if (m_img)
		{
			append(textStart, i);
			result += `![${m_img[1]}](${fixLink(m_img[2])})${m_img[3] || ""}`;
			textStart = lineTextEnd;
			i = lineEnd < 0 ? content.length : lineEnd;
			continue;
		}

		const rest = content.slice(i);
		const paragraphBreak = rest.search(/\r?\n[^\S\r\n]*\r?\n/);
		const endOfParagraph = paragraphBreak < 0 ? content.length : i + paragraphBreak;
		const paragraph = content.slice(i, endOfParagraph);

		const m_doc = /^!!\(([^{}]*)\)(\s*{(.*)})$/s.exec(paragraph);
		if (!m_doc) continue;

		try { JSONC.parse(m_doc[2].trim()); }
		catch { continue; }

		append(textStart, i);
		result += `!!(${fixLink(m_doc[1])})${m_doc[2]}`;
		textStart = endOfParagraph;
		i = endOfParagraph - 1;
	}

	append(textStart, content.length);

	return result;
}

