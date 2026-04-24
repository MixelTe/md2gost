export class Doc
{
	public nodes: DocNode[] = [];
	public codeHighlighting = false;
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

export type NodeTableAlign = "l" | "c" | "r"
export interface NodeTable
{
	type: "table",
	title?: string,
	rows: DocNode[][],
	align: NodeTableAlign[],
	normalFontSize?: boolean,
}

export interface NodeList
{
	type: "list",
	ordered?: boolean,
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