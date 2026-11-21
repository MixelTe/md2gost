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
		titles: { l1: 0, l2: 0, l3: 0, l4: 0, l5: 0, l6: 0 },
	};
	type TtKeys = keyof typeof counter["titles"];
	type ObjNum = { n: number, prefix: string };
	const relRefs = new Map<string, {
		prev?: ObjNum,
		next: { resolve: (number: ObjNum) => void, warn: () => void }[],
	}>(["i#", "t#", "c#", "f#"].map(tag => [tag, { next: [] }]));
	const named: { [name: string]: ObjNum | { f: (n: number, prefix: string) => void, i: number, sourceLine?: number }[] } = {};
	const warnAt = (line: number | undefined, message: string) => logwarn(`${line ? `Line ${doc.mapSourceLine(line)}: ` : ""}${message}`);
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
	const sectionPrefixes = getSectionPrefixes();

	doc.nodes.forEach((node, i) =>
	{
		if (nextNum < 0)
		{
			let currentPrefix = prefix;
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
				const sectionPrefix = n.type == "title" ? sectionPrefixes.get(n) : undefined;
				if (sectionPrefix !== undefined)
				{
					currentPrefix = sectionPrefix;
					codes = 0;
					imgs = 0;
					tables = 0;
					formulas = 0;
				}
			}
			nextPrefix = currentPrefix;
		}

		if (node.tags && node.type == "text" && node.tags.includes("synopsis"))
			synopsis = node;

		if (node.type == "title")
		{
			for (let i = 1; i <= 6; i++)
			{
				if (i == node.level) counter.titles[`l${i}` as TtKeys]++;
				if (i > node.level) counter.titles[`l${i}` as TtKeys] = 0;
			}
			if (isAppendixHeading(node))
			{
				appendix = true;
				counter.titles.l1 = 0;
			}
			if (node.level == 1)
			{
				const num = getTitleNum(node);
				if (num) counter.titles.l1 = num;
			}
			const sectionPrefix = sectionPrefixes.get(node);
			if (sectionPrefix !== undefined)
			{
				counter.codes = 0;
				counter.imgs = 0;
				counter.tables = 0;
				counter.formulas = 0;
				prefix = sectionPrefix;
			}
		}

		materializeNode(node);

		if (node.type == "code" || node.type == "image" || node.type == "table" || node.type == "math")
		{
			if (node.type == "code") { counter.codes++; counter.codesAll++; updRef("c#", counter.codes); }
			if (node.type == "image") { counter.imgs++; counter.imgsAll++; updRef("i#", counter.imgs); }
			if (node.type == "table" && !node.tags?.includes("definitions_table")) { counter.tables++; counter.tablesAll++; updRef("t#", counter.tables); }
			if (node.type == "math") { counter.formulas++; counter.formulasAll++; updRef("f#", counter.formulas); }
			prevNum = nextNum;
			prevPrefix = prefix;
			nextNum = -1;

			function updRef(tag: string, n: number)
			{
				const ref = relRefs.get(tag)!;
				const num = { n, prefix };
				ref.prev = num;
				ref.next.forEach(r => r.resolve(num));
				ref.next = [];
			}
		}
	});

	for (const value of [doc.header, doc.footer, ...doc.nodes.filter(node => node.type == "sectionBreak").flatMap(node => [node.header, node.footer])])
	{
		if (value?.type != "content") continue;
		value.nodes.forEach(materializeNode);
	}

	const sourcesCount = crystallizeSources();
	for (const refs of relRefs.values())
		refs.next.forEach(r => r.warn());

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

	function isAppendixHeading(node: Runify<DocNode>)
	{
		return node.type == "title" && node.level == 0 && node.text.map(r => r.text).join("").trim().toUpperCase() == "ПРИЛОЖЕНИЯ";
	}

	function getSectionPrefixes()
	{
		const numbers = new Map<Runify<NodeTitle>, number>();
		if (doc.numberingSections)
			for (const node of doc.nodes)
			{
				if (isAppendixHeading(node)) break;
				if (node.type != "title" || node.level == 0) continue;
				const text = node.text.map(rune => !rune.type || rune.type == "text" ? rune.text : "\uFFFC").join("");
				const match = /^\s*(\d+)\.?(?=\s|$)/.exec(text);
				const num = Number(match?.[1]);
				if (Number.isFinite(num) && num > 0) numbers.set(node, num);
			}

		const prefixes = new Map<Runify<NodeTitle>, string>();
		let l1 = 0;
		let inAppendix = false;
		for (const node of doc.nodes)
		{
			if (node.type != "title") continue;
			if (node.level == 0) l1 = 0;
			if (isAppendixHeading(node))
			{
				inAppendix = true;
			}
			if (node.level == 1)
				l1 = getTitleNum(node) || l1 + 1;
			if (inAppendix)
			{
				if (node.level == 1) prefixes.set(node, APPENDIX_NAME[l1 - 1] + ".");
				continue;
			}
			if (!doc.numberingSections) continue;
			const num = numbers.get(node);
			const firstRune = node.text.find(rune => rune.text.trim());
			const tag = firstRune?.text.replaceAll(/\s+/g, "").replace(/[-+]\d+$/, "") || "";
			const autoNumber = firstRune?.type == "ref" && !relRefs.has(tag);
			if (num || node.level == 1 && (!numbers.size || autoNumber))
				prefixes.set(node, `${num || l1}.`);
		}
		return prefixes;
	}

	function getTitleNum(node: Runify<NodeTitle>)
	{
		const rune = node.text.find(r => r.text.trim());
		if (!rune || rune.type == "ref") return null;
		const m = /^\s*(\d+)/.exec(rune.text);
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
		const firstRune = runes.find(rune => rune.text.trim());
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
			const refs = relRefs.get(tag);
			if (refs)
			{
				const ref = rune.text;
				const warn = () => warnAt(node.sourceLine, `Неизвестная ссылка [${ref}]`);
				const resolve = ({ n, prefix }: ObjNum) =>
				{
					rune.type = "text";
					rune.text = `${prefix}${applyMath(n)}`;
				};
				if (mathSubstarct)
				{
					if (refs.prev) resolve({ ...refs.prev, n: refs.prev.n + 1 });
					else warn();
				}
				else refs.next.push({ resolve, warn });
				return;
			}
			if (type == "title" && rune == firstRune)
			{
				const num = counter.titles[`l${node.level}` as TtKeys];
				if (appendix)
				{
					const char = APPENDIX_NAME[counter.titles.l1 - 1];
					if (v instanceof Array) v.forEach(fn => fn.f(-1, char));
					named[tag] = { n: -1, prefix: char };
					rune.type = "text";
					rune.text = "ПРИЛОЖЕНИЕ" + (doc.typography.nbsp.references ? "\u00A0" : " ") + char;
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
					let removeSeparator = true;
					for (let j = i + 1; j < runes.length; j++)
					{
						const nextRune = runes[j]!;
						if ((nextRune.type && nextRune.type != "text") || nextRune.mono) break;
						nextRune.text = nextRune.text.trimStart();
						if (!nextRune.text) continue;
						if (removeSeparator)
						{
							if (nextRune.text[0] == "-") nextRune.text = nextRune.text.slice(1);
							if (nextRune.text[0] == "\u2013") nextRune.text = nextRune.text.slice(1);
							nextRune.text = nextRune.text.trimStart();
							removeSeparator = false;
							if (!nextRune.text) continue;
						}
						nextRune.text = toCapitalCase(nextRune.text);
						break;
					}
					const hasTitle = runes.some((other, index) => index != i && other.text.trim());
					text = `${text} ${prefix}${num}${hasTitle ? " \u2013 " : ""}`;
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
				rune.text = v.n < 0 ? v.prefix : `${v.prefix}${applyMath(v.n)}`;
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
	const reTypedRef = /^[itcf]#(?:\s*[-+]\s*\d+)?$/;
	doc.nodes.forEach(node =>
	{
		if (node.type == "math" && !node.title) node.title = [{ text: "(", type: "text" }, { text: "#", type: "ref" }, { text: ")", type: "text" }];
		const runes = (node.type == "code" || node.type == "table") ? node.title
			: node.type == "image" ? node.text : null;
		if (!runes?.some(rune => rune.text.trim())) return;
		if (runes.some(rune => rune.type == "ref" && !reTypedRef.test(rune.text))) return;
		runes.splice(0, 0, { text: "#", type: "ref" });
	});
}
