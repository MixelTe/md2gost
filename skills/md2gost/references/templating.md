# Markdown-вставки, шаблоны и JS API

Читай, когда документ собирается из нескольких файлов, когда один шаблон заполняется разными
данными (несколько вариантов отчёта, документы для группы студентов) или когда md2gost
вызывается из кода.

## Markdown-вставки

```md
# Отчёт

!!(chapters/01-analysis.md){}

!!(chapters/02-design.g.md){}
```

Содержимое `.md`/`.g.md` раскрывается в документ **до рендера** и становится его частью: внутри
работает весь синтаксис md2gost, включая `!!rule`, `!!section` и вложенные вставки. Пути внутри
вставки — относительно самой вставки; пути к картинкам при раскрытии исправляются сами.
Нумерация рисунков и ссылок сквозная по всему документу. Markdown-вставки работают и в DOCX без
Word (в отличие от вставок DOCX/PDF).

## Переменные

```md
!!(blocks/student.md){
    "student": { "name": "Иванов И. И.", "group": "КЛМН-01", "scores": [5, 4, 5] }
}
```

В `blocks/student.md`:

```md
# {{student.name}}

Группа: {{student.group}}, первая оценка: {{student.scores[0]}}
```

- Параметры — JSON (допускаются комментарии и висячие запятые).
- Вложенная вставка наследует переменные родителя; параметры вставки их переопределяют.
- Значение по умолчанию: `{{name || "Без имени"}}` (сработает при отсутствии, `null`, `false`,
  `0`, `""`), `{{comment ?? "—"}}` (только при отсутствии или `null`). Кавычки и слеш внутри
  строки экранируются обратным слешем.
- Объект или массив передаётся во вложенную вставку без превращения в строку, если значение
  состоит из одной переменной: `!!(table.md){"rows": "{{student.rows}}"}`.
- Неизвестная переменная — предупреждение, маркер остаётся в тексте как есть.
- Буквальные `{{…}}` — `\{{name}}`; буквальное `<!--` — `{{"<!--"}}`.

В **главном** документе `{{…}}` не обрабатывается, пока переменные не переданы через
`MDRenderConfig.variables` (см. API ниже); из CLI их передать нельзя. Поэтому шаблонную часть
выноси во вставки.

## Условия и циклы

```md
{{#if showResults}}
## Результаты
{{#for result, index in results}}
{{index + 1}}. {{result}}
{{:else}}
Результатов пока нет.
{{/for}}
{{:else}}
Раздел скрыт.
{{/if}}
```

- `{{#if выражение}}` — переменная или сравнение: `{{#if score >= 5}}`.
- `{{#for value in items}}`, `{{#for value, key in items}}` — массив, объект, строка или целое
  число (повтор N раз). `{{:else}}` необязателен и срабатывает для ложного условия или пустого
  цикла. Блоки вкладываются.
- В выражениях: переменные, строки, числа, `true`, `false`, `null` и одно бинарное действие.
  Арифметика `+ - * / // % **`; сравнения `== != < <= > >= in`; логика `and or && || ??`.
- Пробелы вокруг выражения убираются дефисом: `{{- name -}}`, `{{- name }}`. Для вставки на
  отдельной строке: `!!(-chapter.md-){}` убирает пробелы вокруг директивы, `!!(--chapter.md--){}`
  — ещё и крайние пробелы внутри вставленного текста.

## JS API

```ts
import renderMarkdown, { MDRenderError } from "md2gost";

try {
    const result = await renderMarkdown({
        input: "./report.g.md",
        output: "./dist/report.docx",   // или папка "./dist/"; по умолчанию рядом с input
        format: "docx",                 // "pdf" — только Windows + Word
        disableMacros: true,            // обязательно вне Windows с Word
        variables: { author: "Иванов И. И.", showResults: true, results: ["Первый", "Второй"] },
        progress: (percent, message) => console.log(`${percent}% ${message}`),
    });
    result.warnings.forEach(w => console.warn(w));
    console.log(result.filePath);
} catch (e) {
    if (e instanceof MDRenderError) console.error(e.code, e.message, e.warnings);
    else throw e;
}
```

`MDRenderConfig`:

| Поле | Назначение |
|---|---|
| `input` | путь к `.g.md` |
| `output` | файл `.docx`/`.pdf` или папка |
| `format` | `"docx"` или `"pdf"`; по умолчанию из расширения `output`, иначе docx |
| `disableMacros` | `true` — рендер целиком в Node.js, без Word и PowerShell; PDF недоступен |
| `keepIntermediateDocx` | оставить DOCX после PDF |
| `checkFilesIsInsidePath` | папка, за пределы которой нельзя ссылаться; `""` — папка input; `false` — без проверки |
| `variables` | переменные для главного документа (включают в нём шаблонизацию) |
| `templateOptions` | `allowLoops`, `allowIncludes` и лимиты: `maxLoopIterations`, `maxTotalIterations`, `maxDepth`, `maxIncludeDepth`, `maxIncludes`, `maxFileLength`, `maxTotalInputLength`, `maxGeneratedLength` |
| `progress`, `logger`, `abortSignal` | прогресс, логирование, отмена |

Коды `MDRenderError.code`: `userInput` (ошибка в документе или путях), `noWin` (макросы или PDF
не на Windows), `noPS`/`inPS` (PowerShell или Word недоступны), `vba` (ошибка макроса Word),
`pdf` (экспорт PDF не удался), `unknown`. При `noWin` DOCX уже записан, путь в
`error.renderedFile`. Отсутствующая картинка сейчас приходит с кодом `unknown` и сообщением
`Line N: File not exist: …`.

Для шаблонов из чужих источников ограничь `templateOptions` (например,
`allowIncludes: false`, небольшие `maxTotalIterations` и `maxGeneratedLength`) и не отключай
`checkFilesIsInsidePath`.
