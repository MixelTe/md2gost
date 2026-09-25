import type { DocNode, NodeList, NodeTable, NodeText, NodeTitle, Rune, RunicDoc, Runify } from "./doc";
import { repeat, toCapitalCase } from "./utils";

const APPENDIX_NAME = "АБВГДЕЖИКЛМНПРСТУФХЦШЩЭЮЯ";

export function alchemist(doc: RunicDoc, logwarn: (msg: string) => void = console.warn)
{
	const counter = {
		codesAll: 0,
		imgsAll: 0,
		tablesAll: 0,
		formulasAll: 0,
		codes: 0,
		imgs: 0,
		tables: 0,
		formulas: 0,
		titles: { l1: 0, l2: 0, l3: 0, l4: 0, l5: 0 },
	};
	type TtKeys = keyof typeof counter["titles"];
	const named: { [name: string]: { n: number, prefix: string } | { f: (n: number, prefix: string) => void, i: number, sourceLine?: number }[] } = {};
	const warnAt = (line: number | undefined, message: string) => logwarn(`${line ? `Line ${line}: ` : ""}${message}`);
	const vals: { [name: string]: ((n: number) => void)[] } = {};
	let lastRefI = 0;
	let prevNum = -1;
	let prevPrefix = "";
	let nextNum = -1;
	let nextPrefix = "";
	let prefix = "";

	let synopsis = null as Runify<NodeText> | null;
	let appendix = false;

	if (doc.numberingLazy) addLazyNumbering(doc);

	doc.nodes.forEach((node, i) =>
	{
		if (nextNum < 0)
		{
			let l1 = counter.titles.l1;
			let codes = counter.codes;
			let imgs = counter.imgs;
			let tables = counter.tables;
			let formulas = counter.formulas;
			for (let j = i; j < doc.nodes.length && nextNum < 0; j++)
			{
				const n = doc.nodes[j];
				if (n.type == "code") nextNum = codes + 1;
				if (n.type == "image") nextNum = imgs + 1;
				if (n.type == "table") nextNum = tables + 1;
				if (n.type == "math") nextNum = formulas + 1;
				if (n.type == "title" && n.level == 1 && doc.numberingSections)
				{
					const num = getTitleNum(n);
					if (num) l1 = num;
					else l1++;
					codes = 0;
					imgs = 0;
					tables = 0;
					formulas = 0;
				}
			}
			nextPrefix = l1 > 0 && doc.numberingSections ? `${l1}.` : "";
		}

		if (node.tags && node.type == "text" && node.tags.includes("synopsis"))
			synopsis = node;

		if (node.type == "title")
		{
			for (let i = 1; i <= 5; i++)
			{
				if (i == node.level) counter.titles[`l${i}` as TtKeys]++;
				if (i > node.level) counter.titles[`l${i}` as TtKeys] = 0;
			}
			if (node.level == 0 && node.text.map(r => r.text).join("").trim().toUpperCase() == "ПРИЛОЖЕНИЯ")
			{
				appendix = true;
				counter.titles.l1 = 0;
			}
			if (node.level == 1)
			{
				const num = getTitleNum(node);
				if (num) counter.titles.l1 = num;
				if ((doc.numberingSections || appendix))
				{
					counter.codes = 0;
					counter.imgs = 0;
					counter.tables = 0;
					counter.formulas = 0;
				}
				prefix = doc.numberingSections ? `${counter.titles.l1}.` : "";
				if (appendix) prefix = APPENDIX_NAME[counter.titles.l1 - 1] + ".";
			}
		}

		materializeNode(node);

		if (node.type == "code" || node.type == "image" || node.type == "table" || node.type == "math")
		{
			if (node.type == "code") { counter.codes++; counter.codesAll++; }
			if (node.type == "image") { counter.imgs++; counter.imgsAll++; }
			if (node.type == "table" && !node.tags?.includes("definitions_table")) { counter.tables++; counter.tablesAll++; }
			if (node.type == "math") { counter.formulas++; counter.formulasAll++; }
			prevNum = nextNum;
			prevPrefix = prefix;
			nextNum = -1;
		}
	});

	for (const value of [doc.header, doc.footer, ...doc.nodes.filter(node => node.type == "sectionBreak").flatMap(node => [node.header, node.footer])])
	{
		if (value?.type != "content") continue;
		value.nodes.forEach(materializeNode);
	}

	const sourcesCount = crystallizeSources();

	vals["codes"]?.forEach(f => f(counter.codesAll));
	vals["imgs"]?.forEach(f => f(counter.imgsAll));
	vals["tables"]?.forEach(f => f(counter.tablesAll));
	vals["formulas"]?.forEach(f => f(counter.formulasAll));
	vals["sources"]?.forEach(f => f(sourcesCount));

	Object.entries(named).forEach(([k, v]) =>
	{
		if (v instanceof Array) v.forEach(ref => warnAt(ref.sourceLine, `Неизвестная ссылка [${k}]`));
	});

	if (synopsis)
	{
		synopsis.text = [
			"Отчет ",
			"pages",
			" с.",
			counter.imgsAll > 0 && `, ${counter.imgsAll} рис.`,
			counter.tablesAll > 0 && `, ${counter.tablesAll} табл.`,
			counter.codesAll > 0 && `, ${counter.codesAll} лист.`,
			sourcesCount > 0 && `, ${sourcesCount} источн.`,
			appendix && counter.titles.l1 > 0 && `, ${counter.titles.l1} прил.`,
		].filter(v => !!v).map((text, i) => ({ text: text as string, type: i == 1 ? "val" : "text" }));
	}

	function getTitleNum(node: Runify<NodeTitle>)
	{
		if (node.text.some(r => r.type == "ref")) return null;
		const text = node.text[0]?.text;
		if (!text) return null;
		const m = /^\s*(\d+)/.exec(text);
		const num = parseInt(m?.[1] || "");
		if (!isFinite(num)) return null;
		return num;
	}

	function materializeNode(node: Runify<DocNode>)
	{
		if ("text" in node && node.text)
			materializeRunes(node.text, node);
		if ("title" in node && node.title)
			materializeRunes(node.title, node);
		if (node.type == "list") materializeList(node);
		if (node.type == "table") materializeTable(node);
	}

	function materializeList(node: Runify<NodeList>)
	{
		node.items.forEach(item =>
		{
			if (item.type == "list") materializeList(item);
			else materializeRunes(item.text, { ...node, sourceLine: item.sourceLine ?? node.sourceLine });
		});
	}
	function materializeTable(node: Runify<NodeTable>)
	{
		node.rows.forEach(row => row.forEach(item =>
		{
			materializeNode(item);
		}));
	}

	function materializeRunes(runes: Rune[], node: Runify<DocNode>)
	{
		runes.forEach((rune, i) =>
		{
			if (rune.type == "val")
			{
				if (!(rune.text in vals)) vals[rune.text] = [];
				vals[rune.text].push(n =>
				{
					rune.type = "text";
					rune.text = `${n}`;
				});
				return;
			}
			if (rune.type != "ref") return;
			const type = node.type;
			const m = /^(.*?)([-+]\d+)?$/.exec(rune.text.replaceAll(/\s+/g, ""));
			const tag = m?.[1] || "";
			const math = m?.[2] || "";
			const mathSubstarct = math.at(0) == "-";
			const v = named[tag];
			const applyMath = (n: number) =>
			{
				if (!math) return n;
				const v = parseInt(math.slice(1));
				if (mathSubstarct) return n - v;
				return n + v;
			};
			if (type == "title")
			{
				const num = counter.titles[`l${node.level}` as TtKeys];
				if (appendix)
				{
					const char = APPENDIX_NAME[counter.titles.l1 - 1];
					if (v instanceof Array) v.forEach(fn => fn.f(-1, char));
					named[tag] = { n: -1, prefix: char };
					rune.type = "text";
					rune.text = char;
					return;
				}
				const prefix = node.level <= 1 ? "" : repeat(node.level - 1, i => counter.titles[`l${i + 1}` as TtKeys]).join(".") + ".";
				if (v instanceof Array) v.forEach(fn => fn.f(num, prefix));
				named[tag] = { n: num, prefix };
				rune.type = "text";
				rune.text = repeat(node.level, i => counter.titles[`l${i + 1}` as TtKeys]).join(".");
				return;
			}
			if (type == "code" || type == "image" || type == "table" || type == "math")
			{
				let { num, text } =
					type == "code" ? { num: counter.codes, text: "Листинг" } :
						type == "image" ? { num: counter.imgs, text: "Рисунок" } :
							type == "table" ? { num: counter.tables, text: "Таблица" } :
								type == "math" ? { num: counter.formulas, text: "" } : (() => { (type satisfies never); throw new Error("switch default"); })();
				num++;
				if (doc.numberingAutoprefix)
				{
					const prevRune = runes[i - 1];
					if (prevRune && prevRune.text.trim().toLowerCase() == text.toLowerCase())
						prevRune.text = "";
					const nextRune = runes[i + 1];
					if (nextRune)
					{
						nextRune.text = nextRune.text.trimStart();
						if (nextRune.text[0] == "-") nextRune.text = nextRune.text.slice(1);
						if (nextRune.text[0] == "\u2013") nextRune.text = nextRune.text.slice(1);
						nextRune.text = nextRune.text.trimStart();
						nextRune.text = toCapitalCase(nextRune.text);
					}
					text = `${text} ${prefix}${num} \u2013 `;
					if (type == "math") text = `${prefix}${num}`;
				}
				else text = `${prefix}${num}`;
				if (v instanceof Array) v.forEach(fn => fn.f(num, prefix));
				else if (v && tag != "#") warnAt(node.sourceLine, `id [${tag}] ${type == "code" ? "листинга" : type == "image" ? "рисунка" : type == "table" ? "таблицы" : type == "math" ? "формулы" : ""} уже занято чем-то другим`);
				named[tag] = { n: num, prefix };
				rune.type = "text";
				rune.text = text;
				return;
			}
			if (tag == "#")
			{
				if (nextNum < 0) return;
				rune.type = "text";
				if (mathSubstarct)
					rune.text = `${prevPrefix}${applyMath(prevNum + 1)}`;
				else
					rune.text = `${nextPrefix}${applyMath(nextNum)}`;
				return;
			}
			if (!v || v instanceof Array)
			{
				const f = (n: number, prefix: string) =>
				{
					rune.type = "text";
					rune.text = n < 0 ? prefix : `${prefix}${applyMath(n)}`;
				};
				if (v) v.push({ f, i: lastRefI++, sourceLine: node.sourceLine });
				else named[tag] = [{ f, i: lastRefI++, sourceLine: node.sourceLine }];
			}
			else
			{
				rune.type = "text";
				rune.text = `${v.prefix}${applyMath(v.n)}`;
			}
		});
	}

	function crystallizeSources()
	{
		const sourcesList = doc.nodes.find(node => node.type == "list" && node.tags?.includes("sources"));
		if (!sourcesList || sourcesList.type != "list") return 0;
		const items = sourcesList.items
			.filter(v => v.type == "listItem")
			.map((v, i) =>
			{
				const item = v.text;
				const refI = item[0]?.text ? 0 : 1;
				const ref = item[refI];
				if (ref?.type != "ref")
				{
					// logwarn(`Отсутствует id у источника: ${item.map(v => v.text).join("")}`);
					return { text: item, ref: "", i: 99999 + i, srcI: v.sourceLine };
				}
				const refs = named[ref.text];
				if (refs && !(refs instanceof Array))
				{
					warnAt(sourcesList.sourceLine, `id [${ref.text}] источника уже занято чем-то другим`);
					return { text: item.slice(refI + 1), ref: "", i: 99999 + i, srcI: v.sourceLine };
				}
				const firstOccurrenceI = Math.min(...refs.map(v => v.i));
				return { text: item.slice(refI + 1), ref: ref.text, i: firstOccurrenceI, srcI: v.sourceLine };
			});
		items.sort((a, b) => a.i - b.i);
		const hasIdAny = items.some(it => !!it.ref);
		sourcesList.items = items.map((item, i) =>
		{
			const key = hasIdAny ? item.ref : (i + 1);
			const refs = named[key];
			named[key] = { prefix: "", n: i + 1 };
			if (refs instanceof Array)
			{
				if (hasIdAny && refs.length <= 1)
					warnAt(item.srcI, `В тексте отсутствуют ссылки на источник: ${item.ref}`);
				refs.forEach(r => hasIdAny ? r.f(i + 1, "") : r.f(-1, `[${i + 1}]`));
			}
			return { type: "listItem", text: item.text, sourceLine: item.srcI };
		});
		return sourcesList.items.length;
	}
}

function addLazyNumbering(doc: RunicDoc)
{
	doc.nodes.forEach(node =>
	{
		if (node.type == "math" && !node.title) node.title = [{ text: "(", type: "text" }, { text: "#", type: "ref" }, { text: ")", type: "text" }];
		const runes = (node.type == "code" || node.type == "table") ? node.title
			: node.type == "image" ? node.text : null;
		if (!runes) return;
		if (runes.find(rune => rune.type == "ref")) return;
		runes.splice(0, 0, { text: "#", type: "ref" });
	});
}
