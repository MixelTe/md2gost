# md2gost

Render Markdown files into formatted **DOCX** and **PDF** documents with automatic GOST formatting.

The project is available in two forms:

- **npm package** – CLI and JavaScript/TypeScript API.
- **[VS Code extension](https://marketplace.visualstudio.com/items?itemName=MixelTe.md2gost)** – editor integration with Markdown preview, DOCX viewer, table editor, and one-click export.

> 💡 The Markdown syntax and rendering engine are identical in both versions. All documentation below applies to both.

> 🤖 **For AI agents:** before writing or editing a report with md2gost, read the [md2gost-report skill](https://github.com/MixelTe/md2gost/blob/master/skills/md2gost-report/SKILL.md) and load its references as directed. You can follow these files for the current task without installing the skill. To locate the bundled copy, see [AI-agent skill](#ai-agent-skill).

## 👻 Быстрый старт
	## 👻 Quick start

### Installation

```bash
npm install md2gost
```

or install the CLI globally:

```bash
npm install -g md2gost
```

### CLI

Render a document:

```bash
md2gost report.md
```

Render directly to PDF:

```bash
md2gost report.md --format pdf
```

Specify an output path:

```bash
md2gost report.md -o dist/
md2gost report.md -o dist/report.docx
md2gost report.md -o dist/report.pdf
```

Show the utility version or bundled report skill metadata without rendering:

```bash
md2gost --version
md2gost --skill-info
```

`--skill-info` prints JSON: `version` is the utility version; `skill` contains its name, independent `version`, associated `md2gostVersion` and absolute path to `SKILL.md`.

Options:

| Option                           | Description                                 |
|----------------------------------|---------------------------------------------|
| `-V, --version`                 | Print the utility version                   |
| `--skill-info`                  | Print bundled report skill metadata as JSON |
| `-o, --output <path>`            | Output file or directory                    |
| `-f, --format <docx\|pdf>`       | Output format                               |
| `--engine <auto\|word\|libreoffice>` | Office postprocessor (default: auto)     |
| `-k, --keep-intermediate-docx`   | Keep intermediate DOCX after PDF generation |
| `-d, --disable-macros`           | Disable office postprocessing (PDF unavailable) |
| `--check-files-inside <path>`    | Restrict referenced files to this directory (default: working directory) |
| `-x, --allow-files-outside`      | Allow references outside that directory     |

### JavaScript / TypeScript

```ts
import renderMarkdown from "md2gost";

const result = await renderMarkdown({
    input: "./report.md",
    output: "./report.pdf",
    engine: "auto",
    progress(percent, message) {
        console.log(`${percent}% ${message}`);
    }
});

console.log(result.filePath);
```

The exported API consists of:

* `renderMarkdown(config)`
* `MDRenderConfig`
* `MDRenderResult`
* `MDRenderError`
* `reverseDocx(config)`, `MDReverseConfig`, `MDReverseResult`
* `inspectDocx(config)`, `MDInspectConfig`, `MDInspectResult`

See the type definitions for the complete API reference.

#### Document variables

Pass variables to the main document through `MDRenderConfig.variables`:

```ts
await renderMarkdown({
    input: "./report.g.md",
    variables: {
        author: "Ivanov I.I.",
        settings: { compact: true }
    }
});
```

These variables are also inherited by included Markdown files.

#### Template limits

Use `MDRenderConfig.templateOptions` to limit processing of complex templates or templates from external sources:

```ts
await renderMarkdown({
    input: "./report.g.md",
    variables: { showResults: true, results: ["First", "Second"] },
    templateOptions: {
        allowLoops: true,
        allowIncludes: true,
        maxTotalIterations: 2000,
        maxIncludeDepth: 100
    }
});
```

Other available limits are `maxLoopIterations`, `maxDepth`, `maxIncludes`, `maxFileLength`, `maxTotalInputLength` and `maxGeneratedLength`.

## ✨ Возможности
	## ✨ Features

- Export Markdown → **DOCX / PDF**
- [Reverse DOCX into editable `.g.md` and inspect its contents](#docx-reverse-conversion)
- [Autonumbering](#автонумерация) (figures, tables, code listings, references)
- Generate a [table of contents](#написание-курсовой-работы)
- Support for the GOST structure of term papers
- [AI-agent skill](#ai-agent-skill) for writing reports in `.g.md`
- [Inserting other DOCX/PDF files](#вставка-внешнего-документа) (e.g., title page)
- Automatically adds “Continued from table/listing #” when tables or listings span multiple pages
- [Code highlighting](#подсветка-синтаксиса-кода) (optional)
- Automatic replacement of “AI” dashes with regular dashes

## ⚙️ Требования
	## ⚙️ Requirements

### Basic rendering

* Node.js >= 22.12.0 (required by the CLI dependency `commander`)

### Full rendering and PDF generation

* Microsoft Word on Windows, or
* LibreOffice Writer and Python 3.10+ with UNO on Windows/Linux/macOS (macOS untested).

On Debian/Ubuntu install `libreoffice-writer libreoffice-math python3-uno`; on Windows use LibreOffice's bundled Python.

`engine`: `auto` (default), `word`, or `libreoffice`. Auto uses Word when available on Windows, otherwise LibreOffice. For CLI/API with nonstandard installations set `SOFFICE_PATH` to the LibreOffice executable and `UNO_PYTHON_PATH` to a Python interpreter with UNO support. These are executable paths, not directories; without overrides the runtime is detected automatically.

Microsoft fonts are optional; fonts can be selected through [style rules](#настройка-стилей).

For basic DOCX generation without an office engine, use `disableMacros: true`.

### Docker

```bash
docker build -t md2gost .
docker run --rm -v "${PWD}:/data" md2gost report.g.md --format pdf
```

The image includes LibreOffice, Python UNO and free fonts. Keep the source and referenced files inside the mounted directory; output is written there too. On Linux, add `--user "$(id -u):$(id -g)"` before the image name to preserve file ownership.

## Обратное преобразование DOCX
	## DOCX reverse conversion

Convert a DOCX file into editable `.g.md` and extract its embedded images:

```bash
md2gost reverse report.docx -o imported/report.g.md
```

The default output is `<input name>.g.md` beside the DOCX. Existing Markdown files are preserved unless `--force` is supplied. Images go into a new adjacent `<output name>.images` directory; an occupied directory name receives a numeric suffix. Existing image directories are preserved even with `--force`.

Read the body text and structure without creating files:

```bash
md2gost inspect report.docx
md2gost inspect report.docx --format json
```

Inspection prints text or JSON to stdout and warnings to stderr. JSON includes image metadata, without embedded bytes. Neither command needs Word or LibreOffice.

```ts
import { reverseDocx, inspectDocx } from "md2gost";

const result = await reverseDocx({
    input: "./report.docx",
    output: "./imported/report.g.md",
    overwrite: false
});
console.log(result.filePath, result.images, result.warnings);

const inspection = await inspectDocx({ input: "./report.docx", format: "json" });
console.log(JSON.parse(inspection.content));
```

Both functions accept `abortSignal`. Warnings contain `code`, `message` and an optional `block` number matching inspection output.

The importer preserves body text, basic emphasis, styled headings, simple lists and tables, embedded images and recognized code listings. Listing recognition uses known styles or the effective monospace font of a whole paragraph; code language defaults to `text`. Existing numbers remain explicit, and all links become their visible text. Cached table-of-contents entries are replaced by an md2gost contents heading.

OMML formulas, merged or nested tables, embedded objects and other unsupported content require review. Warnings and Markdown comments identify affected blocks and retain available text. Unsupported image formats are extracted for manual conversion. The result is an editable source; original layout, pagination and arbitrary local formatting are not reproduced.

## Скилл для ИИ-агента
	## AI-agent skill

The package includes [md2gost-report](https://github.com/MixelTe/md2gost/tree/master/skills/md2gost-report), a skill for writing reports in `.g.md` with captions, references, illustrations and optional rendering.

Find the bundled skill without a global CLI installation:

```bash
npx --yes --package md2gost@latest -- md2gost --skill-info
```

The JSON contains the utility `version` and a `skill` object: its independent `version`, associated `md2gostVersion`, `name` and absolute `path` to `SKILL.md`. Copy the entire containing `md2gost-report` directory, including `references`, into your agent's skills directory. With an installed CLI, use `md2gost --skill-info`.

For Codex, use `.agents/skills/md2gost-report/` in a project or `~/.agents/skills/md2gost-report/` for all projects, then invoke `$md2gost-report`. An available skill can also be selected automatically from the task description.

For a regular chat without skill support, download [the chat instructions](https://raw.githubusercontent.com/MixelTe/md2gost/master/md2gost-report-chat.md) and attach the file together with the assignment and project materials. For example:

> Prepare a report for md2gost using the attached assignment. Follow the instructions in md2gost-report-chat.md.

The file contains the report-writing rules and essential syntax; reading the README separately is unnecessary. For specific formatting requirements, also attach the [style reference](https://github.com/MixelTe/md2gost/blob/master/skills/md2gost-report/references/styles.md). If rendering tools are unavailable in the chat, save the resulting `.g.md` and export it locally with the extension or CLI.

## 📖 Документация
	## 📖 Documentation
	[diff]

---
* [Скилл для ИИ-агента](#скилл-для-ии-агента)
+++
* [AI-agent skill](#ai-agent-skill)
---
* [Обратное преобразование DOCX](#обратное-преобразование-docx)
+++
* [DOCX reverse conversion](#docx-reverse-conversion)
---
* [Просмотр DOCX](#просмотр-docx)
---
* [Как использовать](#как-использовать)
---
* [Редактор таблиц](#редактор-таблиц)
---
* [Настройки расширения](#️-настройки-расширения)
---
## Поддерживаемый синтаксис
	[diff]

---
#### Переменные главного документа

Передача переменных в главный документ доступна через программный API. Подробнее – в [документации npm-пакета](https://www.npmjs.com/package/md2gost#document-variables).


---
#### Ограничения шаблонизации

В настройках VS Code можно ограничить суммарное число итераций (`md2gost.render.maxTotalIterations`) и глубину Markdown-вставок (`md2gost.render.maxIncludeDepth`). Дополнительные ограничения программного API описаны в [документации npm-пакета](https://www.npmjs.com/package/md2gost#template-limits).


---
## Как использовать
## Просмотр DOCX
## Редактор таблиц
## ⚙️ Настройки расширения
