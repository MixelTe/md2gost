import * as fs from "fs";
import { AlignmentType, BorderStyle, Document, Footer, Header, convertMillimetersToTwip, Packer, PageBreak, PageNumber, Paragraph, TableOfContents, TextRun, type FileChild, type ISectionOptions, type INumberingOptions, LevelFormat, type ParagraphChild, Table, TableRow, TableCell, ImageRun, ExternalHyperlink, InternalHyperlink, Bookmark, XmlComponent, LineRuleType, PageOrientation, VerticalAlignTable } from "docx";
import type { AdmonitionType, DocHeaderFooter, DocPageOrientation, NodeList, NodeListMark, NodeTable, Rune, RunicDoc, RunicNode, Runify } from "./doc";
import { getSafePathResolver, randomInt, type DeepWriteable } from "./utils";
import { imageSize } from "image-size";
import path from "path";
import { latexToOmml } from "./math";

const STYLE_list = "afc";
const STYLE_table_title = "TableCaption";
const STYLE_code_title = "ListingCaption";
const STYLE_code = "ListingCode";

type IListItem = DeepWriteable<INumberingOptions>["config"][number];
type IListItemLevel = IListItem["levels"][number];
export async function serializeDocx(doc: RunicDoc, fout: string, workdir: string, assets: string, checkFilesIsInsidePath: string | false, logwarn: (msg: string) => void = console.warn)
{
	const { resolvePath: getPath } = getSafePathResolver(workdir, checkFilesIsInsidePath);
	const sections: ISectionOptions[] = [];
	const numbering: DeepWriteable<INumberingOptions>["config"] = [];

	interface Section {
		displayPageNum: boolean;
		orientation: DocPageOrientation;
		pageStart: number | null;
		header: Runify<DocHeaderFooter>;
		footer: Runify<DocHeaderFooter>;
		nodes: RunicNode[];
	}
	const docSections = (function splitSections()
	{
		let header = doc.header;
		let footer = doc.footer;
		const sections: Section[] = [{ displayPageNum: true, orientation: "portrait", pageStart: 1, header, footer, nodes: [] }];
		for (let j = 0; j < doc.nodes.length; j++)
		{
			const node = doc.nodes[j]!;
			if (node.type == "sectionBreak")
			{
				header = node.header ?? header;
				footer = node.footer ?? footer;
				sections.push({
					displayPageNum: node.pageStart == null
						? sections.at(-1)?.displayPageNum ?? true
						: node.pageStart >= 0,
					orientation: node.orientation || sections.at(-1)?.orientation || "portrait",
					pageStart: node.pageStart,
					header,
					footer,
					nodes: [],
				});
			}
			else
				sections.at(-1)?.nodes.push(node);
		}
		return sections.filter(s => s.nodes.length > 0);
	})();

	for (const section of docSections)
	{
		const children: FileChild[] = [];
		const header = renderHeaderFooter(section.header, false);
		const footer = renderHeaderFooter(section.footer, true);
		sections.push({
			children,
			properties: {
				page: {
					// size: section.orientation == "landscape" ? {
					// 	orientation: PageOrientation.LANDSCAPE,
					// 	width: convertMillimetersToTwip(297),
					// 	height: convertMillimetersToTwip(210),
					// } : {
					// 	orientation: PageOrientation.PORTRAIT,
					// 	width: convertMillimetersToTwip(210),
					// 	height: convertMillimetersToTwip(297),
					// },
					size: {
						orientation: section.orientation == "landscape" ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
					},
					pageNumbers: !section.pageStart ? {} : {
						start: section.pageStart,
					},
					margin: {
						top: convertMillimetersToTwip(20),
						left: convertMillimetersToTwip(30),
						right: convertMillimetersToTwip(15),
						bottom: convertMillimetersToTwip(20),
					},
				},
			},
			...(header ? { headers: { default: header as Header } } : {}),
			...(footer ? { footers: { default: footer as Footer } } : {}),
		});

		function renderHeaderFooter(value: Runify<DocHeaderFooter>, isFooter: boolean): Header | Footer | undefined
		{
			if (value.type == "none") return undefined;
			if (value.type == "auto")
			{
				if (!isFooter) return undefined;
				return new Footer({
					children: [new Paragraph({
						alignment: AlignmentType.CENTER,
						children: [new TextRun({ children: section.displayPageNum ? [PageNumber.CURRENT] : [] })],
						indent: { firstLine: 0 },
						spacing: { after: 0, line: 240 },
					})],
				});
			}
			const contentValue = value as Runify<Extract<DocHeaderFooter, { type: "content" }>>;
			const content = contentValue.nodes.flatMap(node =>
			{
				if (node.type == "text") return [new Paragraph({
					children: renderText(node.text, node.sourceLine),
					alignment: contentValue.align,
					indent: { firstLine: 0 },
					spacing: isFooter ? { after: 0, line: 240 } : { line: 240 },
				})];
				return [renderHeaderFooterTable(node)];
			});
			return isFooter ? new Footer({ children: content }) : new Header({ children: content });
		}
		function renderHeaderFooterTable(node: Runify<NodeTable>): Table
		{
			return new Table({
				width: { type: "dxa", size: convertMillimetersToTwip(section.orientation == "landscape" ? 255.8 : 168.8) },
				borders: {
					top: { style: BorderStyle.SINGLE, size: 4, color: "808080" },
					bottom: { style: BorderStyle.SINGLE, size: 4, color: "808080" },
					left: { style: BorderStyle.SINGLE, size: 4, color: "808080" },
					right: { style: BorderStyle.SINGLE, size: 4, color: "808080" },
					insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "808080" },
					insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "808080" },
				},
				rows: node.rows.map(row => new TableRow({
					children: row.map((cell, colI) => new TableCell({
						children: cell.type == "text" ? [new Paragraph({
							children: renderText(cell.text, node.sourceLine),
							alignment: node.align[colI] == "c" ? "center" : node.align[colI] == "r" ? "right" : "left",
							indent: { firstLine: 0 },
							spacing: { after: 0, line: 240 * 1.25 },
						})] : [],
					})),
				})),
			});
		}

		function renderNode(node: RunicNode, prevChild?: FileChild, prevNode?: RunicNode): FileChild | FileChild[]
		{
			switch (node.type)
			{
				case "text":
					return new Paragraph({
						children: renderText(node.text, node.sourceLine),
						indent: node.noIndent ? { firstLine: 0 } : {},
						...(node.center ? { alignment: "center", indent: { firstLine: 0 } } : {}),
						spacing: {
							...(node.noMargin ? { after: 0 } : {}),
							...(prevChild instanceof Table ? { before: (doc.table.spacing.after ?? doc.text.spacing.after) * 20 } : {}),
						},
					});
				case "title":
					if (node.level < 0 || node.level > 6) throw new Error("Wrong heading level");
					const level = (node.level == 0 ? 1 : node.level) as 1 | 2 | 3 | 4 | 5 | 6;
					const styles = doc.headings[`h${level}`];
					if (styles.uppercase) node.text.forEach(r => r.text = r.text.toUpperCase());
					return new Paragraph({
						children: renderText(node.text, node.sourceLine, styles.size),
						style: `${node.level}`,
						...(node.center ? { alignment: "center", indent: { firstLine: 0 } } : {}),
						...(!node.center && node.level != 0 && styles.indent_full ? { indent: { firstLine: 0, left: convertMillimetersToTwip(12.5) } } : {}),
						spacing: {
							before: styles.spacing.before * 20,
							after: styles.spacing.after * 20,
						},
					});
				case "pageBreak":
					if (!(prevChild instanceof Paragraph))
						return new Paragraph({ children: [new PageBreak()] });
					prevChild.addChildElement(new PageBreak());
					return [];
				case "list":
					if (node.items.length == 0) return [];
					const id = `l${numbering.length + 1}`;
					const list: IListItem = {
						reference: id,
						levels: [],
					};
					numbering.push(list);
					const items: FileChild[] = [];
					let addMargin = prevChild instanceof Table;
					renderList(node);
					function renderList(node: Runify<NodeList>, level: number = 0)
					{
						let mark = node.mark;
						if (node.ordered) mark = doc.list.ordered.style == "keep" ? mark : doc.list.ordered.style == "dot" ? "." : ")";
						else mark = doc.list.unordered.style == "keep" ? mark : doc.list.unordered.style == "bullet" ? "*" : "-";
						addListItemLevel(list.levels, level, node.startIndex, node.items.length, !!node.ordered, !!node.alternativeStyle, mark);
						for (const item of node.items)
						{
							if (item.type == "list") renderList({ ...item, alternativeStyle: !!node.alternativeStyle }, level + 1);
							else
							{
								items.push(new Paragraph({
									children: renderText(item.text, item.sourceLine ?? node.sourceLine),
									style: STYLE_list,
									numbering: { reference: id, level },
									spacing: {
										...(addMargin ? { before: (doc.table.spacing.after ?? doc.text.spacing.after) * 20 } : {}),
									},
								}));
								addMargin = false;
							}
						}
					}
					return items;
				case "table":
					if (node.header !== false && node.rows[0] && doc.table.heading.style == "italic") node.rows[0].forEach(n => n.type == "text" ? n.text.forEach(r => r.italic = true) : 0);
					if (node.header !== false && node.rows[0] && doc.table.heading.style == "bold") node.rows[0].forEach(n => n.type == "text" ? n.text.forEach(r => r.bold = true) : 0);
					const spacingInner = Math.max(doc.table.spacing.after ?? doc.text.spacing.after, doc.table.spacing.before ?? 0);
					return [
						...(node.title ? [
							new Paragraph({
								children: renderText(node.title, node.sourceLine, doc.table.title.size),
								style: STYLE_table_title,
								...(prevChild instanceof Table ? { spacing: { before: spacingInner * 20 } } :
									doc.table.spacing.before ? { spacing: { before: doc.table.spacing.before * 20 } } : {}
								),
							}),
						] : prevChild instanceof Table ? [
							new Paragraph({ spacing: { line: 20, before: spacingInner * 20, after: 0 } }),
						] : doc.table.spacing.before ? [
							new Paragraph({ spacing: { line: 20, before: doc.table.spacing.before * 20, after: 0 } }),
						] : []),
						new Table({
							// width: { type: "pct", size: 100 },
							width: {
								type: "dxa",
								size: convertMillimetersToTwip(section.orientation === "landscape" ? 255.8 : 168.8),
							},
							rows: node.rows.map((row, rowI) => new TableRow({
								tableHeader: node.header !== false && rowI == 0,
								cantSplit: true,
								children: row.map((item, colI) => new TableCell({
									children: item.type != "text" ? renderNodeL(item) : [
										new Paragraph({
											children: renderText(item.text, node.sourceLine, node.normalFontSize ? undefined : doc.table.text.size),
											alignment: node.header !== false && rowI == 0 ? doc.table.heading.align :
												node.align[colI] == "c" ? "center"
													: node.align[colI] == "r" ? "right" : "left",
											indent: { firstLine: 0 },
											spacing: { after: 0, line: 240 * doc.table.text.line_spacing },
										}),
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
						new Paragraph({ children: [new PageBreak()] }),
					];
				case "image":
					const type = (node.src.split(".").at(-1) || "").toLowerCase();
					if (!["jpg", "png", "gif", "bmp", "svg"].includes(type))
						throw new UserInputError(`Unsupported image format: "${type}", file: ${node.src}`);
					const img_path = getPath(node.src);
					if (!fs.existsSync(img_path))
						throw new UserInputError(`File not exist: ${node.src}`);
					const data = fs.readFileSync(img_path);
					const dimensions = imageSize(data);
					const [MaxW, MaxH] = (section.orientation == "landscape" ? [950, 600] : [600, 900]);
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
							spacing: {
								line: 240,
								lineRule: LineRuleType.AT_LEAST, // For LibreOffice to not shrink image
								...(!node.text && doc.img.spacing.after !== undefined ? { after: doc.img.spacing.after * 20 } : {}),
								...(doc.img.spacing.before !== undefined ? { before: doc.img.spacing.before * 20 } : {}),
							},
							keepNext: !!node.text,
							children: [
								new ImageRun({
									type: type as any,
									data,
									transformation: { width, height },
									...(type == "svg" ? { fallback: { data: "", type: "png" } } : {}),
								}),
							],
						}),
						...(node.text ? [
							new Paragraph({
								children: renderText(node.text, node.sourceLine, doc.img.text.size),
								alignment: "center",
								indent: { firstLine: 0 },
								spacing: {
									line: 240,
									...(doc.img.spacing.after !== undefined ? { after: doc.img.spacing.after * 20 } : {}),
								},
							}),
						] : []),
					];
				case "code":
					const code = doc.code.highlight && renderCodeHighlighting(node.code, node.lang);
					return [
						...(node.title ? [
							new Paragraph({
								children: renderText(node.title, node.sourceLine, doc.code.title.size),
								style: STYLE_code_title,
							}),
						] : prevNode?.type == "code" ? [
							new Paragraph({ spacing: { line: 20 } }),
						] : []),
						...(code ? code :
							node.code.split("\n").map((p, i) =>
								new Paragraph({
									children: [new TextRun(p)],
									style: STYLE_code,
									...(i == 0 && !node.title && doc.code.spacing.before && prevNode?.type != "code" ? { spacing: { before: doc.code.spacing.before * 20 } } : {}),
								}))
						),
					];
				case "math":
					const formulaWidth = convertMillimetersToTwip(section.orientation == "landscape" ? 255.8 : 168.8);
					const number = node.title?.map(rune => rune.text).join("") || "";
					const sideWidth = Math.max(
						convertMillimetersToTwip(5),
						Math.ceil(estimateNumberWidthPt(number, doc.text.size) * 20 + convertMillimetersToTwip(3)),
					);
					return [
						...(prevNode?.type != "math" ? [
							new Paragraph({ indent: { firstLine: 0 }, spacing: { line: 20, after: doc.formula.spacing.before * 20 } }),
						] : []),
						new Table({
							width: { type: "dxa", size: formulaWidth },
							borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
							rows: [new TableRow({
								children: [
									new TableCell({ width: { type: "dxa", size: sideWidth }, children: [new Paragraph({ indent: { firstLine: 0 }, spacing: { after: 0 } })] }),
									new TableCell({ children: [
										new Paragraph({ alignment: AlignmentType.CENTER, indent: { firstLine: 0 }, spacing: { after: 0 }, children: [renderMath(node.latex, true, node.sourceLine)] })],
									}),
									new TableCell({ width: { type: "dxa", size: sideWidth }, children: [new Paragraph({ indent: { firstLine: 0 }, spacing: { line: 240, after: 0 },
										alignment: AlignmentType.RIGHT,
										children: renderText(node.title || [], node.sourceLine),
									})], verticalAlign: VerticalAlignTable.CENTER }),
								],
							})],
						}),
						new Paragraph({ indent: { firstLine: 0 }, spacing: { line: 20, after: doc.formula.spacing.after * 20 } }),
					];
				case "externalDoc":
					const doc_path = getPath(node.path);
					if (!fs.existsSync(doc_path))
						throw new UserInputError(`File not exist: ${node.path}`);
					const ext = path.extname(doc_path);
					if (ext != ".docx" && ext != ".pdf")
						throw new UserInputError(`File not .docx or .pdf: ${node.path}`);
					return new Paragraph({
						text: `!!(${doc_path})${JSON.stringify(node.dict)}`,
						indent: { firstLine: 0 },
						alignment: "left",
					});
				case "admonition":
					const style = `xAdmonition${node.admonitionType == "note" ? "" : node.admonitionType}`;
					const admonition = doc.admonition[node.admonitionType];
					const color = "#" + admonition.color;
					const icon = admonition.icon ? [new ImageRun({
						type: "svg",
						data: Buffer.from(admonitionIcons[node.admonitionType](admonition.title_color ? color : "#000000")),
						transformation: { width: admonition.icon_size, height: admonition.icon_size },
						fallback: {
							data: Buffer.from((admonition.title_color ? admonitionIconsFallback : admonitionIconsFallbackBlack)[node.admonitionType], "base64"),
							type: "png",
						},
					}), new TextRun(" ")] : [];
					const prevIsSameType = prevNode?.type == "admonition" && prevNode.admonitionType == node.admonitionType;
					const showTitle = node.title.map(r => r.text).join("") != "";  // "empty" title with space allows showing only icon
					return [
						...(prevIsSameType ? [
							new Paragraph({ spacing: { line: 20, before: 0, after: 0 } }),
						] : []),
						...(showTitle ? [
							new Paragraph({
								style,
								children: [...icon, ...renderText(admonition.title_color ? node.title.map(r =>  ({ ...r, color })) : node.title, node.sourceLine)],
								keepNext: true,
								...(prevIsSameType ? { spacing: { before: 0 } } : {}),
							}),
						] : []),
						new Paragraph({
							style,
							children: renderText(node.text, node.sourceLine),
							...(prevIsSameType && !showTitle ? { spacing: { before: 0 } } : {}),
						}),
					];
				case "sectionBreak":
					return [];
				default:
					node satisfies never;
					throw new Error("switch default");
			}
		}
		function renderNodeL(node: RunicNode, prevChild?: FileChild, prevNode?: RunicNode)
		{
			try
			{
				const r = renderNode(node, prevChild, prevNode);
				if (r instanceof Array) return r;
				return [r];
			}
			catch (error)
			{
				const message = error instanceof Error ? error.message : String(error);
				if (/^Line -?\d+:/.test(message)) throw error;
				throw new Error(`${node.sourceLine ? `Line ${node.sourceLine}: ` : ""}${message}`, { cause: error });
			}
		}

		for (let i = 0; i < section.nodes.length; i++)
			children.push(...renderNodeL(section.nodes[i], children.at(-1), section.nodes[i - 1]));
	}

	const docx = new Document({
		sections,
		externalStyles: genXml_style(assets, doc),
		// features: { updateFields: true },
		numbering: { config: numbering },
		...(doc.rainbow ? { background: { color: "#000000" } } : {}),
		...(doc.hyphenation ? {
			hyphenation: {
				autoHyphenation: true,
				consecutiveHyphenLimit: 2,
				doNotHyphenateCaps: true,
				hyphenationZone: 360,
			},
		} : {}),
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
			}),
		},
	]);
	fs.writeFileSync(fout, buffer);

	function renderText(text: string | Rune[], sourceLine?: number, size?: number): ParagraphChild[]
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
			if (rune.type == "math") return renderMath(rune.text, false, sourceLine) as ParagraphChild;
			let children: null | (string | XmlComponent)[] = null;
			if (rune.type == "val" && rune.text == "page")
			{
				rune.type = "text";
				children = [PageNumber.CURRENT];
			}
			else if (rune.type == "val" && rune.text == "pages")
			{
				rune.type = "text";
				children = doc.totalPagesOffset == 0 ? [PageNumber.TOTAL_PAGES] : [
					// Complex Formula Field: { = { NUMPAGES } + 1 }
					// Outer field start: "="
					new RawXml("w:fldChar", { "w:fldCharType": "begin" }),
					new RawXml("w:instrText", { "xml:space": "preserve" }, " = "),

					// Inner field start: "NUMPAGES"
					new RawXml("w:fldChar", { "w:fldCharType": "begin" }),
					new RawXml("w:instrText", { "xml:space": "preserve" }, " NUMPAGES "),
					new RawXml("w:fldChar", { "w:fldCharType": "separate" }),
					new RawXml("w:fldChar", { "w:fldCharType": "end" }),

					// Operator
					new RawXml("w:instrText", { "xml:space": "preserve" },
						doc.totalPagesOffset > 0 ? ` + ${doc.totalPagesOffset}` : ` - ${-doc.totalPagesOffset}`,
					),

					// Outer field close
					new RawXml("w:fldChar", { "w:fldCharType": "separate" }),
					new RawXml("w:fldChar", { "w:fldCharType": "end" }),
				];
			}
			return new TextRun({
				...(children ? { children } : { text: rune.text }),
				language: { value: rune.lang == "en" ? "en-US" : "ru-RU" },
				...(rune.linebreak ? { break: 1 } : {}),
				...(rune.bold ? { bold: true } : {}),
				...(rune.italic ? { italics: true } : {}),
				...(link ? { color: "0563c1", underline: { type: "single" } } : {}),
				...(rune.color ? { color: rune.color } : {}),
				...(size && size > 0 ? { size: size * 2 } : {}),
				...(rune.type && rune.type != "text" ? { highlight: "black", color: "ffffff" } : {}),
				...(rune.mono ? (
					doc.backtickMono == "outline" ? { font: "consolas", size: (doc.text.size - 1) * 2, border: { style: "single", space: 2 } }
						: doc.backtickMono == "on" ? { font: "consolas", size: (doc.text.size - 1) * 2 }
							: doc.backtickMono == "italic" ? { italics: true } : {}
				) : {}),
			});
		}
		if (typeof text == "string") text = [{ text }];
		if (text.at(-1)?.text == "" && text.at(-1)?.linebreak) text = text.slice(0, -1);
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
					...src,
					text,
					anchor: first ? src.anchor : undefined,
					linebreak: src.linebreak && first,
					lang: type == 1 ? "en" : type == 2 ? "ru" : undefined,
				};
			}
		}
	}
	function renderMath(latex: string, para: boolean, sourceLine?: number): XmlComponent
	{
		try { return latexToOmml(latex, para); }
		catch (error)
		{
			logwarn(`${sourceLine ? `Line ${doc.mapSourceLine(sourceLine + 1)}: ` : ""}Formula was not converted: ${error instanceof Error ? error.message : String(error)}`);
			return new TextRun(latex) as unknown as XmlComponent;
		}
	}
}

