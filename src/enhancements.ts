import { InlineCompletionItem, TextDocument, Position, CompletionItem, CompletionItemKind, Hover, InlayHint, SnippetString, MarkdownString, Range, InlayHintKind } from "vscode";

export function md_completion(document: TextDocument, position: Position): CompletionItem[] | undefined
{
	const line = document.lineAt(position);
	const linePrefix = line.text.slice(0, position.character);
	// if (!linePrefix.startsWith("!")) return;
	const r = [] as CompletionItem[];
	if (linePrefix == "!" || linePrefix == "")
	{
		const item = new CompletionItem({
			label: "Вставить docx",
			description: "!(файл.docx){}"
		}, CompletionItemKind.Snippet);
		item.insertText = new SnippetString('!(${1:путькфайлу}){\n\t"${2:поле}": "${3:значение}",\n}');
		item.sortText = "!doc"
		item.documentation = new MarkdownString("Вставляет блок для вставки docx");
		item.documentation.appendCodeblock('!(путькфайлу){\n\t"поле": "значение",\n}')
		r.push(item);
	}
	const range = new Range(position, line.range.end);
	function addHint(text: string, word: string, detail: string, documentation?: string, sortText?: string)
	{
		const rem = { v: "" };
		if (completeWord(text, word, rem))
		{
			const i = text.lastIndexOf(" ");
			const label = i > 0 ? word.slice(i + 1) : word;
			const item = new CompletionItem({
				label,
				description: detail,
			}, CompletionItemKind.Constant);
			item.insertText = rem.v;
			item.range = range;
			item.documentation = new MarkdownString(documentation || detail);
			item.sortText = sortText;
			r.push(item);
			return item;
		}
	}
	addHint(linePrefix, "!!rule", "Вставить правило");
	if (linePrefix.startsWith("!!rule "))
	{
		const rule = linePrefix.slice("!!rule ".length);
		Object.values(Rules).forEach(v =>
		{
			addHint(rule, v.keyword, v.short, v.doc, v.sortText);
		});
	}
	if (linePrefix == "#" || linePrefix == "")
	{
		Headings.forEach((v, i) =>
		{
			const item = addHint(linePrefix, "# " + v.keyword, v.short, v.doc, `${i}`);
			if (item && v.text) item.insertText += v.text;
		});
	}
	return r;
}

const re_sep = /^(\s*:?-+:?\s*\|)+\s*:?-+:?\s*$/;
export function md_inlineCompletion(document: TextDocument, position: Position): InlineCompletionItem[] | undefined
{
	// if (!document.fileName.endsWith(".g.md")) return;
	if (position.line == 0) return;
	const line = document.lineAt(position);
	const lineText = line.text.trim();
	// const linePrefix = line.slice(0, position.character);
	if (lineText != "") return;
	const prevLine = document.lineAt(position.line - 1).text;
	if (prevLine.includes("|") && re_sep.test(prevLine))
		return [
			new InlineCompletionItem(
				prevLine.replaceAll(/[^|]/g, "-"),
				new Range(position, position)
			)
		];
	const m_olist = /^(\s*)(\d+)(.|\))/.exec(prevLine);
	if (m_olist)
		return [
			new InlineCompletionItem(
				`${m_olist[1]}${parseInt(m_olist[2]) + 1}${m_olist[3]} `,
				line.range
			)
		];
	const m_list = /^(\s*)(-|\*)/.exec(prevLine);
	if (m_list)
		return [
			new InlineCompletionItem(
				`${m_list[1]}${m_list[2]} `,
				line.range
			)
		];
}

export function md_hover(document: TextDocument, position: Position): Hover | undefined
{
	// const range = document.getWordRangeAtPosition(position);
	// const word = document.getText(range);
	const line = document.lineAt(position).text;
	if (line.startsWith("!!rule"))
	{
		const lineNorm = line.replaceAll(/\s+/g, " ").trim().toLowerCase();

		for (const { keyword, doc } of Object.values(Rules))
		{
			if (!lineNorm.startsWith("!!rule " + keyword)) continue;
			const content = new MarkdownString();
			content.appendCodeblock("!!rule " + keyword);
			content.appendMarkdown(doc);
			return new Hover(content);
		}
	}
	if (line.startsWith("#"))
	{
		const lineNorm = line.trim().toUpperCase();
		for (const { keyword, doc } of Headings)
		{
			if (lineNorm != "# " + keyword) continue;
			return new Hover(new MarkdownString(doc));
		}
	}
}

