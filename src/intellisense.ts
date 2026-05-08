import { CodeLens, InlineCompletionItem, TextDocument, Position, CompletionItem, CompletionItemKind, Hover, InlayHint, SnippetString, MarkdownString, Range, InlayHintKind, type CodeLensProvider, workspace, EventEmitter, type ExtensionContext, Diagnostic, languages, DiagnosticSeverity, window, type TextEditor } from "vscode";
import { choice, repeat } from "./utils";

export function md_completion(document: TextDocument, position: Position): CompletionItem[] | undefined
{
	const line = document.lineAt(position);
	const linePrefix = line.text.slice(0, position.character);
	// if (!linePrefix.startsWith("!")) return;
	const res = [] as CompletionItem[];
	if (linePrefix == "!" || linePrefix == "")
	{
		const item = new CompletionItem({
			label: "Вставить docx",
			description: "!(файл.docx){}"
		}, CompletionItemKind.Snippet);
		const p = linePrefix ? "" : "!";
		item.insertText = new SnippetString(p + '!(${1:путькфайлу}){\n\t"${2:поле}": "${3:значение}",\n}\n!!section from 2');
		item.sortText = "!doc";
		item.documentation = new MarkdownString("Вставляет блок для вставки docx");
		item.documentation.appendCodeblock('!(путькфайлу){\n\t"поле": "значение",\n}');
		res.push(item);
	}
	if (linePrefix == "")
	{
		const item = new CompletionItem({
			label: "Вставить таблицу",
			description: "Insert table"
		}, CompletionItemKind.Snippet);
		item.insertText = new SnippetString('${1:h1} | ${2:h2}\n---|---\n${3:v1} | ${4:v2}\n');
		item.sortText = "!table";
		res.push(item);
	}
	const range = new Range(position, line.range.end);
	function addHint(text: string, words: string | string[], detail: string, documentation?: string, deft?: string | (() => string), options?: string[], mod?: (item: CompletionItem) => void)
	{
		const rem = { v: "" };
		words = typeof words == "string" ? [words] : words;
		for (const word of words)
		{
			let f = false;
			for (const option of ["", ...(options || [])])
			{
				const w = option ? word + " " + option : word;
				if (!completeWord(text, w, rem)) continue;
				f = true;

				const i = text.lastIndexOf(" ");
				const label = i > 0 ? w.slice(i + 1) : w;
				const item = new CompletionItem({
					label,
					description: detail,
				}, CompletionItemKind.Constant);
				item.insertText = rem.v;
				if (!option && deft) item.insertText += " " + (typeof deft == "function" ? deft() : deft);
				item.sortText = item.insertText;
				item.range = range;
				item.documentation = new MarkdownString(documentation || detail);
				mod?.(item);
				res.push(item);
				if (!option) return;
			}
			if (f) return;
		}
	}
	addHint(linePrefix, "!!rule ", "Вставить правило", undefined, undefined, undefined, item =>
		item.command = { command: "editor.action.triggerSuggest", title: "Trigger Suggest" }
	);
	addHint(linePrefix, "!!section ", "Вставить разрыв секции");
	addHint(linePrefix, "!!section from", "", undefined, "2", undefined, item => item.label = { label: "!!section from", description: "Начать нумерацию страниц" });
	if (linePrefix.startsWith("!!rule "))
	{
		const rule = linePrefix.slice("!!rule ".length);
		Object.values(Rules).forEach(v =>
		{
			if (v.deprecated) return;
			addHint(rule, v.keyword, v.short, v.doc, v.default, v.options, it =>
			{
				it.sortText = v.sortText;
			});
		});
	}
	if (linePrefix == "#" || linePrefix == "")
	{
		Headings.forEach((v, i) =>
		{
			addHint(linePrefix, "# " + v.keyword, v.short, v.doc, undefined, undefined, it =>
			{
				it.sortText = `${i}`;
				if (v.text) it.insertText += v.text;
			});
		});
	}
	return res;
}