const admonitionIcons: Record<AdmonitionType, (color: string) => string> = {
	note: c => `<svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><style>.a{fill:${c}}</style><path class="a" d="m13 12q0-0.4-0.3-0.7-0.3-0.3-0.7-0.3-0.4 0-0.7 0.3-0.3 0.3-0.3 0.7v4q0 0.4 0.3 0.7 0.3 0.3 0.7 0.3 0.4 0 0.7-0.3 0.3-0.3 0.3-0.7zm-1-2.5c0.3 0 0.6-0.1 0.9-0.4 0.2-0.2 0.3-0.5 0.3-0.8q0-0.6-0.3-0.9c-0.3-0.3-0.6-0.4-0.9-0.4-0.3 0-0.6 0.1-0.9 0.4q-0.3 0.3-0.3 0.9c0 0.3 0.1 0.6 0.3 0.8 0.3 0.3 0.6 0.4 0.9 0.4z"/><path fill-rule="evenodd" class="a" d="m22 12c0 5.5-4.5 10-10 10-5.5 0-10-4.5-10-10 0-5.5 4.5-10 10-10 5.5 0 10 4.5 10 10zm-15.7 5.7c1.5 1.5 3.6 2.3 5.7 2.3 2.1 0 4.2-0.8 5.7-2.3 1.5-1.5 2.3-3.6 2.3-5.7 0-2.1-0.8-4.2-2.3-5.7-1.5-1.5-3.6-2.3-5.7-2.3-2.1 0-4.2 0.8-5.7 2.3-1.5 1.5-2.3 3.6-2.3 5.7 0 2.1 0.8 4.2 2.3 5.7z"/></svg>`,
	info: c => `<svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><style>.a{fill:${c}}</style><path class="a" d="m13 12q0-0.4-0.3-0.7-0.3-0.3-0.7-0.3-0.4 0-0.7 0.3-0.3 0.3-0.3 0.7v4q0 0.4 0.3 0.7 0.3 0.3 0.7 0.3 0.4 0 0.7-0.3 0.3-0.3 0.3-0.7zm-1-2.5c0.3 0 0.6-0.1 0.9-0.4 0.2-0.2 0.3-0.5 0.3-0.8q0-0.6-0.3-0.9c-0.3-0.3-0.6-0.4-0.9-0.4-0.3 0-0.6 0.1-0.9 0.4-0.2 0.2-0.3 0.5-0.3 0.9 0 0.3 0.1 0.6 0.3 0.8 0.3 0.3 0.6 0.4 0.9 0.4z"/><path fill-rule="evenodd" class="a" d="m22 12c0 5.5-4.5 10-10 10-5.5 0-10-4.5-10-10 0-5.5 4.5-10 10-10 5.5 0 10 4.5 10 10zm-15.7 5.7c1.5 1.5 3.6 2.3 5.7 2.3 2.1 0 4.2-0.8 5.7-2.3 1.5-1.5 2.3-3.6 2.3-5.7 0-2.1-0.8-4.2-2.3-5.7-1.5-1.5-3.6-2.3-5.7-2.3-2.1 0-4.2 0.8-5.7 2.3-1.5 1.5-2.3 3.6-2.3 5.7 0 2.1 0.8 4.2 2.3 5.7z"/></svg>`,
	tip: c => `<svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><style>.a{fill:${c}}</style><path class="a" d="m8.1 20c0.2 0.9 0.7 1.6 1.5 2.2 0.7 0.5 1.5 0.8 2.4 0.8 0.9 0 1.7-0.3 2.4-0.8 0.8-0.6 1.3-1.3 1.5-2.2q0.2 0 0.4-0.1 0.1-0.1 0.3-0.2 0.1-0.1 0.2-0.3 0.1-0.2 0.1-0.4v-2.5q0.8-0.6 1.5-1.3 0.7-0.8 1.1-1.7 0.5-0.9 0.8-1.9 0.2-1 0.2-2.1c0-4.7-3.8-8.5-8.5-8.5-4.7 0-8.5 3.8-8.5 8.5q0 1.1 0.2 2.1 0.3 1 0.8 1.9 0.4 0.9 1.1 1.7 0.7 0.7 1.5 1.3v2.5q0 0.2 0.1 0.4 0.1 0.2 0.2 0.3 0.2 0.1 0.3 0.2 0.2 0.1 0.4 0.1zm6.8-3v1h-5.8v-1zm-1.1 3q-0.3 0.5-0.7 0.7-0.5 0.3-1 0.3-0.6 0-1-0.3-0.5-0.2-0.8-0.7zm-1.7-17c3.6 0 6.5 2.9 6.5 6.5q0 0.8-0.2 1.6-0.2 0.8-0.6 1.5-0.4 0.8-0.9 1.4-0.5 0.6-1.2 1h-7.2q-0.6-0.4-1.2-1-0.5-0.6-0.9-1.4-0.4-0.7-0.6-1.5-0.2-0.8-0.2-1.6c0-3.6 2.9-6.5 6.5-6.5z"/></svg>`,
	warning: c => `<svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><style>.a{fill:${c}}</style><path class="a" d="m9.4 4.3c1.2-1.9 4-1.9 5.2 0l7.4 12.1c1.2 2-0.2 4.6-2.6 4.6h-14.8c-2.4 0-3.8-2.6-2.6-4.6zm3.4 1.1c-0.4-0.7-1.3-0.7-1.7 0l-7.4 12.1c-0.4 0.7 0.1 1.6 0.8 1.6h14.9c0.8 0 1.3-0.9 0.9-1.6zm-0.9 3.7c0.6 0 1 0.5 1 1v3c0 0.6-0.4 1-1 1-0.6 0-1-0.4-1-1v-3c0-0.5 0.4-1 1-1zm-1.1 7.5c0-0.6 0.5-1.1 1.1-1.1 0.6 0 1.2 0.5 1.2 1.1 0 0.7-0.6 1.2-1.2 1.2-0.6 0-1.1-0.5-1.1-1.2z"/></svg>`,
	danger: c => `<svg version="1.2" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><style>.a{fill:${c}}.b{fill:none;stroke:${c};stroke-linecap:round;stroke-linejoin:round;stroke-width:2}</style><path class="a" d="m12 14.5c-0.3 0-0.6 0.1-0.9 0.4-0.2 0.2-0.3 0.5-0.3 0.8q0 0.6 0.3 0.9c0.3 0.3 0.6 0.4 0.9 0.4 0.3 0 0.6-0.1 0.9-0.4q0.3-0.3 0.3-0.9c0-0.3-0.1-0.6-0.3-0.8-0.3-0.3-0.6-0.4-0.9-0.4z"/><path fill-rule="evenodd" class="b" d="m12 8v4"/><path class="b" d="m15.3 2q0.2 0 0.4 0 0.2 0.1 0.4 0.2 0.2 0 0.3 0.1 0.2 0.1 0.3 0.3l4.7 4.7q0.2 0.1 0.3 0.3 0.1 0.1 0.1 0.3 0.1 0.2 0.2 0.4 0 0.2 0 0.4v6.6q0 0.2 0 0.4-0.1 0.2-0.2 0.4 0 0.2-0.1 0.3-0.1 0.2-0.3 0.3l-4.7 4.7q-0.1 0.2-0.3 0.3-0.1 0.1-0.3 0.1-0.2 0.1-0.4 0.2-0.2 0-0.4 0h-6.6q-0.2 0-0.4 0-0.2-0.1-0.4-0.2-0.2 0-0.3-0.1-0.2-0.1-0.3-0.3l-4.7-4.7q-0.2-0.1-0.3-0.3-0.1-0.1-0.1-0.3-0.1-0.2-0.2-0.4 0-0.2 0-0.4v-6.6q0-0.2 0-0.4 0.1-0.2 0.2-0.4 0-0.2 0.1-0.3 0.1-0.2 0.3-0.3l4.7-4.7q0.1-0.2 0.3-0.3 0.1-0.1 0.3-0.1 0.2-0.1 0.4-0.2 0.2 0 0.4 0z"/></svg>`,
};
const admonitionIconsFallback: Record<AdmonitionType, string> = {
	note: `iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAilBMVEUAAABmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmbNZZ8EAAAALnRSTlMA//BXB/7YePSoRaAMKt3USM91y08CZiK8tUzjLxM82zjGblsPPSRhBkJzadIoQt+BPAAAAMBJREFUeJydUVcOwjAUi9Mm3YsOoLRlb7j/9RDJK22EEAL/OLKd5A3G/oVtBbnLs8CyTd2PQYj9se4IzKuubffVDMIZ6eBpfy44Xk4q3GhIRa6gVLiApThJ1M9bSF2BhUTxAZg+uZQ6yDxc9dVupfkCT7HUwQENpGIOauqWad6BkxFqAaBqyJCITKOhpzxsTGNCn/fl9ka5pHJtapDla0XHvkFWC343RnL+NkQ99vrEmF2YY/+8KLXajLv522p/wANc8QfHdtgFgwAAAABJRU5ErkJggg==`,
	info: `iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAilBMVEUAAAAZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtIZdtL9UeA9AAAALnRSTlMA//BXB/7YePSoRaAMKt3USM91y08CZiK8tUzjLxM82zjGblsPPSRhBkJzadIoQt+BPAAAAMBJREFUeJydUVcOwjAUi9Mm3YsOoLRlb7j/9RDJK22EEAL/OLKd5A3G/oVtBbnLs8CyTd2PQYj9se4IzKuubffVDMIZ6eBpfy44Xk4q3GhIRa6gVLiApThJ1M9bSF2BhUTxAZg+uZQ6yDxc9dVupfkCT7HUwQENpGIOauqWad6BkxFqAaBqyJCITKOhpzxsTGNCn/fl9ka5pHJtapDla0XHvkFWC343RnL+NkQ99vrEmF2YY/+8KLXajLv522p/wANc8QfHdtgFgwAAAABJRU5ErkJggg==`,
	tip: `iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAllBMVEUAAAAufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTIufTLBWjFSAAAAMnRSTlMA//AF9MXq5ssCgtub1XmmJgghfRkRC+exGm0tRBX+i2c1Tt8pMHC0RwxdtsOoo64eS7UJBqAAAADPSURBVHichVLZEoIwENtU7luUUwUB79v//zkHpKWiM+Ypk+x2szsl+ofAUhlTrWAkR7cCHQonlvWwASvrR7Sc6XBXgx67sOc9vcCYCGMmdKKjijXnE4Z6aF+g4fQJ3ZQGGtj2bIernKTESYxwZCOHJzpS2bCQ9+wANiQkUrHkqbQhIVEFTUTxoEWcm4YYQTS1YWQ99eFK71bK+4QtFL5Fh1A4SijrRAm6a2XQP3VKeMfYOHPjY9cWKfarqYP7WKcFa+vZ5sugja8l/vgv/MALHToJTMdMgakAAAAASUVORK5CYII=`,
	warning: `iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAllBMVEUAAACyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagCyagD2Sl3HAAAAMnRSTlMA/w3r5vwbWbsElS1drcsiElT5ArX2wo045GaR779hCUx02KB7BdPiPyiCaxZSMsa5W/G4KzAAAADCSURBVHictZDJEoJADES7GZBFdlABFdz39f9/zmIoCge9WeaS5HVNkmngD6F5pKd9EeYkaX3yJ+NDRJofgwQ3gEO9P2zKlQ1oOicqHxrM6hzROCrCnWvYuQekHL/zkrMQA+rAYES346FggUbAkqLb79BHK9g7Tlt+ozEEUIlH3WVk3QFIfPXG5j2AgvtKFudr81edpcwzLiQIGG9lETX73da55NQeOpeWmUx79tiWFC6i9luNPJSzx7GKYyvom/9TvACzaQfmlOkXxAAAAABJRU5ErkJggg==`,
	danger: `iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAdVBMVEUAAADTLy+/ICDSLi7SLi7GHBzPKSnSLy/SLi7MGhrTLy/TLy/SLy/RLi7SLy/SLi7TLi7KLCzRLi7SLi7KKyvTLi7TLy/EJyfTLi6/KyvTLy/TLy/SLi7TLy/MKSnMKyvTLy/SLy/TLi7OJyfSLi7TLy/TLy/z9/9QAAAAJ3RSTlMA/wi9wgklCyEK7L/UFuXA4B0c6Rj+Vg2zDMXc2LkZHre0lhqmySRpaHOvAAAAtElEQVR4nKVRRxLDIBBbGdx77yX1/0/M2EBMHE8u0QWtBCwriH6juECiKXQ9DJQOBOGuzz1YK2jLMNyU7kRghioMhmQW1Mo1ncjgiKyVTB5iTSdyObz1BdeSu0LxfbHaXXknIqCWWwFJ6o29yyPDH4Yvm38ZO/BpVNXBkOM9AUcwczNGyAHtcbEF4WiIKPUQm8dI0vMQ8y3Ek9hlK6I0wSJvMxn6bD8+DedfS5Q9lN5p+0/xArzsBn7bxA9sAAAAAElFTkSuQmCC`,
};
const admonitionIconsFallbackBlack: Record<AdmonitionType, string> = {
	note: `iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAilBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATAggvAAAALnRSTlMA//AHeFjY9N2gDCpEqM3TSToi47XVR9D9Zky8L3RWPRNPxm4CUFsPJGFpKAbKjdKbTAAAAMRJREFUeJydUdkSgjAM7BbKfYjKKQp4n///e860AdpxfNC8bGY3bZINY/+GJfzE5aUvLJOPPFB4kc7bwLru+r6rN4Ct83wx5ic+K0XlhnNV6FZUFaywk5insvMZjppAIJd4BZYycSAkxrirp1mmcIuYClThFC0ciRy0VJoovICTECgCoGlIcBCaQktfxTiYwthcIDWEo0fjWrQge+0l3MYFWQP+0C3BZLBu4qCZqGxvnoxZg2k7Y8WXQ8nTltxNPk77Q7wBVQsHvaZMK8YAAAAASUVORK5CYII=`,
	info: `iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAilBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAATAggvAAAALnRSTlMA//AHeFjY9N2gDCpEqM3TSToi47XVR9D9Zky8L3RWPRNPxm4CUFsPJGFpKAbKjdKbTAAAAMRJREFUeJydUdkSgjAM7BbKfYjKKQp4n///e860AdpxfNC8bGY3bZINY/+GJfzE5aUvLJOPPFB4kc7bwLru+r6rN4Ct83wx5ic+K0XlhnNV6FZUFaywk5insvMZjppAIJd4BZYycSAkxrirp1mmcIuYClThFC0ciRy0VJoovICTECgCoGlIcBCaQktfxTiYwthcIDWEo0fjWrQge+0l3MYFWQP+0C3BZLBu4qCZqGxvnoxZg2k7Y8WXQ8nTltxNPk77Q7wBVQsHvaZMK8YAAAAASUVORK5CYII=`,
	tip: `iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAh1BMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD3YishAAAALXRSTlMA/+gFxBrmCvAH9EXbmyd9sC+kedXxTckiEW3ryx8VZ4s1gt8rqHC1XQyDshgZvchdAAAAyUlEQVR4nIWS5w7CMAyEfR20dO/SSSdlvf/zIaokDQWJ+3XyZ8dDIfonb9BMUxu8XbiIwOQacrwZkXZZU9j+AUm7xY0EzpNZDbkqgA9H5/6W48y9aiLbyieM3GY4yA1rhMxdMMugw1W0cGVQIhYVgQzuKJmzYW4TEmmw+VTVNiFRD0WkxVAKAXLRgujooGYbHmck0ru9xW8IWHyLVSdBrJMcJ1KwvqV/HmEFTHuwcPDYAQqwtIb7eYNVYfrOT6cvQF5UKdH+L/zQCzA0CJnLbfrbAAAAAElFTkSuQmCC`,
	warning: `iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAllBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA6C80qAAAAMnRSTlMA/w3mA/xUu1kb610AyyKtEi35lbXvwvZhv2aPCTnYixagayh7TDKSBeLTdII/xrk2W23LF/kAAADFSURBVHictZDJcsIwEET7WbINosDGLGELS8Kanf//OUpyucAmN4q+jOZ1aUZq6QmKMsiif4wpQHrPzxTfCbTuBjm20gDTHDZnaaXIMK/zfsyrrwnxe834YSNrMmnI+JZPGOVqY6T2C50rzx0zlYY+cdf9A7qqDPvBoeJ74r6khfv13R/4zqvL6nZheV/SjNMiHN6S8q+GSagjdgH0KI7hkJT7O1Vy9qt66DRE1mLYiMemwVg7n3ddJg+zx0UdF2mvGf5DugCExweZt6hkrgAAAABJRU5ErkJggg==`,
	danger: `iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAMAAADXqc3KAAAAYFBMVEUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD6T+iNAAAAIHRSTlMA/wi9Cr8lwgwY7Bwhw7cW29Tl4OkdVh6z/bmWpsXXyQwvE4cAAACqSURBVHicpVFHEsIwEJPiFKeRXgjt/79ksNfEBA8XdNJKnpFXC/xGvlKw5r7edE4nu2bXl5ZKW6oV29LpVU8VuSFSHBZL09HTgahmn5rcgomnA3HG4vWDC7PYKkkizu18BUBKLkgh2rD3eGT8w0gk/MvYwU9jng+GrJeSlSxvjM0tqLeTJXHGFcAUqmQKlziaEgO1SxQwDTyJE/mHAvJ7+LRA+XB67b0P4gn4WAUqr4Oj0wAAAABJRU5ErkJggg==`,
};

