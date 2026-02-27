import * as fs from "fs";
import { AlignmentType, Document, Footer, convertMillimetersToTwip, Packer, PageBreak, PageNumber, Paragraph, TableOfContents, TextRun, type FileChild, type ISectionOptions, type INumberingOptions, LevelFormat, type ParagraphChild, Table, TableRow, TableCell, ImageRun, ExternalHyperlink, InternalHyperlink, Bookmark } from "docx";
import type { DocNode, NodeList, Rune, RunicDoc, RunicNode, Runify } from "./doc";
import { randomInt, type DeepWriteable } from "./utils";
import { imageSize } from "image-size";
import path from "path";

const STYLE_list = "aff0";
const STYLE_code_title = "afe";
const STYLE_code = "af6";

type IListItem = DeepWriteable<INumberingOptions>["config"][number];
type IListItemLevel = IListItem["levels"][number]
export async function serializeDocx(doc: RunicDoc, fout: string, workdir: string, assets: string)
{
	const getPath = (fname: string) => path.isAbsolute(fname) ? fname : path.join(workdir, fname);
	const sections: ISectionOptions[] = [];
	const numbering: DeepWriteable<INumberingOptions>["config"] = [];

	(function splitSections()
	{
		for (let i = 0; i < doc.sections.length; i++)
		{
			const section = doc.sections[i]!;
			for (let j = 0; j < section.nodes.length; j++)
			{
				const node = section.nodes[j]!;
				if (node.type == "sectionBreak")
				{
					const nodes = section.nodes;
					section.nodes = nodes.slice(0, j);
					doc.sections.splice(i + 1, 0, {
						nodes: nodes.slice(j + 1),
						pageStart: node.pageStart,
					});
					break;
				}
			}
		}
		doc.sections = doc.sections.filter(s => s.nodes.length > 0);
	})();

	for (const section of doc.sections)
	{
		const children: FileChild[] = [];
		sections.push({
			children,
			properties: {
				page: {
					pageNumbers: !section.pageStart ? {} : {
						start: section.pageStart,
					},
					margin: {
						top: convertMillimetersToTwip(20),
						left: convertMillimetersToTwip(30),
						right: convertMillimetersToTwip(15),
						bottom: convertMillimetersToTwip(20),
					}
				}
			},
			footers: {
				default: new Footer({
					children: !section.pageStart ? [] : [
						new Paragraph({
							alignment: AlignmentType.CENTER,
							children: [new TextRun({ children: [PageNumber.CURRENT] })],
							indent: { firstLine: 0 },
							spacing: { line: 240 },
						}),
					],
				}),
			},
		});

		function renderNode(node: RunicNode, prevChild?: FileChild): FileChild | FileChild[]
		{
			switch (node.type)
			{
				case "text":
					return new Paragraph({
						children: renderText(node.text),
						indent: node.noIndent ? { firstLine: 0 } : {},
						spacing: {
							...(node.noMargin ? { after: 0 } : {}),
							...(prevChild instanceof Table ? { before: 8 * 20 } : {}),
						}
					});
				case "title":
					if (node.level < 0 || node.level > 6) throw new Error("Wrong heading level");
					return new Paragraph({
						children: renderText(node.text),
						style: `${node.level}`,
						...(node.center ? { alignment: "center", indent: { firstLine: 0 } } : {}),
					});
				case "pageBreak":
					if (!(prevChild instanceof Paragraph))
						return new Paragraph({ children: [new PageBreak()] });
					prevChild.addChildElement(new PageBreak());
					return [];
				case "list":
					const id = `l${numbering.length + 1}`;
					const list: IListItem = {
						reference: id,
						levels: []
					};
					numbering.push(list);
					const items: FileChild[] = [];
					let addMargin = prevChild instanceof Table;
					renderList(node);
					function renderList(node: Runify<NodeList>, level: number = 0)
					{
						addListItemLevel(list.levels, level, node.startIndex, !!node.ordered, !!node.alternativeStyle);
						for (const item of node.items)
						{
							if (item.type == "list") renderList({ ...item, alternativeStyle: !!node.alternativeStyle }, level + 1);
							else
							{
								items.push(new Paragraph({
									children: renderText(item.text),
									style: STYLE_list,
									numbering: { reference: id, level },
									spacing: {
										...(addMargin ? { before: 8 * 20 } : {}),
									}
								}));
								addMargin = false;
							}
						}
					}
					return items;
				case "table":
					return [
						...(node.title ? [
							new Paragraph({
								children: renderText(node.title),
								indent: { firstLine: 0 },
								spacing: { line: 240 },
								keepNext: true,
							}),
						] : []),
						new Table({
							// width: { type: "pct", size: 100 },
							width: { type: "dxa", size: 9572 },
							rows: node.rows.map((row, rowI) => new TableRow({
								tableHeader: rowI == 0,
								cantSplit: true,
								children: row.map(item => new TableCell({
									children: item.type != "text" ? renderNodeL(item) : [
										new Paragraph({
											children: renderText(item.text, !node.normalFontSize),
											alignment: rowI == 0 ? "center" : "left",
											indent: { firstLine: 0 },
											spacing: { after: 0, line: 240 * 1.25 },
										})
									],
								})),
							})),
						}),
					];
				case "tableOfContents":
					return [
						new TableOfContents("Оглавление", {
							hyperlink: true,
							headingStyleRange: "1-3",
						}),
						new Paragraph({ children: [new PageBreak()] })
					];
				case "image":
					const type = node.src.split(".").at(-1) || "";
					if (!["jpg", "png", "gif", "bmp", "svg"].includes(type))
						throw new Error(`Unsupported image format: "${type}", file: ${node.src}`);
					const img_path = getPath(node.src);
					if (!fs.existsSync(img_path))
						throw new Error(`File not exist: ${node.src}`);
					const data = fs.readFileSync(img_path);
					const dimensions = imageSize(data);
					const [MaxW, MaxH] = [600, 800];
					let [width, height] = [dimensions.width, dimensions.height];
					if (node.width && node.height) [width, height] = [node.width, node.height];
					if (node.width) [width, height] = [node.width, height / width * node.width];
					if (node.height) [width, height] = [width / height * node.height, node.height];
					if (height > MaxH) [width, height] = [width / height * MaxH, MaxH];
					if (width > MaxW) [width, height] = [MaxW, height / width * MaxW];
					return [
						new Paragraph({
							alignment: "center",
							indent: { firstLine: 0 },
							spacing: { line: 240 },
							keepNext: !!node.text,
							children: [
								new ImageRun({
									type: type as any,
									data,
									transformation: { width, height },
								}),
							],
						}),
						...(node.text ? [
							new Paragraph({
								children: renderText(node.text),
								alignment: "center",
								indent: { firstLine: 0 },
								spacing: { line: 240 },
							}),
						] : []),
					];
				case "code":
					const code = doc.codeHighlighting && renderCodeHighlighting(node.code, node.lang);
					return [
						...(node.title ? [
							new Paragraph({
								children: renderText(node.title),
								style: STYLE_code_title,
							})
						] : []),
						...(code ? code :
							node.code.split("\n").map(p =>
								new Paragraph({
									children: [new TextRun(p)],
									style: STYLE_code,
								}))
						),
					];
				case "externalDoc":
					const doc_path = getPath(node.path);
					if (!fs.existsSync(doc_path))
						throw new Error(`File not exist: ${node.path}`);
					if (path.extname(doc_path) != ".docx")
						throw new Error(`File not .docx: ${node.path}`);
					return new Paragraph({
						text: `!!(${doc_path})${JSON.stringify(node.dict)}`,
						indent: { firstLine: 0 },
						alignment: "left",
					});
				case "sectionBreak":
					return [];
				default:
					node satisfies never;
					throw new Error("switch default");
			}
		}
		function renderNodeL(node: RunicNode, prevChild?: FileChild)
		{
			const r = renderNode(node, prevChild);
			if (r instanceof Array) return r;
			return [r];
		}

		for (const node of section.nodes)
			children.push(...renderNodeL(node, children.at(-1)));
	}

	const docx = new Document({
		sections,
		externalStyles: fs.readFileSync(path.join(assets, "styles.xml"), { encoding: "utf8" }),
		// features: { updateFields: true },
		numbering: { config: numbering },
		// title: doc.title,
		// creator: doc.author,
		// lastModifiedBy: doc.author,
	});
	const buffer = await Packer.toBuffer(docx, undefined, [
		{ path: "docProps/app.xml", data: genXml_app({ totalTime: doc.etime }) },
		{
			path: "docProps/core.xml",
			data: genXml_core({
				title: doc.title,
				creator: doc.author,
				createdAt: doc.ctime,
				modifiedAt: doc.mtime,
			})
		},
	]);
	fs.writeFileSync(fout, buffer);
}

