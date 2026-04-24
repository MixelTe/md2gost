import { tableRow, type Doc, type DocNode, type NodeList } from "./doc";
import { trimEnd } from "./utils";

export function enrichDoc(doc: Doc, logwarn: (msg: string) => void = console.warn)
{
	for (let i = 0; i < doc.nodes.length; i++)
	{
		const node = doc.nodes[i]!;
		if (node.type == "title" && node.text.toUpperCase().startsWith("ТИТУЛЬНИК"))
		{
			doc.nodes.splice(i, 1, { type: "text", text: node.text.toUpperCase() });
			doc.nodes.splice(i + 1, 0, { type: "pageBreak" });
			i++;
		}
		else if (node.type == "title" && node.text.toUpperCase() == "РЕФЕРАТ")
		{
			node.level = 0;
			node.text = node.text.toUpperCase();
			const nextNode = doc.nodes[i + 1];
			if (nextNode?.type == "text")
			{
				nextNode.noIndent = true;
				nextNode.text = trimEnd(nextNode.text, ".").toUpperCase();
			}
			doc.nodes.splice(i + 1, 0, { type: "text", tags: ["synopsis"], text: "Отчет [!pages] с., [!imgs] рис., [!tables] табл., [!codes] лист., [!sources] источн." });
			while (i + 1 < doc.nodes.length && doc.nodes[i + 1]?.type != "title") i++;
			doc.nodes.splice(i + 1, 0, { type: "pageBreak" });
		}
		else if (node.type == "title" && node.text.toUpperCase() == "ОГЛАВЛЕНИЕ")
		{
			node.level = 0;
			node.text = node.text.toUpperCase();
			doc.nodes.splice(i + 1, 0, { type: "tableOfContents" });
		}
		else if (node.type == "title" && node.text.toUpperCase() == "ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ")
		{
			node.center = true;
			node.text = node.text.toUpperCase();
			const warn = () => logwarn("Wrong format of ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ");
			const list = doc.nodes[i + 1];
			if (list?.type != "list") { warn(); continue; }
			const rows: DocNode[][] = [tableRow("Термин", "Определение")];
			const align = ["l" as const, "l" as const];
			for (const item of list.items)
			{
				if (item.type != "listItem") { warn(); continue; }
				const i = item.text.indexOf(":");
				if (i < 0) { warn(); continue; }
				rows.push(tableRow(item.text.slice(0, i).trim(), item.text.slice(i + 1).trim()));
			}
			doc.nodes.splice(i + 1, 1, { type: "text", text: "В настоящем отчете применяются следующие термины с соответствующими определениями." });
			doc.nodes.splice(i + 2, 0, { type: "table", align, rows, normalFontSize: true });
			doc.nodes.splice(i + 3, 0, { type: "pageBreak" });
		}
		else if (node.type == "title" && node.text.toUpperCase() == "ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ")
		{
			node.center = true;
			node.text = node.text.toUpperCase();
			const warn = () => logwarn("Wrong format of ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ");
			const list = doc.nodes[i + 1];
			if (list?.type != "list") { warn(); continue; }
			const items: DocNode[] = [];
			for (const item of list.items)
			{
				if (item.type != "listItem") { warn(); continue; }
				items.push({ type: "text", text: trimEnd(item.text, "."), noIndent: true, noMargin: true });
			}
			doc.nodes.splice(i + 1, 1, { type: "text", text: "В настоящем отчете применяют следующие сокращения и обозначения." });
			doc.nodes.splice(i + 2, 0, { type: "pageBreak" });
			doc.nodes.splice(i + 2, 0, ...items);
		}
		else if (node.type == "title" && node.text.toUpperCase() == "ВВЕДЕНИЕ")
		{
			node.center = true;
			node.text = node.text.toUpperCase();
			for (let j = i + 1; j < doc.nodes.length; j++)
			{
				const node = doc.nodes[j];
				if (node?.type == "title")
				{
					doc.nodes.splice(j, 0, { type: "pageBreak" });
					break;
				}
			}
		}
		else if (node.type == "title" && node.text.toUpperCase() == "ЗАКЛЮЧЕНИЕ")
		{
			node.center = true;
			node.text = node.text.toUpperCase();
			doc.nodes.splice(i, 0, { type: "pageBreak" });
			i++;
		}
		else if (node.type == "title" && node.text.toUpperCase() == "СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ")
		{
			node.center = true;
			node.text = node.text.toUpperCase();
			doc.nodes.splice(i, 0, { type: "pageBreak" });
			i++;
			const list: NodeList = {
				type: "list",
				startIndex: 1,
				alternativeStyle: true,
				ordered: true,
				items: [],
			};
			const startI = i + 1;
			while (true)
			{
				const textNode = doc.nodes[i + 1];
				if (textNode?.type != "text") break;
				const items = textNode.text.split(/\n\s*(?=\[[a-zA-Zа-яА-ЯёЁ_\d]+\])/);
				for (const item of items)
					list.items.push({ type: "listItem", text: item });
				i++;
			}
			doc.nodes.splice(startI, i - startI + 1, list);
		}
		else if (node.type == "list")
		{
			enrichList(node, true);
			function enrichList(list: NodeList, isLastItem: boolean, isSubList: boolean = false)
			{
				const isLongList = 3 < Math.max(...list.items.filter(v => v.type == "listItem").map(v => v.text.split(/\s+/).length));
				const hasSublist = list.items.some(v => v.type == "list");
				const ending = isLongList || hasSublist || isSubList ? ";" : ",";
				for (let i = 0; i < list.items.length; i++)
				{
					const item = list.items[i]!;
					const itemNext = list.items[i + 1];
					const isLast = i == list.items.length - 1;
					if (item.type == "list") enrichList(item, isLast, true);
					else
					{
						const end = itemNext?.type == "list" ? ":" : isLastItem && isLast ? "." : ending;
						item.text = trimEnd(item.text, ".", ",", ';', ":", "!") + end;
					}
				}
			}
		}
		else if (node.type == "image")
		{
			if (node.text)
				node.text = trimEnd(node.text, ".", ",", ';', ":", "!");
		}
		else if (node.type == "table")
		{
			if (node.title)
				node.title = trimEnd(node.title, ".", ",", ';', ":", "!");
		}
		else if (node.type == "code")
		{
			if (node.title)
				node.title = trimEnd(node.title, ".", ",", ';', ":", "!");
		}
	}
}