function addListItemLevel(levels: IListItemLevel[], level: number, startIndex: number, itemCount: number, ordered: boolean, alternativeStyle: boolean, mark: NodeListMark)
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
	const longList = startIndex + itemCount > 10;
	const left = alternativeStyle ? 0 : longList ? 20.5 : 17.5;
	const text = ordered ?
		(alternativeStyle ? `%${level + 1}.` :
			mark == "." ? `%${level + 1}.` : `%${level + 1})`) :
		// mark == "*" ? "\u2022" : "\u2012";
		mark == "*" ? "\u00B7" : "\u2012";
	levels.push({
		level,
		format,
		start: startIndex,
		text,
		style: {
			...(text == "\u00B7" ? {
				run: {
					font: { name: "Symbol" },
				},
			} : {}),
			paragraph: {
				indent: {
					left: convertMillimetersToTwip(left + 5 * indent),
					hanging: convertMillimetersToTwip(longList && !alternativeStyle ? 8 : 5),
					...(alternativeStyle ? { firstLine: convertMillimetersToTwip(12.5) } : {}),
				},
			},
		},
	});
}

class RawXml extends XmlComponent
{
	constructor(tag: string, attributes = {}, text: string | null = null)
	{
		super(tag);
		if (Object.keys(attributes).length > 0)
			this.root.push({ _attr: attributes });
		if (text)
			this.root.push(text);
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
import "prismjs/components/prism-clike.js";

import "prismjs/components/prism-markup.js"; // html, xml
import "prismjs/components/prism-css.js";
import "prismjs/components/prism-javascript.js";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-jsx.js";
import "prismjs/components/prism-tsx.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-powershell.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-java.js";
import "prismjs/components/prism-c.js";
import "prismjs/components/prism-cpp.js";
import "prismjs/components/prism-csharp.js";
import "prismjs/components/prism-go.js";
import "prismjs/components/prism-rust.js";
import "prismjs/components/prism-php.js";
import "prismjs/components/prism-ruby.js";
import "prismjs/components/prism-swift.js";
import "prismjs/components/prism-kotlin.js";
import "prismjs/components/prism-sql.js";
import "prismjs/components/prism-yaml.js";
import "prismjs/components/prism-markdown.js";
import "prismjs/components/prism-docker.js";
import "prismjs/components/prism-nginx.js";
import { UserInputError } from "./errors";


function renderCodeHighlighting(code: string, lang: string)
{
	const language = lang.trim().toLowerCase();
	const grammar = Prism.languages[language];
	if (!grammar) return null;

	const themeColors: Record<string, string> = {
		// shared
		"plain": "000000",
		"comment": "008000",
		"hashbang": "008000",
		"shebang": "008000",
		"punctuation": "000000",
		"operator": "000000",
		"script": "000000",
		"script-punctuation": "000000",
		"expression": "000000",
		"interpolation": "000000",

		// keywords & control flow
		"keyword": "0000ff",
		"control-flow": "af00db",
		"boolean": "0000ff",
		"null": "0000ff",
		"builtin": "267f99",
		"important": "0000ff",
		// "instruction": "0000ff",
		// "directive": "0000ff",
		"directive-hash": "0000ff",
		"macro": "0000ff",
		"macro-name": "0000ff",
		"rule": "0000ff",

		// literals
		"string": "a31515",
		"template-string": "a31515",
		"template-punctuation": "a31515",
		"string-literal": "a31515",
		"char": "a31515",
		"number": "098658",
		"datetime": "098658",
		"constant": "0070c1",
		"symbol": "0070c1",
		"scalar": "0000ff",
		"conversion-option": "0000ff",

		// identifiers
		"class-name": "267f99",
		"class-name-definition": "267f99",
		"type-definition": "267f99",
		"return-type": "267f99",
		"attribute": "267f99",
		"attribute-class-name": "267f99",
		"annotation": "267f99",
		"decorator": "267f99",
		"namespace": "267f99",
		"double-colon": "267f99",
		"function": "795e26",
		"function-definition": "795e26",
		"method-definition": "795e26",
		"variable": "001080",
		"parameter": "001080",
		"environment": "001080",
		"assign-left": "001080",
		"property": language === "css" ? "e50000"
			: language === "json" ? "0451a5" : "001080",
		"key": "0451a5",
		"package": "000000",
		"lifetime-annotation": "0000ff",

		// markup / HTML / XML
		"tag": "800000",
		"selector": "800000",
		"attr-name": "e50000",
		"attr-value": "0000ff",
		"entity": "800000",
		"doctype": "808080",
		"doctype-tag": "808080",
		"name": "808080",
		"cdata": "808080",
		"prolog": "808080",
		"delimiter": language === "php" ? "800000" : "a31515",

		// CSS specific
		"atrule": "0000ff",
		"url": "0451a5",

		// regex
		"regex": "811f3f",
		"regex-delimiter": "811f3f",
		"regex-source": "811f3f",
		"regex-flags": "0000ff",
		"interpolation-punctuation": "0000ff",

		// Markdown
		"title": "800000",
		"blockquote": "0451a5",
		"list": "0451a5",
		"bold": "000080",
		"italic": "800080",
		"code": "800000",
		"code-snippet": "800000",
		"code-block": "800000",
		"code-language": "0000ff",
		"inserted": "098658",
		"deleted": "a31515",
		"strike": "000000",
		"hr": "800000",
	};
	const controlFlowKeywords = new Set([
		"if", "else", "elif", "elseif", "unless", "then", "switch", "case", "default", "when", "match",
		"for", "foreach", "while", "do", "until", "loop", "break", "continue", "return", "goto",
		"throw", "throws", "try", "catch", "except", "finally", "rescue", "ensure",
		"await", "yield", "new", "delete", "in", "of", "instanceof",
	]);

	// const themeColors: Record<string, string> = {
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
	// }

	const tokens = Prism.tokenize(code, grammar);
	return tokensToParagraphs(tokens);

	function tokensToParagraphs(tokens: (string | Prism.Token)[])
	{
		const paragraphs: Paragraph[] = [];
		let currentRuns: ParagraphChild[] = [];
		type TokenStyle = { color: string, bold: boolean, italics: boolean, strike: boolean };
		const plainStyle: TokenStyle = { color: themeColors.plain, bold: false, italics: false, strike: false };

		function addText(text: string, style: TokenStyle)
		{
			const lines = text.split("\n");

			lines.forEach((line, index) =>
			{
				currentRuns.push(
					new TextRun({
						text: line,
						color: style.color,
						bold: style.bold,
						italics: style.italics,
						strike: style.strike,
					}),
				);

				if (index < lines.length - 1)
				{
					paragraphs.push(new Paragraph({ children: currentRuns, style: STYLE_code }));
					currentRuns = [];
				}
			});
		}

		function process(token: string | Prism.Token, parentStyle = plainStyle)
		{
			if (typeof token === "string")
				addText(token, parentStyle);
			else
			{
				const aliases = typeof token.alias == "string" ? [token.alias] : token.alias || [];
				const types = [token.type, ...aliases];
				const colorType = types.find(type => themeColors[type]);
				const isControlFlow = token.type == "keyword" && typeof token.content == "string"
					&& controlFlowKeywords.has(token.content);
				const inheritPunctuation = token.type == "punctuation" && parentStyle.color != themeColors.plain;
				const style: TokenStyle = {
					color: isControlFlow ? themeColors["control-flow"]
						: inheritPunctuation ? parentStyle.color
							: colorType ? themeColors[colorType] : parentStyle.color,
					bold: parentStyle.bold || types.includes("bold") || types.includes("important") || types.includes("title"),
					italics: parentStyle.italics || types.includes("italic"),
					strike: parentStyle.strike || types.includes("strike"),
				};

				if (Array.isArray(token.content))
					token.content.forEach(t => process(t, style));
				else if (typeof token.content === "string")
					addText(token.content, style);
				else
					process(token.content, style);
			}
		}

		tokens.forEach(t => process(t));

		if (currentRuns.length > 0)
		{
			paragraphs.push(new Paragraph({ children: currentRuns, style: STYLE_code }));
		}

		return paragraphs;
	}

}

function estimateNumberWidthPt(text: string, fontSizePt: number): number
{
	const charWidths: Record<string, number> = {
		".": 0.25, ",": 0.25, "-": 0.333, "(": 0.333, ")": 0.333, " ": 0.25,
		"a": 0.444, "b": 0.5, "c": 0.444, "d": 0.5, "e": 0.444,
		"A": 0.722, "B": 0.667, "C": 0.667, "D": 0.722, "E": 0.611,
		"а": 0.5, "б": 0.5, "в": 0.5, "г": 0.5, "д": 0.5,
		"А": 0.722, "Б": 0.667, "В": 0.667, "Г": 0.611, "Д": 0.722,
	};
	return [...text].reduce((width, char) => width + (charWidths[char] ?? 0.5) * fontSizePt, 0);
}

function genXml_app({ totalTime }: { totalTime?: number })
{
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<TotalTime>${totalTime || randomInt(30, 120)}</TotalTime>
</Properties>
	`;
}
function escapeXml(value: string)
{
	return value.replaceAll(/[<>&"']/g, ch => ({
		"<": "&lt;",
		">": "&gt;",
		"&": "&amp;",
		'"': "&quot;",
		"'": "&apos;",
	}[ch]!));
}
function genXml_core({ title, creator, createdAt, modifiedAt }: { title?: string, creator?: string, createdAt?: Date, modifiedAt?: Date })
{
	if (!createdAt) createdAt = new Date();
	if (!modifiedAt) modifiedAt = new Date();
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${escapeXml(title || "Document")}</dc:title>
<dc:creator>${escapeXml(creator || "Student")}</dc:creator>
<cp:lastModifiedBy>${escapeXml(creator || "Student")}</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${createdAt.toISOString()}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${modifiedAt.toISOString()}</dcterms:modified>
</cp:coreProperties>`;
}
function genXml_style(assets: string, doc: RunicDoc): string
{
	let xml = fs.readFileSync(path.join(assets, "styles.xml"), { encoding: "utf8" });

	xml = editStyle(`<w:style w:type="paragraph" w:default="1" w:styleId="a2">`, xml =>
	{
		xml = replaceTag(xml, `<w:spacing w:line="${doc.text.line_spacing * 240}" w:lineRule="auto" w:after="${doc.text.spacing.after * 20}"/>`);
		xml = replaceTag(xml, `<w:ind w:firstLine="${convertMillimetersToTwip(doc.text.indent * 10)}"/>`);
		xml = replaceTag(xml, `<w:sz w:val="${doc.text.size * 2}"/>`);
		return xml;
	});

	xml = editStyle(`<w:style w:type="paragraph" w:customStyle="1" w:styleId="ListingCaption">`, xml =>
	{
		if (doc.code.spacing.before !== undefined)
			xml = replaceTag(xml, `<w:spacing w:after="0" w:line="240" w:lineRule="auto" w:before="${doc.code.spacing.before * 20}"/>`);
		if (doc.code.title.style != "normal")
			xml = addrPrStyle(xml, doc.code.title.style == "bold" ? "<w:b/>" : "<w:i/>");
		return xml;
	});

	xml = editStyle(`<w:style w:type="paragraph" w:customStyle="1" w:styleId="ListingCode">`, xml =>
	{
		xml = replaceTag(xml, `<w:sz w:val="${doc.code.text.size * 2}"/>`);
		if (doc.code.spacing.after !== undefined)
			xml = replaceTag(xml, `<w:spacing w:line="240" w:lineRule="auto" w:after="${doc.code.spacing.after * 20}"/>`);
		return xml;
	});

	xml = editStyle(`<w:style w:type="paragraph" w:customStyle="1" w:styleId="TableCaption">`, xml =>
	{
		if (doc.table.title.style != "normal")
			xml = addrPrStyle(xml, doc.table.title.style == "bold" ? "<w:b/>" : "<w:i/>");
		return xml;
	});

	const admonitionTypes: AdmonitionType[] = ["note", "info", "tip", "warning", "danger"];
	for (const type of admonitionTypes)
	{
		const suffix = type == "note" ? "" : type;
		const styleId = `xAdmonition${suffix}`;
		const styleTag = `<w:style w:type="paragraph" w:customStyle="1" w:styleId="${styleId}">`;
		const style = doc.admonition[type];
		xml = editStyle(styleTag, xml =>
		{
			xml = replaceTagOrInsertAfter(xml, "<w:pPr>", `<w:spacing w:before="${style.spacing.before * 20}" w:after="${style.spacing.after * 20}"/>`);
			xml = replaceTagOrInsertAfter(xml, "<w:pPr>", `<w:ind w:left="${convertMillimetersToTwip(style.indent * 10)}" w:firstLine="0"/>`);
			xml = replaceBorder(xml, "top", style.padding.top, "FFFFFF", 2);
			xml = replaceBorder(xml, "right", style.padding.right, "FFFFFF", 2);
			xml = replaceBorder(xml, "bottom", style.padding.bottom, "FFFFFF", 2);
			xml = replaceBorder(xml, "left", style.padding.left, style.color, Math.max(1, Math.round(style.bar_width * 8)));
			xml = replaceTagOrInsertAfter(xml, "<w:pPr>", `<w:shd w:val="clear" w:color="auto" w:fill="${style.background}"/>`);
			return xml;
		});
	}

	return xml;

	function replaceBorder(xml: string, side: "top" | "right" | "bottom" | "left", space: number, color: string, size: number)
	{
		return replaceTagOrInsertAfter(xml, "<w:pBdr>", `<w:${side} w:val="single" w:sz="${size}" w:space="${space}" w:color="${color}"/>`);
	}
	function replaceTagOrInsertAfter(xml: string, insertAfter: string, tag: string)
	{
		const tagName = /<([^\s>]+)/.exec(tag)?.[1];
		if (!tagName) throw err();
		const regex = new RegExp(`<${tagName}\\b[^>]*/>`);
		return regex.test(xml) ? xml.replace(regex, tag) : xml.replace(insertAfter, `${insertAfter}${tag}`);
	}
	function replaceTag(xml: string, tag: string): string
	{
		const tagName = /<([^\s]+)\b/.exec(tag)?.[1];
		if (!tagName) throw err();
		const regex = new RegExp(`(<${tagName}\\b[^>]*/>)`, "s");
		return xml.replace(regex, tag);
	}
	function editStyle(tag: string, f: (xml: string) => string)
	{
		const startI = xml.indexOf(tag);
		if (startI < 0) throw err();
		let endI = xml.indexOf(`</w:style>`, startI);
		if (endI < 0) throw err();
		endI += `</w:style>`.length;

		return xml.slice(0, startI) + f(xml.slice(startI, endI)) + xml.slice(endI);
	}
	function insertAfter(xml: string, search: string, value: string)
	{
		const sI = xml.indexOf(search);
		if (sI < 0) return { ok: false, xml };
		const i = sI + search.length;
		return { ok: true, xml: xml.slice(0, i) + value + xml.slice(i) };
	}
	function insertBefore(xml: string, search: string, value: string)
	{
		const i = xml.indexOf(search);
		if (i < 0) return { ok: false, xml };
		return { ok: true, xml: xml.slice(0, i) + value + xml.slice(i) };
	}
	function addrPrStyle(xml: string, value: string)
	{
		let r = insertAfter(xml, "<w:rPr>", value);
		if (r.ok) return r.xml;
		r = insertBefore(xml, "</w:style>", `<w:rPr>${value}</w:rPr>`);
		if (r.ok) return r.xml;
		throw err();
	}
	function err()
	{
		return new Error(`styles.xml is corrupted (broken extension version - upgrade or downgrade)`);
	}
}