function addListItemLevel(levels: IListItemLevel[], level: number, startIndex: number, ordered: boolean, alternativeStyle: boolean)
{
	if (levels.find(v => v.level == level)) return;
	levels.sort((a, b) => a.level - b.level);
	let indent = level;
	const format = ordered ? LevelFormat.DECIMAL : LevelFormat.BULLET;
	for (let i = 1; i < levels.length + 1; i++)
	{
		const prevprevformat = levels[i - 2]?.format;
		const prevformat = levels[i - 1]?.format;
		const curformat = i < levels.length ? levels[i]?.format : format;
		if (prevprevformat != curformat && prevformat != curformat) indent--;
	}
	const left = alternativeStyle ? 0 : 17.5;
	levels.push({
		level,
		format,
		start: startIndex,
		text: ordered ? (alternativeStyle ? `%${level + 1}.` : `%${level + 1})`) : "\u2012",
		style: {
			paragraph: {
				indent: {
					left: convertMillimetersToTwip(left + 5 * indent),
					...(alternativeStyle ? { firstLine: convertMillimetersToTwip(12.5) } : {}),
				},
			},
		},
	});
}

function renderText(text: string | Rune[], small: boolean = false): ParagraphChild[]
{
	function renderRune(rune: Rune, link: boolean = false): ParagraphChild
	{
		if (rune.anchor) return new Bookmark({
			id: rune.anchor,
			children: [renderRune({ ...rune, anchor: undefined })],
		});
		if (rune.link)
		{
			const children = [renderRune({ ...rune, link: undefined }, true)];
			return rune.link.startsWith("#") ?
				new InternalHyperlink({ children, anchor: rune.link.slice(1) }) :
				new ExternalHyperlink({ children, link: rune.link });
		}
		return new TextRun({
			text: rune.text,
			language: { value: rune.lang == "en" ? "en-US" : "ru-RU" },
			...(rune.linebreak ? { break: 1 } : {}),
			...(rune.bold ? { bold: true } : {}),
			...(rune.italic ? { italics: true } : {}),
			...(link ? { color: "0563c1", underline: { type: "single" } } : {}),
			...(rune.color ? { color: rune.color } : {}),
			...(small ? { size: 24 } : {}),
		});
	}
	if (typeof text == "string") text = [{ text }];
	text = splitRunesByLang(text);
	return text.map(r => renderRune(r));

	function splitRunesByLang(runes: Rune[]): Rune[]
	{
		const result: Rune[] = [];
		for (let r = 0; r < runes.length; r++)
		{
			const rune = runes[r];
			const text = rune.text;

			if (!text || text.length === 0)
			{
				result.push(rune);
				continue;
			}

			let bufferStart = 0;
			let lastType = 0;
			let segmentType = 0;

			for (let i = 0; i < text.length; i++)
			{
				const code = text.charCodeAt(i);
				let type = 0;
				if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122))
					type = 1; // latin
				else if (code >= 0x0400 && code <= 0x04ff)
					type = 2; // cyrillic

				if (segmentType === 0 && type !== 0) segmentType = type;

				if (
					i > bufferStart &&
					type !== 0 &&
					lastType !== 0 &&
					type !== lastType
				)
				{
					result.push(copyRune(rune, text.slice(bufferStart, i), segmentType, bufferStart == 0));
					bufferStart = i;
					segmentType = type;
				}

				if (type !== 0) lastType = type;
			}
			if (bufferStart === 0)
				result.push(copyRune(rune, text, segmentType || lastType, true));
			else
				result.push(copyRune(rune, text.slice(bufferStart), segmentType, false));
		}

		return result;

		function copyRune(src: Rune, text: string, type: number, first: boolean): Rune
		{
			return {
				text,
				anchor: first ? src.anchor : undefined,
				link: src.link,
				color: src.color,
				bold: src.bold,
				italic: src.italic,
				linebreak: src.linebreak && first,
				lang: type == 1 ? "en" : type == 2 ? "ru" : undefined,
			};
		}
	}
}
// const docx = new Document({
// 	sections,
// 	styles: {
// 		default: {
// 			document: {
// 				run: font,
// 				paragraph: {
// 					alignment: "both",
// 					indent: { firstLine: 710 },
// 					spacing: {
// 						line: 240 * 1.5,
// 						after: 8 * 20,
// 					}
// 				}
// 			},
// 			heading1: heading,
// 			heading2: heading,
// 			heading3: heading,
// 			heading4: heading,
// 			heading5: heading,
// 			heading6: heading,
// 			title: {
// 				...heading,
// 				paragraph: {
// 					alignment: "center",
// 					indent: { firstLine: 0 }
// 				}
// 			},
// 		},
// 		paragraphStyles: [
// 			{
// 				id: "MySpectacularStyle",
// 				name: "My Spectacular Style",
// 				basedOn: "Heading1",
// 				next: "Heading1",
// 				quickFormat: true,
// 				run: {
// 					italics: true,
// 					color: "990000",
// 				},
// 			},
// 		],
// 	},
// });

