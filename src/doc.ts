export class Doc
{
	public nodes: DocNode[] = [];
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

	public appendText(text: string)
	{
		this.nodes.push({ type: "text", text });
	}
	public appendTitle(text: string, level: number)
	{
		this.nodes.push({ type: "title", text, level });
	}
	public appendNode(node: DocNode)
	{
		this.nodes.push(node);
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

export function tableRow(...items: string[]): DocNode[]
{
	return items.map(v => ({ type: "text", text: v }));
}

export type DocNode = (
	NodeText | NodeTitle | NodePageBreak | NodeTableOfContents | NodeTable
	| NodeList | NodeImage | NodeCode | NodeExternalDoc | NodeSectionBreak
) & { tags?: string[] };

export interface Rune
{
	text: string,
	type?: "text" | "ref" | "val",
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
	[key in keyof Doc]: key extends "nodes" ? Runify<Doc[key]> : Doc[key];
};
export type RunicNode = Runify<DocNode>;

export interface NodeText
{
	type: "text",
	text: string,
	noIndent?: boolean,
	noMargin?: boolean,
	center?: boolean,
}

export interface NodeTitle
{
	type: "title",
	text: string,
	level: number,
	center?: boolean,
}

export interface NodePageBreak
{
	type: "pageBreak",
}

export interface NodeTableOfContents
{
	type: "tableOfContents",
}

export type NodeTableAlign = "l" | "c" | "r";
export interface NodeTable
{
	type: "table",
	title?: string,
	rows: DocNode[][],
	align: NodeTableAlign[],
	normalFontSize?: boolean,
}

export type NodeListMark = "-" | "*" | "." | ")";
export interface NodeList
{
	type: "list",
	ordered?: boolean,
	mark: NodeListMark,
	startIndex: number,
	items: (NodeListItem | NodeList)[],
	alternativeStyle?: boolean,
}

export interface NodeListItem
{
	type: "listItem",
	text: string,
}

export interface NodeImage
{
	type: "image",
	text?: string,
	src: string,
	width: number | null,
	height: number | null,
}

export interface NodeCode
{
	type: "code",
	lang: string,
	title?: string,
	code: string,
}

export interface NodeExternalDoc
{
	type: "externalDoc",
	path: string,
	dict: { [key: string]: string };
}

export interface NodeSectionBreak
{
	type: "sectionBreak",
	pageStart: number | null,
}