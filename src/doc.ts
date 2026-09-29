export class Doc
{
	public nodes: DocNode[] = [];
	public header: DocHeaderFooter = { type: "none" };
	public footer: DocHeaderFooter = { type: "auto" };
	public rainbow = false;
	public numberingLazy = false;
	public numberingSections = false;
	public numberingAutoprefix = true;
	public backtickMono: "italic" | "off" | "on" | "outline" = "italic";
	public title: string | undefined;
	public author: string | undefined;
	public etime: number | undefined;
	public ctime: Date | undefined;
	public mtime: Date | undefined;
	public hyphenation = false;
	public totalPagesOffset = 0;
	public headings: DocHeadings = {
		h1: { size: 14, spacing: { before: 18, after: 4 }, indent_full: false, uppercase: false },
		h3: { size: 14, spacing: { before: 8, after: 4 }, indent_full: false, uppercase: false },
		h2: { size: 14, spacing: { before: 8, after: 4 }, indent_full: false, uppercase: false },
		h4: { size: 14, spacing: { before: 8, after: 4 }, indent_full: false, uppercase: false },
		h5: { size: 14, spacing: { before: 8, after: 4 }, indent_full: false, uppercase: false },
		h6: { size: 14, spacing: { before: 8, after: 4 }, indent_full: false, uppercase: false },
	};
	public text = {
		size: 14,
		line_spacing: 1.5,
		indent: 1.25,
		spacing: { after: 8 },
	};
	public table = {
		title: {
			style: "normal" as "normal" | "bold" | "italic",
			size: undefined as undefined | number,
		},
		heading: {
			style: "normal" as "normal" | "bold" | "italic",
			align: "center" as "left" | "center" | "right",
		},
		spacing: { before: undefined as undefined | number, after: undefined as undefined | number },
		text: {
			size: 12,
			line_spacing: 1.25,
		},
	};
	public code = {
		title: {
			style: "normal" as "normal" | "bold" | "italic",
			size: undefined as undefined | number,
		},
		spacing: { before: undefined as undefined | number, after: undefined as undefined | number },
		highlight: false,
		text: { size: 12 },
	};
	public list = {
		ordered: { style: "bracket" as "bracket" | "dot" | "keep" },
		unordered: { style: "dash" as "dash" | "bullet" | "keep" },
		autopunctuation: true,
	};
	public img = {
		spacing: { before: undefined as undefined | number, after: undefined as undefined | number },
		text: { size: undefined as undefined | number },
	};
	public formula = {
		spacing: { before: 8, after: 8 },
	};
	public admonition: Record<AdmonitionType, DocAdmonitionStyle> = {
		note: { title: "**Примечание**", indent: 1.25, spacing: { before: 8, after: 8 }, padding: { top: 6, right: 10, bottom: 6, left: 10 }, background: "f5f5f5", color: "666666", bar_width: 2.25, icon: true, icon_size: 16, title_color: true },
		info: { title: "**Примечание**", indent: 1.25, spacing: { before: 8, after: 8 }, padding: { top: 6, right: 10, bottom: 6, left: 10 }, background: "f0f7ff", color: "1976d2", bar_width: 2.25, icon: true, icon_size: 16, title_color: true },
		tip: { title: "**Рекомендация**", indent: 1.25, spacing: { before: 8, after: 8 }, padding: { top: 6, right: 10, bottom: 6, left: 10 }, background: "f2f8f2", color: "2e7d32", bar_width: 2.25, icon: true, icon_size: 16, title_color: true },
		warning: { title: "**Внимание**", indent: 1.25, spacing: { before: 8, after: 8 }, padding: { top: 6, right: 10, bottom: 6, left: 10 }, background: "fff7ea", color: "b26a00", bar_width: 2.25, icon: true, icon_size: 16, title_color: true },
		danger: { title: "**Критически важно**", indent: 1.25, spacing: { before: 8, after: 8 }, padding: { top: 6, right: 10, bottom: 6, left: 10 }, background: "fff0f0", color: "d32f2f", bar_width: 2.25, icon: true, icon_size: 16, title_color: true },
	};

	public appendText(text: string, sourceLine: number)
	{
		this.nodes.push({ type: "text", text, sourceLine });
	}
	public appendTitle(text: string, level: number, sourceLine: number)
	{
		this.nodes.push({ type: "title", text, level, sourceLine });
	}
	public appendNode(node: DocNode)
	{
		this.nodes.push(node);
	}
	private lineSkips: { ln: number, d: number }[] = [];
	public addLineSkip(line: number, delta: number)
	{
		this.lineSkips.push({ ln: line, d: delta });
	}
	public mapSourceLine(line: number)
	{
		for (const { ln, d } of this.lineSkips)
			if (ln <= line) line -= d;
		return line;
	}
}

