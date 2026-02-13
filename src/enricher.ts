import { tableRow, type Doc, type DocNode, type NodeList } from "./doc";
import { trimEnd } from "./utils";

export function enrichDoc(doc: Doc)
{
	const section = doc.sections[0]!;
	for (let i = 0; i < section.nodes.length; i++)
	{
		const node = section.nodes[i]!;
		if (node.type == "title" && node.text.toUpperCase().startsWith("ТИТУЛЬНИК"))
		{
			section.nodes.splice(i, 1, { type: "text", text: node.text.toUpperCase() });
			section.nodes.splice(i + 1, 0, { type: "pageBreak" });
			i++;
		}
		else if (node.type == "title" && node.text.toUpperCase() == "РЕФЕРАТ")
		{
			node.level = 0;
			node.text = node.text.toUpperCase();
			const nextNode = section.nodes[i + 1];
			if (nextNode?.type == "text")
			{
				nextNode.noIndent = true;
				nextNode.text = trimEnd(nextNode.text, ".").toUpperCase();
			}
			section.nodes.splice(i + 1, 0, { type: "text", text: "Отчет x с., x рис., x табл., x лист., x источн." })
			while (i + 1 < section.nodes.length && section.nodes[i + 1]?.type != "title") i++;
			section.nodes.splice(i + 1, 0, { type: "pageBreak" });
		}
		else if (node.type == "title" && node.text.toUpperCase() == "ОГЛАВЛЕНИЕ")
		{
			node.level = 0;
			section.nodes.splice(i + 1, 0, { type: "tableOfContents" });
		}
		else if (node.type == "title" && node.text.toUpperCase() == "ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ")
		{
			node.center = true;
			node.text = node.text.toUpperCase();
			const warn = () => console.warn("Wrong format of ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ");
			const list = section.nodes[i + 1];
			if (list?.type != "list") { warn(); continue; }
			const rows: DocNode[][] = [tableRow("Термин", "Определение")];
			for (const item of list.items)
			{
				if (item.type != "listItem") { warn(); continue; }
				const i = item.text.indexOf(":");
				if (i < 0) { warn(); continue; }
				rows.push(tableRow(item.text.slice(0, i).trim(), item.text.slice(i + 1).trim()));
			}
			section.nodes.splice(i + 1, 1, { type: "text", text: "В настоящем отчете применяются следующие термины с соответствующими определениями." });
			section.nodes.splice(i + 2, 0, { type: "table", rows, normalFontSize: true });
			section.nodes.splice(i + 3, 0, { type: "pageBreak" });
		}
		else if (node.type == "title" && node.text.toUpperCase() == "ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ")
		{
			node.center = true;
			node.text = node.text.toUpperCase();
			const warn = () => console.warn("Wrong format of ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ");
			const list = section.nodes[i + 1];
			if (list?.type != "list") { warn(); continue; }
			const items: DocNode[] = [];
			for (const item of list.items)
			{
				if (item.type != "listItem") { warn(); continue; }
				items.push({ type: "text", text: trimEnd(item.text, "."), noIndent: true, noMargin: true });
			}
			section.nodes.splice(i + 1, 1, { type: "text", text: "В настоящем отчете применяют следующие сокращения и обозначения." });
			section.nodes.splice(i + 2, 0, { type: "pageBreak" });
			section.nodes.splice(i + 2, 0, ...items);
		}
		else if (node.type == "title" && node.text.toUpperCase() == "ВВЕДЕНИЕ")
		{
			node.center = true;
			node.text = node.text.toUpperCase();
			for (let j = i + 1; j < section.nodes.length; j++)
			{
				const node = section.nodes[j];
				if (node?.type == "title")
				{
					section.nodes.splice(j, 0, { type: "pageBreak" });
					break;
				}
			}
		}
		else if (node.type == "title" && node.text.toUpperCase() == "ЗАКЛЮЧЕНИЕ")
		{
			node.center = true;
			node.text = node.text.toUpperCase();
			section.nodes.splice(i, 0, { type: "pageBreak" });
			i++;
		}
		else if (node.type == "title" && node.text.toUpperCase() == "СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ")
		{
			node.center = true;
			node.text = node.text.toUpperCase();
			section.nodes.splice(i, 0, { type: "pageBreak" });
			i++;
			const list = section.nodes[i + 1];
			if (list?.type != "list") { console.warn("Wrong format of СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ"); continue; }
			list.alternativeStyle = true;
			i++;
		}
		else if (node.type == "list")
		{
			enrichList(node, true);
			function enrichList(list: NodeList, isLastItem: boolean, isSubList: boolean = false)
			{
				const isLongList = 5 < Math.max(...list.items.filter(v => v.type == "listItem").map(v => v.text.split(/\s+/).length));
				const hasSublist = list.items.some(v => v.type == "list");
				const ending = isLongList || hasSublist || isSubList ? ";" : ","
				for (let i = 0; i < list.items.length; i++)
				{
					const item = list.items[i]!;
					const itemNext = list.items[i + 1];
					const isLast = i == list.items.length - 1;
					if (item.type == "list") enrichList(item, isLast, true);
					else
					{
						const end = itemNext?.type == "list" ? ":" : isLastItem && isLast ? "." : ending;
						item.text = item.text.slice(0, 1).toLowerCase() + item.text.slice(1);
						item.text = trimEnd(item.text, ".", ",", ';', ":", "!") + end;
					}
				}
			}
		}
	}
}
