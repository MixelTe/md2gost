# md2gost

Render Markdown files into formatted **DOCX** and **PDF** documents with automatic GOST formatting.

The project is available in two forms:

- **npm package** – CLI and JavaScript/TypeScript API.
- **[VS Code extension](https://marketplace.visualstudio.com/items?itemName=MixelTe.md2gost)** – editor integration with preview, table editor, and one-click export.

> 💡 The Markdown syntax and rendering engine are identical in both versions. All documentation below applies to both.

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

Options:

| Option                           | Description                                 |
|----------------------------------|---------------------------------------------|
| `-o, --output <path>`            | Output file                                 |
| `-f, --format <docx\|pdf>`       | Output format                               |
| `-k, --keep-intermediate-docx`   | Keep intermediate DOCX after PDF generation |
| `-d, --disable-macros`           | Disable Word/VBA macros (PDF unavailable)   |

### JavaScript / TypeScript

```ts
import renderMarkdown from "md2gost";

const result = await renderMarkdown({
    input: "./report.md",
    output: "./report.pdf",
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

See the type definitions for the complete API reference.

## ✨ Возможности
	## ✨ Features

- Export Markdown → **DOCX / PDF**
- [Autonumbering](#автонумерация) (figures, tables, code listings, references)
- Generate a [table of contents](#написание-курсовой-работы)
- Support for the GOST structure of term papers
- [Inserting other DOCX/PDF files](#вставка-внешнего-документа) (e.g., title page)
- Automatically adds “Continued from table/listing #” when tables or listings span multiple pages
- [Code highlighting](#подсветка-синтаксиса-кода) (optional)
- Automatic replacement of “AI” dashes with regular dashes

## ⚙️ Требования
	## ⚙️ Requirements

### Basic rendering

* Node.js

### PDF generation

* Windows
* Microsoft Word

Without Microsoft Word, PDF export and several advanced Word-specific features are unavailable.

## 📖 Документация
	## 📖 Documentation
	[diff]

---
* [Как использовать](#как-использовать)
---
* [Редактор таблиц](#редактор-таблиц)
---
* [Настройки расширения](#️-настройки-расширения)
---
## Как использовать
## Редактор таблиц
## ⚙️ Настройки расширения