import Prism from "prismjs";
import "prismjs/components/prism-clike";

import "prismjs/components/prism-markup"; // html, xml
import "prismjs/components/prism-css";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-json";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-powershell";
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-php";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-nginx";


function renderCodeHighlighting(code: string, lang: string)
{
	const grammar = Prism.languages[lang.trim().toLowerCase()];
	if (!grammar) return null;

	const themeColors = {
		// shared
		"plain": "000000",
		"comment": "008000",
		"punctuation": "000000",
		"operator": "000000",

		// keywords & control flow
		"keyword": "0000ff",
		"boolean": "0000ff",
		"builtin": "0000ff",
		"important": "0000ff",

		// literals
		"string": lang === "css" ? "0451a5" // CSS values/constants
			: lang === "json" ? "a31515" : "a31515",
		"number": "098658",
		"constant": "0000ff",
		"symbol": "0000ff",
		"char": "a31515",

		// identifiers
		"class-name": lang === "js" || lang === "ts"
			? "267f99"      // types / classes
			: "0451a5",
		"function": "0451a5",
		"variable": "000000",
		"namespace": "000000",
		"property": lang === "css"
			? "e50000"
			: "0451a5",

		// markup / HTML / XML
		"tag": lang === "html" || lang === "xml" ? "800000" : "0000ff",
		"selector": "800000",
		"attr-name": "e50000",
		"attr-value": "a31515",
		"entity": "800000",
		"doctype": "808080",
		"cdata": "808080",
		"prolog": "808080",

		// CSS specific
		"atrule": "0000ff",
		"url": "0451a5",

		// regex
		"regex": "811f3f",
	} as any;

	// const themeColors = {
	// 	"atrule": "07a07a",
	// 	"attr-name": "690690",
	// 	"attr-value": "07a07a",
	// 	"boolean": "905905",
	// 	"builtin": "690690",
	// 	"cdata": "708090",
	// 	"char": "690690",
	// 	"class-name": "dd4a68",
	// 	"comment": "708090",
	// 	"constant": "905905",
	// 	"doctype": "708090",
	// 	"entity": "9a6e3a",
	// 	"function": "dd4a68",
	// 	"important": "e90e90",
	// 	"keyword": "07a07a",
	// 	"namespace": "484848",
	// 	"number": "905905",
	// 	"operator": "9a6e3a",
	// 	"prolog": "708090",
	// 	"property": "905905",
	// 	"punctuation": "999999",
	// 	"regex": "e90e90",
	// 	"selector": "690690",
	// 	"string": lang == "css" ? "9a6e3a" : "690690",
	// 	"symbol": "905905",
	// 	"tag": "905905",
	// 	"url": "9a6e3a",
	// 	"variable": "e90e90",
	// 	"plain": "000000"
	// } as any;

	const tokens = Prism.tokenize(code, grammar);
	return tokensToParagraphs(tokens);

	function tokensToParagraphs(tokens: (string | Prism.Token)[])
	{
		const paragraphs: Paragraph[] = [];
		let currentRuns: ParagraphChild[] = [];

		function addText(text: string, type: string)
		{
			const lines = text.split("\n");

			lines.forEach((line, index) =>
			{
				currentRuns.push(
					new TextRun({
						text: line,
						color: themeColors[type] || themeColors["plain"],
						bold: type === "bold",
						italics: type === "italic",
					})
				);

				if (index < lines.length - 1)
				{
					paragraphs.push(new Paragraph({ children: currentRuns, style: STYLE_code }));
					currentRuns = [];
				}
			});
		}

		function process(token: string | Prism.Token, parentType = "plain")
		{
			if (typeof token === "string")
				addText(token, parentType);
			else if (Array.isArray(token.content))
				token.content.forEach(t => process(t, token.type));
			else if (typeof token.content === "string")
				addText(token.content, token.type);
			else
				process(token.content, token.type);
		}

		tokens.forEach(t => process(t));

		if (currentRuns.length > 0)
		{
			paragraphs.push(new Paragraph({ children: currentRuns, style: STYLE_code }));
		}

		return paragraphs;
	}

}

function genXml_app({ totalTime }: { totalTime?: number })
{
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<TotalTime>${totalTime || randomInt(30, 120)}</TotalTime>
</Properties>
	`;
}
function genXml_core({ title, creator, createdAt, modifiedAt }: { title?: string, creator?: string, createdAt?: Date, modifiedAt?: Date })
{
	if (!createdAt) createdAt = new Date();
	if (!modifiedAt) modifiedAt = new Date();
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${title || "Document"}</dc:title>
<dc:creator>${creator || "Student"}</dc:creator>
<cp:lastModifiedBy>${creator || "Student"}</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${createdAt.toISOString()}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${modifiedAt.toISOString()}</dcterms:modified>
</cp:coreProperties>`;
}