import type { DocNode, NodeTitle, Rune, RunicDoc, Runify } from "./doc";
import { repeat, toCapitalCase } from "./utils";

export function alchemist(doc: RunicDoc)
{
	const counter = {
		codesAll: 0,
		imgsAll: 0,
		tablesAll: 0,
		codes: 0,
		imgs: 0,
		tables: 0,
		titles: { l1: 0, l2: 0, l3: 0, l4: 0, l5: 0 },
	};
	type TtKeys = keyof typeof counter["titles"];
	const named: { [name: string]: { n: number, prefix: string } | ((n: number, prefix: string) => void)[] } = {};
	const vals: { [name: string]: ((n: number) => void)[] } = {};
	let prevNum = -1;
	let prevPrefix = "";
	let nextNum = -1;
	let nextPrefix = "";
	let prefix = "";

	if (doc.numberingLazy) addLazyNumbering(doc);

	doc.nodes.forEach((node, i) =>
	{
		if (nextNum < 0)
		{
			let l1 = counter.titles.l1;
			let codes = counter.codes;
			let imgs = counter.imgs;
			let tables = counter.tables;
			for (let j = i; j < doc.nodes.length && nextNum < 0; j++)
			{
				const n = doc.nodes[j];
				if (n.type == "code") nextNum = codes + 1;
				if (n.type == "image") nextNum = imgs + 1;
				if (n.type == "table") nextNum = tables + 1;
				if (n.type == "title" && n.level == 1 && doc.numberingSections)
				{
					const num = getTitleNum(n);
					if (num) l1 = num;
					else l1++;
					codes = 0;
					imgs = 0;
					tables = 0;
				}
			}
			nextPrefix = l1 > 0 && doc.numberingSections ? `${l1}.` : "";
		}

		if (node.type == "title")
		{
			for (let i = 1; i <= 5; i++)
			{
				if (i == node.level) counter.titles[`l${i}` as TtKeys]++;
				if (i > node.level) counter.titles[`l${i}` as TtKeys] = 0;
			}
			if (node.level == 1)
			{
				const num = getTitleNum(node);
				if (num) counter.titles.l1 = num;
				if (doc.numberingSections)
				{
					counter.codes = 0;
					counter.imgs = 0;
					counter.tables = 0;
				}
				prefix = doc.numberingSections ? `${counter.titles.l1}.` : "";
			}
		}

		if ("text" in node && node.text)
			materializeRunes(node.text, node);
		if ("title" in node && node.title)
			materializeRunes(node.title, node);

		if (node.type == "code" || node.type == "image" || node.type == "table")
		{
			if (node.type == "code") { counter.codes++; counter.codesAll++; }
			if (node.type == "image") { counter.imgs++; counter.imgsAll++; }
			if (node.type == "table") { counter.tables++; counter.tablesAll++; }
			prevNum = nextNum;
			prevPrefix = prefix;
			nextNum = -1;
		}
	});

	vals["codes"]?.forEach(f => f(counter.codes));
	vals["imgs"]?.forEach(f => f(counter.imgs));
	vals["tables"]?.forEach(f => f(counter.tables));

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
			const m = /^(.*?)([-\+]\d+)?$/.exec(rune.text.replaceAll(/\s+/g, ""));
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
				const prefix = node.level <= 1 ? "" : repeat(node.level - 1, i => counter.titles[`l${i + 1}` as TtKeys]).join(".") + ".";
				if (v instanceof Array) v.forEach(fn => fn(num, prefix));
				named[tag] = { n: num, prefix };
				rune.type = "text";
				rune.text = repeat(node.level, i => counter.titles[`l${i + 1}` as TtKeys]).join(".");
				return;
			}
			if (type == "code" || type == "image" || type == "table")
			{
				let { num, text } =
					type == "code" ? { num: counter.codes, text: "Листинг" } :
						type == "image" ? { num: counter.imgs, text: "Рисунок" } :
							type == "table" ? { num: counter.tables, text: "Таблица" } : (() => { throw new Error("switch default"); })();
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
				}
				else text = `${prefix}${num}`;
				if (v instanceof Array) v.forEach(fn => fn(num, prefix));
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
				const fn = (n: number, prefix: string) =>
				{
					rune.type = "text";
					rune.text = `${prefix}${applyMath(n)}`;
				};
				if (v) v.push(fn);
				else named[tag] = [fn];
			}
			else
			{
				rune.type = "text";
				rune.text = `${v.prefix}${applyMath(v.n)}`;
			}
		});
	}
}

function addLazyNumbering(doc: RunicDoc)
{
	doc.nodes.forEach(node =>
	{
		const runes = (node.type == "code" || node.type == "table") ? node.title
			: node.type == "image" ? node.text : null;
		if (!runes) return;
		if (runes.find(rune => rune.type == "ref")) return;
		runes.splice(0, 0, { text: "#", type: "ref" });
	});
}