export function md_inlineCompletion(document: TextDocument, position: Position): InlineCompletionItem[] | undefined
{
	// if (!document.fileName.endsWith(".g.md")) return;
	if (position.line == 0) return;
	const line = document.lineAt(position);
	const lineText = line.text.trim();
	// const linePrefix = line.slice(0, position.character);
	if (lineText != "") return;
	const prevLine = document.lineAt(position.line - 1).text;
	if (prevLine.includes("|") && (position.line - 2 < 0 || !document.lineAt(position.line - 2).text.trim().includes("|")))
	{
		return [
			new InlineCompletionItem(
				prevLine.replaceAll(/[^|]/g, "-"),
				new Range(position, position)
			)
		];
	}
	const m_olist = /^(\s*)(\d+)(\.|\))\s/.exec(prevLine);
	if (m_olist)
		return [
			new InlineCompletionItem(
				`${m_olist[1]}${parseInt(m_olist[2]) + 1}${m_olist[3]} `,
				line.range
			)
		];
	const m_list = /^(\s*)(-|\*)\s/.exec(prevLine);
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

		for (const { keyword, doc, hint } of Object.values(Rules))
		{
			const keywords = typeof keyword == "string" ? [keyword] : keyword;
			for (const keyword of keywords)
			{
				if (!lineNorm.startsWith("!!rule " + keyword)) continue;
				const h = hint?.(keyword);
				const content = new MarkdownString();
				content.appendCodeblock("!!rule " + keyword);
				if (h) content.appendMarkdown(`\n\n${h}\n\n`);
				content.appendMarkdown(doc);
				return new Hover(content);
			}
		}
	}
	if (line.startsWith("!!section"))
	{
		const content = new MarkdownString();
		content.appendMarkdown("### Разрыв секции\n");
		content.appendText("Создаёт разрыв секции в документе.");
		content.appendCodeblock(`
!!section
Секция без нумерации страниц

!!section from 3
Секция с нумерацией страниц начиная с 3
`.trim());
		return new Hover(content);
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
	const config = workspace.getConfiguration("md2gost");
	const isEnabled = config.get<boolean>("ui.inlayHints", true);
	if (!isEnabled) return;
	const hints: { position: number, label: string, paddingLeft?: boolean, paddingRight?: boolean }[] = [];
	const textFull = document.getText();
	const text = document.getText(range);
	const startOffset = document.offsetAt(range.start);
	const autoprefix = !/^!!rule\s+numbering\s+autoprefix\s+off\s*$/im.test(textFull);
	if (!autoprefix) return;
	const lazy = /^!!rule\s+numbering\s+lazy(|\s+on)\s*$/im.test(textFull);
	const sections = /^!!rule\s+numbering\s+sections(|\s+on)\s*$/im.test(textFull);

	const re_code = /^(```[^\s]+)(.*)$/gm;
	const codeMatches = Array.from(text.matchAll(re_code)).map(m => (
		{ m, index: m.index!, type: "code" as const }
	));

	const re_img = /^!\[(.*)\]\((.*)\)({(.*)})?$/gm;
	const imgMatches = Array.from(text.matchAll(re_img)).map(m => (
		{ m, index: m.index!, type: "img" as const }
	));

	const re_table = /(([^\n]*)([\n\r\s]*)\r?\n)[^\n]*\r?\n\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/gms;
	const tableMatches = Array.from(text.matchAll(re_table)).map(m => (
		{ m, index: m.index!, type: "table" as const }
	));

	const allMatches = [...codeMatches, ...imgMatches, ...tableMatches].sort((a, b) => a.index - b.index);

	for (const m of allMatches)
	{
		let num = sections ? "#.#" : "#";
		let { shift, text, prefix } =
			m.type == "code" ? { shift: m.m[1].length, text: m.m[2], prefix: "Листинг" }
				: m.type == "img" ? { shift: 2, text: m.m[1], prefix: "Рисунок" }
					: m.type == "table" ? { shift: 0, text: m.m[2], prefix: "Таблица" }
						: (() => { throw new Error("switch default"); })();
		if (m.type == "table" && (
			text.trim() == "" || /^!|^#|^```|^\*\s|^-\s|^\d+(\)|\.)\s|\|/.test(text)
		)) continue;
		let tag = /^(.*?)\[([a-zA-Zа-яА-ЯёЁ_\d]+|#)\]/.exec(text);
		if (!lazy && !tag) continue;
		let position = m.index + shift;
		prefix += " ";
		let paddingLeft = !!tag || m.type == "code";
		if (tag)
		{
			if (tag[1].trim().toLowerCase() == prefix.trim().toLowerCase())
			{
				prefix = "";
				num = "";
				paddingLeft = false;
				position += tag[0].length;
			}
			else if (tag[1].trim()) tag = null;
			else position += tag[0].length;
		}
		const lbl = text.slice(tag ? tag[0].length : 0);
		const ending = lbl.trim()[0] == "-" ? (lbl[0] == " " ? "" : " ") : (lbl[0] == " " ? " -" : " - ");
		const label = prefix + num + ending;
		if (label)
			hints.push({ position, label, paddingLeft: paddingLeft });
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

export class TableCodeLensProvider implements CodeLensProvider
{
	private _onDidChangeCodeLenses = new EventEmitter<void>();
	readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;

	refresh() { this._onDidChangeCodeLenses.fire(); };
	private re_sep = /^\|?(\s*:?-+:?\s*\|)+\s*:?-+:?\s*\|?$/;
	private re_sep_oneCol = /^\|\s*:?-+:?\s*\|$/;
	public provideCodeLenses(document: TextDocument): CodeLens[]
	{
		const config = workspace.getConfiguration("md2gost");
		const isEnabled = config.get<boolean>("tables.editor.enabled", true);
		if (!isEnabled) return [];
		const lenses: CodeLens[] = [];
		const trim = (line: string) =>
		{
			line = line.trim();
			if (line.at(0) == "|") line = line.slice(1);
			if (line.at(-1) == "|") line = line.slice(0, -1);
			return line.trim();
		};

		for (let i = 1; i < document.lineCount; i++)
		{
			const _line = document.lineAt(i).text;
			const line = trim(document.lineAt(i).text);
			if (!this.re_sep.test(line) && !this.re_sep_oneCol.test(_line)) continue;
			const prevLine = document.lineAt(i - 1);
			const cols = line.split("|");
			const header = trim(prevLine.text).split("|").map(v => v.trim());
			if (header.length != cols.length) continue;
			while (i < document.lineCount)
			{
				const line = document.lineAt(i).text;
				if (line.trim() == "") break;
				i++;
			}
			const range = new Range(prevLine.range.start, document.lineAt(i - 1).range.end);
			lenses.push(new CodeLens(range, {
				title: "Edit table",
				tooltip: "Open table editor",
				command: "md2gost.edit_table",
				arguments: [document.uri, range]
			}));
		}
		return lenses;
	}

	public resolveCodeLens(codeLens: CodeLens): CodeLens
	{
		// codeLens.command = {
		// 	title: "Edit table",
		// 	tooltip: "Open table editor",
		// 	command: "md2gost.edit_table",
		// 	arguments: [document.uri, codeLens.range]
		// };
		return codeLens;
	}
}

export function addDiagnostic(context: ExtensionContext)
{
	const diagnosticCollection = languages.createDiagnosticCollection("md2gost");
	context.subscriptions.push(diagnosticCollection);

	function generateWarning(document: TextDocument)
	{
		const diagnostics: Diagnostic[] = [];

		for (let i = 0; i < document.lineCount; i++)
		{
			const line = document.lineAt(i);
			if (!line.text.startsWith("!!rule")) continue;

			const text = line.text.replaceAll(/\s+/g, " ").trim().toLowerCase();

			let rule = null as null | typeof Rules[string];
			let value = "";
			for (const r of Object.values(Rules))
			{
				const keywords = typeof r.keyword == "string" ? [r.keyword] : r.keyword;
				for (const keyword of keywords)
				{
					if (!text.startsWith("!!rule " + keyword)) continue;
					rule = r;
					value = text.slice(("!!rule " + keyword).length).trim();
					break;
				}
				if (rule) break;
			}
			if (!rule)
			{
				addWarn(`Неизвестное правило: ${text}`);
				continue;
			}
			if (((rule.type == "int" || rule.type == "string") && rule.options) || rule.type == "bool")
			{
				const options = rule.type == "bool" ? ["", "on", "off"] : rule.options!;
				if (options.findIndex(v => String(v) == value) < 0)
					addWarn(`Wrong value: "${value}". Допустимые: ${options.join(', ')}`);
				continue;
			}
			if (rule.checker)
			{
				const err = rule.checker(value);
				if (err)
					addWarn(`Wrong value: "${value}". Требуется: ${err}`,);
				continue;
			}
			if (rule.type == "string") continue;
			if (rule.type == "toggle")
			{
				if (value != "")
					addWarn(`Правило не принимает входный значений`,);
				continue;
			}
			if (rule.type == "int")
			{
				if (isNaN(parseInt(value)))
					addWarn(`Wrong value: "${value}". Ожидается целое число`);
				continue;
			}

			function addWarn(text: string)
			{
				diagnostics.push(new Diagnostic(line.range, text, DiagnosticSeverity.Warning));
			}
		}
		diagnosticCollection.set(document.uri, diagnostics);
	};

	function run(editor: TextEditor | undefined)
	{
		if (editor && editor.document.fileName.endsWith(".g.md"))
		{
			generateWarning(editor.document);
		}
	}

	context.subscriptions.push(
		window.onDidChangeActiveTextEditor(editor => run(editor))
	);
	run(window.activeTextEditor);
	context.subscriptions.push(
		workspace.onDidChangeTextDocument(event =>
		{
			const editor = window.activeTextEditor;
			if (editor && event.document == editor.document)
				run(editor);
		})
	);
}

function completeWord(text: string, word: string, rem: { v: string })
{
	if (text.toLowerCase() != word.slice(0, text.length).toLowerCase()) return false;
	rem.v = word.slice(text.length);
	return true;
}

const headingSelectors = repeat(5, n => `h${n + 1}`).map(v => [v, v + "+"]).flat();
function headingSelectorsHint(ln: string)
{
	const m = /headings h([1-6])(\+?)/.exec(ln);
	if (!m) return "";
	const level = m[1];
	const plus = m[2] == "+";
	return "*Стиль заголовка " + (
		{
			"1": "первого",
			"2": "второго",
			"3": "третьего",
			"4": "четвёртого",
			"5": "пятого",
			"6": "шестого",
		}[level]
	) + (plus ? " и последующих уровней*" : " уровня*")
}

const Rules: Record<string, {
	keyword: string | string[],
	type: "bool" | "int" | "string" | "toggle",
	short: string,
	doc: string,
	sortText?: string,
	default?: string | (() => string),
	options?: string[],
	hint?: (line: string) => string,
	checker?: (line: string) => null | string,
	deprecated?: boolean,
}> = {
	numbering_lazy: {
		keyword: "numbering lazy",
		type: "bool",
		short: "Ленивая автонумерация",
		doc: "Включить ленивую нумерацию\n\nКогда включено, более не нужно писать `[#]` в названиях картинок, таблиц и т.д. - добавляется автоматически",
		sortText: "1",
	},
	title: {
		keyword: "title",
		type: "string",
		short: "Заголовок документа",
		doc: "Указать заголовок документа\n\n- Синтаксис: `!!rule title <text>`\n- Пример: `!!rule title Мой Отчет` \n- По умолчанию: `Document`",
		default: "Document",
		sortText: "2",
	},
	author: {
		keyword: "author",
		type: "string",
		short: "Автор документа",
		default: "Student",
		doc: "Указать автора документа\n\n- Синтаксис: `!!rule author <name>`\n- Пример: `!!rule author Иван Иванов` \n- По умолчанию: `Student`",
	},
	backtick_mono_off: {
		keyword: "backtick_mono off",
		type: "toggle",
		short: "Не рендерить моношрифт",
		doc: "Рендерить ``` `монотекст` ``` как обычный текст\n\nПо умолчанию рендерится как курсив",
	},
	backtick_mono_on: {
		keyword: "backtick_mono on",
		type: "toggle",
		short: "Рендерить моношрифт",
		doc: "Рендерить ``` `монотекст` ``` как моношрифт\n\nПо умолчанию рендерится как курсив",
	},
	backtick_mono_outline: {
		keyword: "backtick_mono outline",
		type: "toggle",
		short: "Моношрифт в рамке",
		doc: "Рендерить ``` `монотекст` ``` как моношрифт в рамке\n\nПо умолчанию рендерится как курсив",
	},
	ctime: {
		keyword: "ctime",
		type: "string",
		short: "Указать время создания",
		doc: "Установить время создания\n- Синтаксис: `!!rule ctime <ISO 8601>`\n- Пример: `!!rule ctime 2026-02-18`\n- По умолчанию время создания `.g.md` файла.",
		sortText: "timeC",
		default: () =>
		{
			const date = new Date();
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, "0");
			const day = String(date.getDate()).padStart(2, "0");
			return `${year}-${month}-${day}`;
		},
		checker: v => isNaN(Date.parse(v)) ? "значение в формате ISO 8601" : null,
	},
	etime: {
		keyword: "etime",
		type: "int",
		short: "Указать время редактирования в минутах",
		doc: "Установить время редактирования\n- Синтаксис: `!!rule etime <int>`\n- Пример: `!!rule etime 123`\n- По умолчанию случайное число от 30 до 120.",
		sortText: "timeE",
		default: "210",
	},
	highlight_code: {
		keyword: "highlight code",
		short: "Подсветка синтаксиса",
		doc: "Включить подсветку синтаксиса в блоках кода.",
		type: "bool",
		deprecated: true,
	},
	mtime: {
		keyword: "mtime",
		type: "string",
		short: "Указать время изменения",
		doc: "Установить время изменения\n- Синтаксис: `!!rule mtime <ISO 8601>`\n- Пример: `!!rule mtime 2026-02-18T12:30:00`\n- По умолчанию время рендера.",
		sortText: "timeM",
		default: () =>
		{
			const date = new Date();
			const year = date.getFullYear();
			const month = String(date.getMonth() + 1).padStart(2, "0");
			const day = String(date.getDate()).padStart(2, "0");
			const hour = String(date.getHours()).padStart(2, "0");
			const minutes = String(date.getMinutes()).padStart(2, "0");
			const seconds = String(date.getSeconds()).padStart(2, "0");
			return `${year}-${month}-${day}T${hour}:${minutes}:${seconds}`;
		},
		checker: v => isNaN(Date.parse(v)) ? "значение в формате ISO 8601" : null,
	},
	numbering_autoprefix: {
		keyword: "numbering autoprefix",
		type: "bool",
		short: "Авто-добавление префикса",
		doc: "Авто-добавление префикса в подписях автонумерации\n\n- Синтаксис: `!!rule numbering autoprefix <on|off>`\n- Пример: `!!rule numbering autoprefix off`\n- По умолчанию: on",
		default: "off",
	},
	numbering_sections: {
		keyword: "numbering sections",
		type: "bool",
		short: "Автонумерация в формате 1.1",
		doc: "Автонумерация в формате 1.1",
	},
	rainbow: {
		keyword: "rainbow",
		type: "toggle",
		short: choice("Радужный текст", "Градиентная радуга", "Радуга-дуга", "Шейдерная дискотека", "Заклятие Разноцветия"),
		doc: choice(
			"### 🌈 Режим «Прощай, диплом!»\n\nТекст окрашивается в цвета, которых не должно существовать в стенах технического вуза.\n\n**Зачем это нужно:**\nЕсли вы внезапно осознали, что *Times New Roman* и отступы по 1.25 см — это оковы системы, и решили превратить свой диплом в афишу рейв-вечеринки.\n\n> ⚠️ **Внимание:** После активации защита диплома автоматически превращается в стендап.\n\n* **Эффект:** Радуга, боль, слёзы проверяющего\n* **ГОСТ:** Ушёл в монастырь.\n* **Рекомендация:** Включать только после фразы «да и пофиг уже»",
			"### 🌈 Убийца ГОСТа v1.0\n\nМощная функция в этом расширении, которая активно борется с его предназначением. Пока другие фичи расставляют ссылки и ровняют таблицы, эта – просто устраивает карнавал.\n\n**Технические характеристики:**\n* **Читаемость:** Отрицательная.\n* **Соответствие стандартам:** 0%.\n* **Уровень иронии:** Запредельный.\n\n**Инструкция:** Использовать в паре с `!!rule ctime`, чтобы внуки могли точно знать дату и время, когда вы решили перестать быть инженером.",
			"### 🌈 Спецэффект «Вырвиглаз»\n\nВаш первый шейдер, написанный в три часа ночи по туториалу индуса с YouTube. Код состоит из костылей, магии и отчаяния, но зато ОНО ПЕРЕЛИВАЕТСЯ.\n\n**Почему это в серьезном софте:**\nЭто ваша личная «пасхалка». Если заказчик требует «сделать красиво» и добавить «сочности» в отчет по бурению скважин — просто жмите сюда.\n\n* **FPS комиссии:** Падает до 1 кадра в секунду.\n* **Bake Lighting:** Не поможет, тут всё горит само.\n* **Коллизии:** Текст проходит сквозь границы адекватности.\n\n**Важно:** Если ваш диплом не хоррор — он им станет.",
			"### 🌈 Ошибка Трансмутации\n\nВы пытались создать идеальный отчет, но что-то пошло не так, и из котла вылезло ЭТО. Вместо свинцовой серьезности вы получили радужную ртуть.\n\n**Алхимические свойства:**\nЭта функция полностью следует закону эквивалентного обмена. Вы получаете «красоту», но теряете возможность защититься. Текст становится настолько ярким, что сквозь него видно, как плачет ваш научный руководитель.\n\n- **Стабильность:** Критически низкая.\n- **Класс заклинания:** Школа Иллюзий (уровень: Безнадёга).\n* **Урон по рассудку:** +100.\n\n**Предупреждение:** Не смешивать с `!!rule highlight code`, иначе возможен разрыв в пространстве-времени.",
		) + "\n\n### **🧙‍♂️ Резонанс с Демиургом**\nЧувствуете, что инструменту не хватает важной детали? Если у вас есть идея полезной функции, которая упростит жизнь или просто добавит немного магии — пишите в [приемную верховного алхимика](https://github.com/MixelTe/md2gost/issues).\n\n*Примечание: Рациональные предложения сразу попадают в свиток планов, а для реализации безумных идей автору требуется приступ внезапного вдохновения.*",
	},

	headings_size: {
		keyword: headingSelectors.map(h => `headings ${h} size`),
		type: "int",
		short: "Размер заголовков",
		doc: "Установить размер заголовков\n\n- Синтаксис: `!!rule headings h<1-6>[+] size <int>`\n- Примеры:\n  - `!!rule headings h1 size 18` – установить размер 18 пт для заголовков первого уровня\n  - `!!rule headings h2+ size 14` – установить размер 14 пт для заголовков второго и последующих уровней\n- По умолчанию: 14 для всех заголовков",
		default: "14",
		hint: headingSelectorsHint,
	},
	headings_spacing_before: {
		keyword: headingSelectors.map(h => `headings ${h} spacing before`),
		type: "int",
		short: "Интервалы до заголовков",
		doc: "Установить интервал до заголовков\n\n- Синтаксис: `!!rule headings h<1-6>[+] spacing <before|after> <int>`\n- Пример: `!!rule headings h1 spacing before 10`\n- По умолчанию:\n  - h1 – before: 18; after: 4\n  - остальные – before: 8; after: 4",
		default: "4",
		hint: headingSelectorsHint,
	},
	headings_spacing_after: {
		keyword: headingSelectors.map(h => `headings ${h} spacing after`),
		type: "int",
		short: "Интервалы после заголовков",
		doc: "Установить интервал после заголовков\n\n- Синтаксис: `!!rule headings h<1-6>[+] spacing <before|after> <int>`\n- Пример: `!!rule headings h1 spacing after 10`\n- По умолчанию:\n  - h1 – before: 18; after: 4\n  - остальные – before: 8; after: 4",
		default: "4",
		hint: headingSelectorsHint,
	},
	headings_uppercase: {
		keyword: headingSelectors.map(h => `headings ${h} uppercase`),
		type: "bool",
		short: "Верхний регистр заголовков",
		doc: "Приводить заголовки к верхнему регистру\n\n- Синтаксис: `!!rule headings h<1-6>[+] uppercase`\n- Пример: `!!rule headings h1 uppercase`\n- По умолчанию: выключено для всех",
		hint: headingSelectorsHint,
	},
	headings_indent: {
		keyword: headingSelectors.map(h => `headings ${h} indent`),
		type: "string",
		short: "Отступ заголовков",
		doc: "Установить тип отступа заголовков\n\n- Синтаксис: `!!rule headings h<1-6>[+] indent <first_line|left>`\n- Пример: `!!rule headings h1 indent left`\n- По умолчанию: `first_line` для всех",
		default: "left",
		options: ["first_line", "left"],
		hint: headingSelectorsHint,
	},
	headings_alt_style_1: {
		keyword: "headings alt_style_1",
		type: "toggle",
		short: "Альтернативный стиль заголовков",
		doc: "Использовать готовый набор стилей заголовков\n\n- Синтаксис: `!!rule headings alt_style_1`\n- Может быть переопределён правилами ниже по документу\n- Эквивалентен набору стандартных `!!rule` для размеров, интервалов и выравнивания заголовков\n\n```\n!!rule headings h1+ indent left\n!!rule headings h1+ spacing after 10\n!!rule headings h1 size 18\n!!rule headings h1 uppercase\n!!rule headings h1 spacing before 0\n!!rule headings h2 size 16\n!!rule headings h2+ spacing before 15```",
	},
	hyphenation: {
		keyword: "hyphenation",
		type: "toggle",
		short: "Автоматические переносы",
		doc: "Включить автоматическую расстановку переносов\n\n- Синтаксис: `!!rule hyphenation`\n- По умолчанию: выключено",
	},
	table_title_style: {
		keyword: "table title style",
		type: "string",
		short: "Стиль названия таблицы",
		doc: "Установить начертание названия таблицы\n\n- Синтаксис: `!!rule table title style <normal|bold|italic>`\n- По умолчанию: `normal`",
		default: "italic",
		options: ["normal", "bold", "italic"],
	},
	table_heading_style: {
		keyword: "table heading style",
		type: "string",
		short: "Стиль заголовка таблицы",
		doc: "Установить начертание заголовков таблицы\n\n- Синтаксис: `!!rule table heading style <normal|bold|italic>`\n- Пример: `!!rule table heading style bold`\n- По умолчанию: `normal`",
		default: "bold",
		options: ["normal", "bold", "italic"],
	},
	table_heading_align: {
		keyword: "table heading align",
		type: "string",
		short: "Выравнивание заголовка таблицы",
		doc: "Установить выравнивание заголовков таблицы\n\n- Синтаксис: `!!rule table heading align <left|center|right>`\n- Пример: `!!rule table heading align left`\n- По умолчанию: `center`",
		default: "left",
		options: ["left", "center", "right"],
	},
	table_text_size: {
		keyword: "table text size",
		type: "int",
		short: "Размер текста таблицы",
		doc: "Установить размер шрифта текста таблицы\n\n- Синтаксис: `!!rule table text size <int>`\n- Пример: `!!rule table text size 10`\n- По умолчанию: `12`",
		default: "12",
	},
	code_title_style: {
		keyword: "code title style",
		type: "string",
		short: "Стиль названия листинга",
		doc: "Установить начертание названия листинга\n\n- Синтаксис: `!!rule code title style <normal|bold|italic>`\n- По умолчанию: `normal`",
		default: "italic",
		options: ["normal", "bold", "italic"],
	},
	code_highlight: {
		keyword: "code highlight",
		type: "bool",
		short: "Подсветка кода",
		doc: "Включить подсветку синтаксиса кода\n\n- Синтаксис: `!!rule code highlight`\n- По умолчанию: выключено",
	},
	list_unordered_style: {
		keyword: "list unordered style",
		type: "string",
		short: "Стиль ненумерованного списка",
		doc: "Установить стиль маркеров списка\n\n- Синтаксис: `!!rule list unordered style <dash|bullet|keep>`\n- `keep` – сохранять символ, использованный в исходном файле\n- Пример: `!!rule list unordered style keep`\n- По умолчанию: `bullet`",
		default: "keep",
		options: ["dash", "bullet", "keep"],
	},
	list_ordered_style: {
		keyword: "list ordered style",
		type: "string",
		short: "Стиль нумерованного списка",
		doc: "Установить стиль нумерации списка\n\n- Синтаксис: `!!rule list ordered style <bracket|dot|keep>`\n- `keep` – сохранять символ, использованный в исходном файле\n- Пример: `!!rule list ordered style keep`\n- По умолчанию: `bracket`",
		default: "keep",
		options: ["bracket", "dot", "keep"],
	},
	list_autopunctuation: {
		keyword: "list autopunctuation",
		type: "bool",
		short: "Автопунктуация списков",
		doc: "Автоматически расставлять знаки препинания в элементах списка\n\n- Синтаксис: `!!rule list autopunctuation <on|off>`\n- Пример: `!!rule list autopunctuation off`\n- По умолчанию: `on`",
		default: "off",
	},
};
const Headings: {
	keyword: string,
	text?: string,
	short: string,
	doc: string,
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
* Обозначение – описание
* HTML – HyperText Markup Language
* JS – JavaScript
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
	];
