import * as fs from "fs";
import { AlignmentType, Document, Footer, convertMillimetersToTwip, Packer, PageBreak, PageNumber, Paragraph, TableOfContents, TextRun, type FileChild, type ISectionOptions, type INumberingOptions, LevelFormat, type ParagraphChild, Table, TableRow, TableCell, ImageRun } from "docx";
import type { Doc, DocNode, NodeList } from "./doc";
import type { DeepWriteable } from "./utils";
import { imageSize } from 'image-size';
import path from "path";

const STYLE_list = "aff0";
const STYLE_code_title = "afe";
const STYLE_code = "af6";

type IListItem = DeepWriteable<INumberingOptions>["config"][number];
type IListItemLevel = IListItem["levels"][number]
export async function serializeDocx(doc: Doc, fout: string, workdir: string, assets: string)
{
	const getPath = (fname: string) => path.join(workdir, fname);
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
		})

		function renderNode(node: DocNode, prevChild?: FileChild): FileChild | FileChild[]
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
					renderList(node);
					function renderList(node: NodeList, level: number = 0)
					{
						addListItemLevel(list.levels, level, !!node.ordered, !!node.alternativeStyle);
						for (const item of node.items)
						{
							if (item.type == "list") renderList({ ...item, alternativeStyle: !!node.alternativeStyle }, level + 1);
							else
								items.push(new Paragraph({
									children: renderText(item.text),
									style: STYLE_list,
									numbering: { reference: id, level }
								}));
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
							rows: node.rows.map((row, rowI) => new TableRow({
								tableHeader: rowI == 0,
								children: row.map(item => new TableCell({
									children: item.type != "text" ? renderNodeL(item) : [
										new Paragraph({
											children: [new TextRun({
												text: item.text,
												...(node.normalFontSize ? {} : { size: 24 }),
											})],
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
					const data = fs.readFileSync(getPath(node.src));
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
							keepNext: true,
							children: [
								new ImageRun({
									type: type as any,
									data,
									transformation: { width, height },
								}),
							],
						}),
						new Paragraph({
							children: renderText(node.text),
							alignment: "center",
							indent: { firstLine: 0 },
							spacing: { line: 240 }
						}),
					];
				case "code":
					return [
						new Paragraph({
							children: renderText(node.name),
							style: STYLE_code_title,
						}),
						...node.text.split("\n").map(p =>
							new Paragraph({
								children: [new TextRun(p)],
								style: STYLE_code,
							})
						),
					];
				case "externalDoc":
					return new Paragraph({
						text: `!!(${getPath(node.path)})${JSON.stringify(node.dict)}`,
						indent: { firstLine: 0 },
						alignment: "left",
					});
				default:
					throw new Error("switch default");
			}
		}
		function renderNodeL(node: DocNode, prevChild?: FileChild)
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
		features: { updateFields: true },
		numbering: { config: numbering },
	});
	const buffer = await Packer.toBuffer(docx);
	fs.writeFileSync(fout, buffer);
}

function addListItemLevel(levels: IListItemLevel[], level: number, ordered: boolean, alternativeStyle: boolean)
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

function renderText(text: string): ParagraphChild[]
{
	return text.split("\n").map((p, i) => new TextRun({
		text: p.replaceAll(" - ", " \u2013 ").replaceAll(/\s+/g, " "),
		language: { value: "ru-RU" },
		...(i == 0 ? {} : { break: 1 }),
	}));
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