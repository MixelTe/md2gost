export class Doc
{
	public sections: DocSection[] = [{ pageStart: 1, nodes: [] }];

	public appendText(text: string)
	{
		this.sections.at(-1)!.nodes.push({ type: "text", text });
	}
	public appendTitle(text: string, level: number)
	{
		this.sections.at(-1)!.nodes.push({ type: "title", text, level });
	}
	public appendNode(node: DocNode)
	{
		this.sections.at(-1)!.nodes.push(node);
	}
}

export function tableRow(...items: string[]): DocNode[]
{
	return items.map(v => ({ type: "text", text: v }));
}


export interface DocSection
{
	pageStart: number | null;
	nodes: DocNode[];
}

export type DocNode =
	NodeText | NodeTitle | NodePageBreak | NodeTableOfContents | NodeTable
	| NodeList | NodeImage | NodeCode | NodeExternalDoc | NodeSectionBreak;

export interface Rune
{
	text: string,
	anchor?: string,
	link?: string,
	color?: string,
	bold?: boolean,
	italic?: boolean,
	linebreak?: boolean,
}

export type Runify<T> = {
	[key in keyof T]: key extends "text" | "title" ? Rune[] : Runify<T[key]>;
};

export type RunicDoc = Runify<Doc>;
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

export interface NodeTable
{
	type: "table",
	title?: string,
	rows: DocNode[][],
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
	text: string,
	src: string,
	width: number | null,
	height: number | null,
}

export interface NodeCode
{
	type: "code",
	lang: string,
	title: string,
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