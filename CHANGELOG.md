# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- intellisense (CompletionItem, InlineCompletionItem, Hover, InlayHints)
- table editor
- html codes for ~60 symbol (e.g. `&pi;` to `π`)
### Changed
### Deprecated
### Removed
### Fixed
- fix one-column table parsing
- allow table title without newline
### Security

## [0.7.0] - 2026-04-07
### Added
- convert `&Star;` to `*`
- table columns alignment with colon
- parse ``` `abc` ``` as monotext, render as italic if backtick_mono is off (default)
- new rule: `!!rule backtick_mono <off/on/outline>`
- new rule: `!!rule numbering lazy <off/on>`
### Fixed
- fix disappearing stars due to text style parsing
- fix list indent when >= 10 items
- fix quotes replacing ("a "b" c": «a »b« c» to «a «b» c»)
- fix docx include when not in the beginning
- fix `<br>` duplication

## [0.6.1] - 2026-03-10
### Added
- show what's new page on update

## [0.6.0] - 2026-03-07
### Added
- autonumbering by `[#]`, `[ref_id]`
- refs by `[ref_id]` - allowed chars: a-z A-Z а-я А-Я ёЁ _ 0-9
- text vars `[!pages]` `[!imgs]` `[!tables]` `[!codes]` `[!sources]`
- new rules: `!!rule numbering sections <on/off>` `!!rule numbering autoprefix <on/off>`
- fast render without postprocessing (hold alt when click render button)
### Fixed
- warn message if not win32 instead of error
- black background with `!!rule rainbow`
- fix img path from project root: treat `/img.png` as `./img.png`
- correct work with img path in `<>` like `<img.png>`

## [0.5.2] - 2026-02-27
### Fixed
- detect ru/en language in text for correct markup
- better error messages
- stretch tables to full page width
- dont crash if cant run PS or on PS error

## [0.5.1] - 2026-02-18
### Added
- replacing `---` with page break
### Fixed
- fix using absolute path for images and external doc
- save .md file before rendering

## [0.5.0] - 2026-02-18
### Added
- insert non-breaking space by `&nbsp;`
- insert tab by `&Tab;`
- prevent text stretching due to line breaks
- new rule rainbow: `!!rule rainbow`
- set in doc: edit time (random in 30-120), creation time (as in .md), modification time (now)
- new rules: `!!rule etime <int>`, `!!rule ctime <ISO 8601>`, `!!rule mtime <ISO 8601>`
### Fixed
- fix doc include parsing
- prevent empty image title

## [0.4.0] - 2026-02-17
### Added
- new rule to set title of document: `!!rule title My great title`
- new rule to set author of document: `!!rule author My name`

## [0.3.1] - 2026-02-17
### Fixed
- syntax highlighting: remove bold style

## [0.3.0] - 2026-02-17
### Added
- syntax highlighting in code blocks
	- is enabled by adding `!!rule highlight code` anywhere in file
	- suports: html, xml, css, js, ts, jsx, tsx, json, bash, powershell, python, java, c, cpp, csharp, go, rust, php, ruby, swift, kotlin, sql, yaml, markdown, docker, nginx

## [0.2.1] - 2026-02-17
### Added
- replacing quotes: "abc" to «abc»

## [0.2.0] - 2026-02-17
### Added
- break line by `<br>`
- text decorations parsing: bold, italic, links
### Fixed
- disable row spliting in table

## [0.1.7] - 2026-02-15
### Fixed
- fix AutoListingContinuation

## [0.1.6] - 2026-02-15
### Fixed
- greatly fix PDF render

## [0.1.5] - 2026-02-15
### Fixed
- list: dont auto-lower first char

## [0.1.4] - 2026-02-15
### Fixed
- fix readme

## [0.1.3] - 2026-02-15
### Added
- replacing "ai" dashes with common dash
### Fixed
- list: dont auto-lower first char if second is uppercase
- ToC title uppercase
- improve readme

## [0.1.2] - 2026-02-13
### Fixed
- Correct parsing of tables and lists

## [0.1.0] - 2026-02-13
### Added
- basic functionality