export interface DocHeadingStyle
{
	size: number,
	spacing: {
		before: number,
		after: number,
	},
	uppercase: boolean,
	indent_full: boolean,
}
export interface DocHeadings
{
	h1: DocHeadingStyle,
	h2: DocHeadingStyle,
	h3: DocHeadingStyle,
	h4: DocHeadingStyle,
	h5: DocHeadingStyle,
	h6: DocHeadingStyle,
}

export function tableRow(sourceLine: number, ...items: string[]): DocNode[]
{
	return items.map(v => ({ type: "text", text: v, sourceLine }));
}

export type DocNode = (
	NodeText | NodeTitle | NodePageBreak | NodeTableOfContents | NodeTable
	| NodeList | NodeImage | NodeCode | NodeExternalDoc | NodeSectionBreak
	| NodeAdmonition | NodeMath
) & { tags?: string[] };

export interface Rune
{
	text: string,
	type?: "text" | "ref" | "val" | "math",
	anchor?: string,
	link?: string,
	color?: string,
	bold?: boolean,
	italic?: boolean,
	mono?: boolean,
	linebreak?: boolean,
	lang?: "ru" | "en"
}

export type Runify<T> = {
	[key in keyof T]: key extends "text" | "title" ? Rune[] : Runify<T[key]>;
};

export type RunicDoc = {
	[key in keyof Doc]: key extends "nodes" | "header" | "footer" ? Runify<Doc[key]> : Doc[key];
};
export type RunicNode = Runify<DocNode>;

export interface NodeText
{
	type: "text",
	sourceLine: number,
	text: string,
	noIndent?: boolean,
	noMargin?: boolean,
	center?: boolean,
}

export interface NodeTitle
{
	type: "title",
	sourceLine: number,
	text: string,
	level: number,
	center?: boolean,
}

export interface NodePageBreak
{
	type: "pageBreak",
	sourceLine: number,
}

export interface NodeTableOfContents
{
	type: "tableOfContents",
	sourceLine: number,
}

export type NodeTableAlign = "l" | "c" | "r";
export interface NodeTable
{
	type: "table",
	sourceLine: number,
	title?: string,
	rows: DocNode[][],
	align: NodeTableAlign[],
	header?: boolean,
	normalFontSize?: boolean,
}

export type NodeListMark = "-" | "*" | "." | ")";
export interface NodeList
{
	type: "list",
	sourceLine: number,
	ordered?: boolean,
	mark: NodeListMark,
	startIndex: number,
	items: (NodeListItem | NodeList)[],
	alternativeStyle?: boolean,
}

export interface NodeListItem
{
	type: "listItem",
	sourceLine: number,
	text: string,
}

export interface NodeImage
{
	type: "image",
	sourceLine: number,
	text?: string,
	src: string,
	width: number | null,
	height: number | null,
}

export interface NodeCode
{
	type: "code",
	sourceLine: number,
	lang: string,
	title?: string,
	code: string,
}

export interface NodeMath
{
	type: "math",
	sourceLine: number,
	latex: string,
	title?: string,
}

export interface NodeExternalDoc
{
	type: "externalDoc",
	sourceLine: number,
	path: string,
	dict: { [key: string]: string };
}

export type DocPageOrientation = "portrait" | "landscape";
export interface NodeSectionBreak
{
	type: "sectionBreak",
	sourceLine: number,
	pageStart: number | null,
	orientation: DocPageOrientation | null,
	header?: DocHeaderFooter,
	footer?: DocHeaderFooter,
}

export type DocHeaderFooter =
	| { type: "auto" | "none" }
	| { type: "content", align: "left" | "center" | "right", nodes: (NodeText | NodeTable)[] };

export type AdmonitionType = "note" | "info" | "tip" | "warning" | "danger";
export interface DocAdmonitionStyle
{
	title: string,
	indent: number,
	spacing: { before: number, after: number },
	padding: { top: number, right: number, bottom: number, left: number },
	background: string,
	color: string,
	bar_width: number,
	icon: boolean,
	icon_size: number,
	title_color: boolean,
}
export interface NodeAdmonition
{
	type: "admonition",
	sourceLine: number,
	admonitionType: AdmonitionType,
	title: string,
	text: string,
	attributes: string,
}