export function md_inlineHints(document: TextDocument, range: Range): InlayHint[] | undefined
{
	const hints: { position: number, label: string, paddingLeft?: boolean, paddingRight?: boolean }[] = [];
	const textFull = document.getText();
	const text = document.getText(range);
	const startOffset = document.offsetAt(range.start);
	const autoprefix = !/^!!rule numbering autoprefix off\s*$/im.test(textFull);
	if (!autoprefix) return;
	const lazy = /^!!rule numbering lazy(| on)\s*$/im.test(textFull);
	const sections = /^!!rule numbering sections(| on)\s*$/im.test(textFull);

	const re_code = /^(```[^\s]+)(.*)$/gm;
	const codeMatches = Array.from(text.matchAll(re_code)).map(m => (
		{ m, index: m.index!, type: "code" as const }
	));

	const re_img = /^!\[(.*)\]\((.*)\)({(.*)})?$/gm;
	const imgMatches = Array.from(text.matchAll(re_img)).map(m => (
		{ m, index: m.index!, type: "img" as const }
	));

	const re_table = /^(\r?\n)(.*)\r?\n\r?\n.*\r?\n(\s*:?-+:?\s*\|)+\s*:?-+:?\s*$/gm;
	const tableMatches = Array.from(text.matchAll(re_table)).map(m => (
		{ m, index: m.index!, type: "table" as const }
	));

	const allMatches = [...codeMatches, ...imgMatches, ...tableMatches].sort((a, b) => a.index - b.index);

	for (const m of allMatches)
	{
		const num = sections ? "#.#" : "#";
		const { shift, text, prefix } =
			m.type == "code" ? { shift: m.m[1].length, text: m.m[2], prefix: "Листинг" }
				: m.type == "img" ? { shift: 2, text: m.m[1], prefix: "Рисунок" }
					: m.type == "table" ? { shift: m.m[1].length, text: m.m[2], prefix: "Таблица" }
						: (() => { throw new Error("switch default") })();
		const tag = /^\s*\[([a-zA-Zа-яА-ЯёЁ_\d]+|#)\]/.exec(text);
		if (!lazy && !tag) continue;
		let position = m.index + shift;
		if (tag) position += tag[0].length;
		const space = text.at(tag ? tag[0].length : 0) == " " ? "" : " ";
		hints.push({ position, label: `${prefix} ${num} -${space}`, paddingLeft: !!tag || m.type == "code" });
	}

	return hints.map(hint =>
	{
		const pos = document.positionAt(startOffset + hint.position);
		const h = new InlayHint(pos, hint.label, InlayHintKind.Type);
		h.paddingLeft = hint.paddingLeft;
		h.paddingRight = hint.paddingRight;
		return h;
	});
}

function completeWord(text: string, word: string, rem: { v: string })
{
	if (text.toLowerCase() != word.slice(0, text.length).toLowerCase()) return false;
	rem.v = word.slice(text.length)
	return true;
}

const Rules: Record<string, {
	keyword: string,
	short: string,
	doc: string,
	sortText?: string,
}> = {
	numbering_lazy: {
		keyword: "numbering lazy",
		short: "Ленивая автонумерация",
		doc: "Включить ленивую нумерацию\n\nКогда включено, более не нужно писать `[#]` в названиях картинок, таблиц и т.д. - добавляется автоматически",
		sortText: "1",
	},
	title: {
		keyword: "title",
		short: "Заголовок документа",
		doc: "Добавить заголовок документа",
		sortText: "2",
	},
	author: {
		keyword: "author",
		short: "Автора документа",
		doc: "Указать автора документа",
	},
	backtick_mono_on: {
		keyword: "backtick_mono on",
		short: "Рендерить моношрифт",
		doc: "Рендерить ``` `монотекст` ``` как моношрифт\n\nПо умолчанию рендерится как курсив",
	},
	backtick_mono_outline: {
		keyword: "backtick_mono outline",
		short: "Моношрифт в рамке",
		doc: "Рендерить ``` `монотекст` ``` как моношрифт в рамке",
	},
	ctime: {
		keyword: "ctime",
		short: "Указать время создания",
		doc: "Указать время создания",
	},
	etime: {
		keyword: "etime",
		short: "Указать время редактирования в минутах",
		doc: "Указать время редактирования в минутах",
	},
	highlight_code: {
		keyword: "highlight code",
		short: "Подсветка синтаксиса",
		doc: "Включить подсветку синтаксиса в блоках кода",
	},
	mtime: {
		keyword: "mtime",
		short: "Указать время изменения",
		doc: "Указать время изменения",
	},
	numbering_autoprefix_off: {
		keyword: "numbering autoprefix off",
		short: "Отключить авто-добавление префикса",
		doc: "Отключить авто-добавление префикса в подписях автонумерации",
	},
	numbering_sections: {
		keyword: "numbering sections",
		short: "Автонумерация в формате 1.1",
		doc: "Автонумерация в формате 1.1",
	},
	rainbow: {
		keyword: "rainbow",
		short: "Радуга",
		doc: "Радуга",
	},
}
const Headings: {
	keyword: string,
	text?: string,
	short: string,
	doc: string,
	sortText?: string,
}[] = [{
	keyword: "РЕФЕРАТ",
	text: '\nКлючевые, слова, 5-15 ШТУК\n\nТекст реферата на одной странице.',
	short: "",
	doc: `### Раздел документа: Реферат
Ключевое слово для вставки реферата в документ.\n
При рендере добавляет строку с кол-вом страниц, картинок и т.д. Ключевые слова автоматически приводятся к верхнему регистру. Добавляется перенос страницы.\n
#### Требуемый формат раздела:
\`\`\`md
# РЕФЕРАТ
Ключевые, слова, 5-15 ШТУК

Текст реферата.
\`\`\`
#### Результат рендера:
\`\`\`md
# РЕФЕРАТ
Отчет x с., x рис., x табл., x лист., x источн.
КЛЮЧЕВЫЕ, СЛОВА, 5-15 ШТУК
Текст реферата на одной странице.
<разрыв страницы>
\`\`\``,
},
{
	keyword: "ОГЛАВЛЕНИЕ",
	short: "",
	doc: `### Раздел документа: Оглавление
Ключевое слово для вставки автогенерируемого оглавления в документ.\n
#### Требуемый формат раздела:
\`\`\`md
# ОГЛАВЛЕНИЕ
\`\`\`
#### Результат рендера:
\`\`\`md
# ОГЛАВЛЕНИЕ
  ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ................  5
  ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ....  6
  ВВЕДЕНИЕ.............................  7
  1 ОБЩИЕ СВЕДЕНИЯ.....................  8
	  1.1 Lorem ipsum dolor sit .......  8
	  1.2 Architect solute ex optic....  8
  ЗАКЛЮЧЕНИЕ .......................... 10
  СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ .... 11
<разрыв страницы>
\`\`\``,
},
{
	keyword: "ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ",
	text: '\n* Термин: Определение после двоеточия\n* Термин: Определение после двоеточия',
	short: "",
	doc: `### Раздел документа: Термины и определения
Ключевое слово для вставки терминов и определений в документ.\n
Термин отделяется двоеточием. При рендере список преобразуется в таблицу. Добавляется перенос страницы.\n
#### Требуемый формат раздела:
\`\`\`md
# ТЕРМИНЫ И ОПРЕДЕЛЕНИЯ
* Термин: Определение после двоеточия
* DOM: Объектная модель документа, обеспечивающая программный доступ к структуре HTML-страницы.
* Git: Система контроля версий, позволяющая отслеживать изменения в проекте и управлять разработкой.
\`\`\`
#### Результат рендера:
\`\`\`
# ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ
В настоящем отчете применяются следующие термины с соответствующими определениями.
Термин | Определение
-------|-------------
Термин | Определение после двоеточия
DOM    | Объектная модель документа, обеспечивающая программный доступ к структуре HTML-страницы.
Git    | Система контроля версий, позволяющая отслеживать изменения в проекте и управлять разработкой.
<разрыв страницы>
\`\`\``,
},
{
	keyword: "ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ",
	text: '\n* Обозначение - описание\n* Обозначение - описание',
	short: "",
	doc: `### Раздел документа: Перечень сокращений и обозначений
Ключевое слово для вставки перечня сокращений и обозначений в документ.\n
#### Требуемый формат раздела:
\`\`\`md
# ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ
* Обозначение - описание
* HTML - HyperText Markup Language
* JS - JavaScript
\`\`\`
#### Результат рендера:
\`\`\`
# ПЕРЕЧЕНЬ СОКРАЩЕНИЙ И ОБОЗНАЧЕНИЙ
В настоящем отчете применяют следующие сокращения и обозначения.
* Обозначение - описание
* HTML - HyperText Markup Language
* JS - JavaScript
<разрыв страницы>
\`\`\``,
},
{
	keyword: "ВВЕДЕНИЕ",
	short: "",
	doc: `### Раздел документа: Введение
Ключевое слово для вставки введения в документ.\n
#### Требуемый формат раздела:
\`\`\`md
# ВВЕДЕНИЕ
\`\`\`
#### Результат рендера:
\`\`\`
# ВВЕДЕНИЕ
Текст
<разрыв страницы>
\`\`\``,
},
{
	keyword: "ЗАКЛЮЧЕНИЕ",
	short: "",
	doc: `### Раздел документа: Заключение
Ключевое слово для вставки заключения в документ.\n
#### Требуемый формат раздела:
\`\`\`md
# ЗАКЛЮЧЕНИЕ
\`\`\`
#### Результат рендера:
\`\`\`
# ЗАКЛЮЧЕНИЕ
Текст
<разрыв страницы>
\`\`\``,
},
{
	keyword: "СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ",
	text: '\n[id_источника] Источник\n[id_источника] Источник',
	short: "",
	doc: `### Раздел документа: Список использованных источников
Ключевое слово для вставки списка источников в документ.\n
Вместо номера источника указывается его id по которому далее можно ссылаться (см. автонимерация). При рендере источники сортируются в порядке первого упоминания в тексте документа.\n
#### Требуемый формат раздела:
\`\`\`md
# СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ
[id_источника] Источник
[пособие] Куликов, А. А. Разработка интернет ресурсов : учебное пособие / А. А. Куликов, А. А. Русляков. — Москва : РТУ МИРЭА, 2023. — 306 с. — ISBN 978-5-7339-2047-4. — Текст : электронный // Лань : электронно-библиотечная система. — URL: https://e.lanbook.com/book/398264 (дата обращения: 18.11.2025). — Режим доступа: для авториз. пользователей.
[mdn] Документация MDN Web Docs [Электронный ресурс].: URL: https://developer.mozilla.org/, режим доступа: свободный (дата обращения: 18.11.2025).
\`\`\`
#### Результат рендера:
\`\`\`
# СПИСОК ИСПОЛЬЗОВАННЫХ ИСТОЧНИКОВ
1. Источник
2. Куликов, А. А. Разработка интернет ресурсов : учебное пособие / А. А. Куликов, А. А. Русляков. — Москва : РТУ МИРЭА, 2023. — 306 с. — ISBN 978-5-7339-2047-4. — Текст : электронный // Лань : электронно-библиотечная система. — URL: https://e.lanbook.com/book/398264 (дата обращения: 18.11.2025). — Режим доступа: для авториз. пользователей.
3. Документация MDN Web Docs [Электронный ресурс].: URL: https://developer.mozilla.org/, режим доступа: свободный (дата обращения: 18.11.2025).
\`\`\``,
},
	]
