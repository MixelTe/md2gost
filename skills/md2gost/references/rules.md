# Правила оформления `!!rule`

Правило пишется на отдельной строке и действует на весь документ, где бы ни стояло; при повторе
побеждает последнее. Размеры шрифта и интервалы — в пунктах (pt), отступы — в сантиметрах.
Неизвестное правило даёт предупреждение `Wrong rule`, неверное значение — `Rule "…" wrong value`.

Переключатели вида `!!rule hyphenation` включаются без значения. Исключения:
`list autopunctuation` и `numbering autoprefix` без значения **выключаются** — им всегда пиши
`on` или `off` явно.

Умолчания уже близки к ГОСТ 7.32 (Times New Roman 14 пт, интервал 1,5, отступ 1,25 см). Меняй
только то, что требует методичка пользователя.

## Основной текст

| Правило | По умолчанию |
|---|---|
| `!!rule text size <int>` | 14 |
| `!!rule text line_spacing <float>` | 1.5 |
| `!!rule text indent <float>` — абзацный отступ, см | 1.25 |
| `!!rule text spacing after <int>` — интервал после абзаца | 8 |
| `!!rule hyphenation` — автоматические переносы | выкл. |
| `!!rule backtick_mono <italic\|off\|on\|outline>` — вид `` `текст` `` | italic |

## Заголовки

`h<1-6>` — один уровень, `h<1-6>+` — этот уровень и все ниже (`h2+` = h2…h6).

| Правило | По умолчанию |
|---|---|
| `!!rule headings h1 size <int>` | 14 для всех |
| `!!rule headings h1 spacing before <int>` | h1: 18, остальные: 8 |
| `!!rule headings h1 spacing after <int>` | 4 |
| `!!rule headings h1 uppercase` | выкл. |
| `!!rule headings h1 indent <first_line\|left>` — абзацный отступ или отступ слева | first_line |
| `!!rule headings alt_style_1` — готовый набор, см. ниже | — |

`alt_style_1` равносилен последовательности (правила после него могут её переопределить):

```
!!rule headings h1+ indent left
!!rule headings h1+ spacing after 10
!!rule headings h1 size 18
!!rule headings h1 uppercase
!!rule headings h1 spacing before 0
!!rule headings h2 size 16
!!rule headings h2+ spacing before 15
```

## Таблицы

| Правило | По умолчанию |
|---|---|
| `!!rule table title style <normal\|bold\|italic>` — подпись | normal |
| `!!rule table title size <int>` | как у текста |
| `!!rule table spacing before <int>` — перед подписью | 0 |
| `!!rule table spacing after <int>` — после таблицы | как у текста |
| `!!rule table heading style <normal\|bold\|italic>` — строка заголовка | normal |
| `!!rule table heading align <left\|center\|right>` | center |
| `!!rule table text size <int>` | 12 |
| `!!rule table text line_spacing <float>` | 1.25 |

## Листинги

| Правило | По умолчанию |
|---|---|
| `!!rule code title style <normal\|bold\|italic>` | normal |
| `!!rule code title size <int>` | как у текста |
| `!!rule code spacing before <int>` — перед подписью | 0 |
| `!!rule code spacing after <int>` — после листинга | как у текста |
| `!!rule code text size <int>` | 12 |
| `!!rule code highlight` — цветная подсветка | выкл. |

## Рисунки

| Правило | По умолчанию |
|---|---|
| `!!rule img text size <int>` — подпись | как у текста |
| `!!rule img spacing before <int>` — перед картинкой | 0 |
| `!!rule img spacing after <int>` — после подписи | как у текста |

## Списки

| Правило | По умолчанию |
|---|---|
| `!!rule list unordered style <dash\|bullet\|keep>` — `keep` сохраняет символ из исходника | bullet |
| `!!rule list ordered style <bracket\|dot\|keep>` — «1)» или «1.» | bracket |
| `!!rule list autopunctuation <on\|off>` | on |

## Формулы

| Правило | По умолчанию |
|---|---|
| `!!rule formula spacing before <int>` | 0 |
| `!!rule formula spacing after <int>` | как у текста |

## Автонумерация

| Правило | Действие |
|---|---|
| `!!rule numbering lazy` | `[#]` в подписях подставляется автоматически |
| `!!rule numbering sections` | номера по разделам: «Рисунок 1.1» |
| `!!rule numbering autoprefix off` | без слов «Рисунок», «Таблица», «Листинг» |

## Admonition

`<type>` — `note`, `info`, `tip`, `warning`, `danger` или `all`; правило для конкретного типа,
указанное позже, важнее.

| Правило | Пример |
|---|---|
| `!!rule admonition <type> spacing <before\|after> <int>` | `!!rule admonition all spacing before 8` |
| `!!rule admonition <type> indent <float>` — отступ слева, см | `!!rule admonition all indent 1.25` |
| `!!rule admonition <type> padding <гориз> <верт>` — пт | `!!rule admonition all padding 10 6` |
| `!!rule admonition <type> background <#RRGGBB>` | `!!rule admonition warning background #FFF6E8` |
| `!!rule admonition <type> color <#RRGGBB>` — полоска, заголовок, иконка | `!!rule admonition warning color #B26A00` |
| `!!rule admonition <type> bar_width <float>` — пт | `!!rule admonition all bar_width 2.25` |
| `!!rule admonition <type> icon <on\|off>` | `!!rule admonition note icon off` |
| `!!rule admonition <type> icon size <int>` | `!!rule admonition all icon size 16` |
| `!!rule admonition <type> title_color <on\|off>` | `!!rule admonition all title_color off` |
| `!!rule admonition <type> title <текст>` — заголовок по умолчанию | `!!rule admonition warning title **Важно**` |

## Метаданные и прочее

`!!rule title <текст>`, `!!rule author <текст>`, `!!rule ctime <ISO 8601>`,
`!!rule mtime <ISO 8601>`, `!!rule etime <минуты>` — см. `syntax.md`, раздел «Метаданные».

## Перевод требований методички в правила

| Требование | Правила |
|---|---|
| Шрифт 12 пт, интервал одинарный | `!!rule text size 12`, `!!rule text line_spacing 1` |
| Отступ первой строки 1 см, без интервала после абзаца | `!!rule text indent 1`, `!!rule text spacing after 0` |
| Заголовки разделов прописными буквами | `!!rule headings h1 uppercase` |
| Заголовки без абзацного отступа | `!!rule headings h1+ indent left` |
| Подписи таблиц курсивом, шапка таблицы жирным | `!!rule table title style italic`, `!!rule table heading style bold` |
| Маркер списка — тире, нумерация «1.» | `!!rule list unordered style dash`, `!!rule list ordered style dot` |
| Рисунки и таблицы нумеровать в пределах раздела | `!!rule numbering sections` |

Поля страницы, шрифт гарнитуры и выравнивание заголовков по центру правилами не меняются: они
заданы в шаблоне md2gost. Если методичка требует иного, скажи пользователю, что это правится в
Word после сборки.
