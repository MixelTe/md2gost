const fs = require("node:fs/promises");
const path = require("node:path");
const root = path.resolve(__dirname, "../../..");
const work = path.join(root, "out/e2e/layout");
const api = require(path.join(root, "dist/index.js")).default;
const common = "!!rule numbering lazy\n!!rule text size 12\n!!rule text line_spacing 1\n!!rule text spacing after 0\n!!rule table text size 12\n!!rule table text line_spacing 1.25\n\n";
const filler = n => Array.from({ length:n }, (_, i) => `Заполняющий абзац ${i + 1}.\n\n`).join("");
function table(id, count, cols = 2, height = () => 1, headerLines = 1) 
{
	const heading = Array.from({ length:cols }, (_, c) => Array.from({ length:headerLines }, (_, h) => `Шапка ${id} ${c + 1}.${h + 1}`).join("<br>"));
	const rows = Array.from({ length:count }, (_, r) => Array.from({ length:cols }, (_, c) => c === 0 ? `${id}_ROW_${String(r + 1).padStart(3, "0")}` : Array.from({ length:height(r) }, (_, i) => `Значение ${r + 1}.${i + 1}`).join("<br>")));
	return `[${id}] Таблица для проверки ${id}\n\n| ${heading.join(" | ")} |\n| ${Array(cols).fill(":---").join(" | ")} |\n` + rows.map(r => "| " + r.join(" | ") + " |").join("\n") + "\n\n";
}
function listing(id, count, options = {}) 
{
	const lines = Array.from({ length:count }, (_, i) => 
	{
		const marker = `${id}_LINE_${String(i + 1).padStart(3, "0")}`;
		if (options.highlight) return `const ${marker} = { nested: [${i}, "text"], valid: true };`;
		return marker + " = " + (options.wrap && i % 7 === 0 ? "длинная строка ".repeat(24) : String(i));
	});
	if (options.blanks) { lines.unshift(""); lines.splice(15, 0, "", ""); lines.push(""); }
	return "```" + (options.highlight ? "js" : "txt") + " [" + id + "] Листинг для проверки " + id + "\n" + lines.join("\n") + "\n```\n\n";
}
async function generate(selected)
{
	const fixtures = {};
	fixtures["tables-thresholds"] = common + [
		[0, 1], [0, 2], [0, 3], [45, 9], [49, 8], [52, 6], [55, 4], [56, 3],
	].map(([fill, rows], i) => (i ? "---\n\n" : "") + filler(fill) + table("TB" + i, rows)).join("");
	fixtures["tables-structure"] = common + table("TS1", 60, 1, () => 1, 3) +
    table("TS2", 8, 2, r => [1, 3, 10, 36, 2, 1, 1, 1][r], 2) +
    table("TS3", 4, 3) + table("TS4", 5, 2) + table("TS5", 3, 4) +
    "!!section landscape from 1\n\n" + table("TW1", 55, 6, r => r % 9 === 0 ? 3 : 1, 2) +
    "!!section portrait\n\n" + table("TS6", 35, 2);
	fixtures["listings-layout"] = common + filler(55) + listing("LC1", 2) +
    listing("LC2", 120, { blanks:true }) + "---\n\n!!rule code highlight on\n!!rule code text size 15\n\n" +
    listing("LC3", 95, { highlight:true, blanks:true }) + "!!rule code highlight off\n!!rule code text size 12\n\n" + listing("LC4", 95, { wrap:true });
	fixtures["mixed-sections"] = common + "!!rule numbering sections\n# СОДЕРЖАНИЕ\n\n" +
    "# [main] Основной раздел с очень длинным названием " + "с продолжением названия ".repeat(10) + "\n\n" +
    table("TM1", 55) + listing("LM1", 85) + "!!section landscape from 1\n\n" +
    "!!header align=center\nЗаголовок альбомного раздела\n!!endheader\n!!footer\n| Документ | Стр. [!page] из [!pages] |\n|:---|---:|\n!!endfooter\n\n" +
    table("TM2", 45, 5) + listing("LM2", 70) + "!!section portrait unpaged\n\n!!header none\n!!footer auto\n\n" +
    "# ПРИЛОЖЕНИЯ\n\n## [appA] Приложение с таблицей и листингом\n\n" + table("TA1", 50) + listing("LA1", 80);
	fixtures["features"] = common + "!!rule link color 123ABC\n!!rule link underline off\n!!rule title E2E & layout\n!!rule author Проверка\n\n" +
    "!!header align=center\nКонтрольный заголовок [!page]\n!!endheader\n!!footer\n| Документ | [!page] / [!pages] |\n|:---|---:|\n!!endfooter\n\n" +
    "# [sec] Контроль оформления\n\nG1_ITEM_001 **Полужирный**, *курсив*, `код`, \\_буквально\\_, \\[literal]. [Ссылка](https://example.com/a_b?x=1&y=2).\n\n" +
    "1. Первый пункт\n   * Вложенный пункт\n   * Второй вложенный пункт\n2. Второй пункт\n\n" +
    "На рисунке [fig], в таблице [TF1], в листинге [LF1], в формуле [eq] и разделе [sec] даны примеры. Источник [[book]].\n\n" +
    "![ [fig] Контрольное изображение](picture.png){180}\n\n" +
    "G1_ITEM_002 Формула внутри строки $a_1^2 + \\sqrt{x}$ и блочная матрица:\n\n[eq]\n$$\n\\mathbf{A} = \\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix} + \\frac{1}{2}\\sum_{i=1}^{n} x_i\n$$\n\n" +
    ":::warning[Проверка примечания]\nG1_ITEM_003 Текст с **выделением** и [ссылкой](https://example.org).\n:::\n\n" + table("TF1", 4) +
    "!!rule code highlight on\n\n" + listing("LF1", 9, { highlight:true }) +
    "# СПИСОК ЛИТЕРАТУРЫ\n\n[book] Контрольный источник, 2026.\n";
	fixtures["oversized-row"] = common + table("TX1", 2, 2, r => r === 0 ? 70 : 1);
	const manifest = selected ? JSON.parse(await fs.readFile(path.join(work, "manifest.json"), "utf8").catch(() => "[]")).filter(f => f.name !== selected) : [];
	for (const [name, markdown] of Object.entries(fixtures)) 
	{
		if (selected && name !== selected) continue;
		const dir = path.join(work, name); await fs.mkdir(dir, { recursive:true });
		await fs.copyFile(path.join(root, "imgs/icon.png"), path.join(dir, "picture.png"));
		const input = path.join(dir, "input.g.md"), output = path.join(dir, "raw.docx");
		await fs.writeFile(input, markdown);
		const warnings = [];
		await api({ input, output, disableMacros:true, logger:{ info() {}, warn:m => warnings.push(m), error:m => warnings.push(m) } });
		if (warnings.length) throw new Error(name + ": " + warnings.join("\n"));
		manifest.push({ name, input, raw:output, output:path.join(dir, "processed.docx"), expectedError:name === "oversized-row" ? "do not fit" : null });
	}
	await fs.writeFile(path.join(work, "manifest.json"), JSON.stringify(manifest, null, 2));
	console.log("Prepared " + manifest.length + " native layout fixtures");
}
module.exports = { generate, table, listing, common };
if (require.main === module) generate(process.argv.find(a => a.startsWith("--case="))?.slice(7)).catch(e => { console.error(e); process.exitCode = 1; });
