import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { withTempDir } from "../helpers/fixtures";
import { parseMD, runifyDoc } from "../../parser";
import { enrichDoc } from "../../enricher";
import { alchemist } from "../../alchemist";
import { serializeDocx } from "../../serializer";
import { openDocx, xml } from "../helpers/docx";

const continuationFixtures = ["01-table-first", "02-listing-first", "03-boundaries", "04-appendices"];

suite("VBA continuation numbers", () =>
{
	test("executes the shipped extraction function with the Windows VBScript engine", async function ()
	{
		if (process.platform != "win32") return this.skip();
		this.timeout(10000);
		await withTempDir(async dir =>
		{
			const source = await fs.readFile(path.resolve("resources/vba/AutoContinuation.bas"), "utf8");
			// This function uses the same RegExp and string APIs in VBA and VBScript.
			let script = source.match(/Function Extract(?:Listing|Table)Number\([\s\S]*?End Function/g)!.join("\n").replace(/ As (String|Object)/g, "");
			const string = (value: string) => value ? [...value].map(char => `ChrW(${char.charCodeAt(0)})`).join(" & ") : '""';
			script += '\nSub Check(caption, expected, isTable)\nIf isTable Then\nactual = ExtractTableNumber(caption)\nElse\nactual = ExtractListingNumber(caption)\nEnd If\nIf actual <> expected Then\nWScript.Echo "Unexpected continuation number: " & actual\nWScript.Quit 1\nEnd If\nEnd Sub\n';
			let cases = 0;
			for (const number of ["1", "2.3", "10.12.3", "А.1", "Б.12", "A.1"])
				for (const space of [" ", "\u00a0", "\u202f"])
					for (const [label, isTable] of [["Листинг", false], ["Продолжение листинга", false], ["Таблица", true], ["Продолжение таблицы", true]] as const)
						for (const suffix of ["", " – название"])
						{
							script += `Check ${string(label + space + number + suffix)}, ${string(number)}, ${isTable ? "True" : "False"}\n`;
							cases++;
						}
			for (const caption of ["No number", "Листинг", "Таблица", "Листинг А.", "Таблица 1x"])
				for (const isTable of ["True", "False"])
				{
					script += `Check ${string(caption)}, "", ${isTable}\n`;
					cases++;
				}
			script += `WScript.Echo "${cases} cases passed"\n`;
			const file = path.join(dir, "listing.vbs");
			await fs.writeFile(file, Buffer.concat([Buffer.from([255, 254]), Buffer.from(script, "utf16le")]));
			const { stdout } = await promisify(execFile)("cscript.exe", ["//nologo", file], { timeout: 8000 });
			assert.ok(stdout.includes(`${cases} cases passed`));
		});
	});
});

suite("continuation fixtures", () =>
{
	for (const name of continuationFixtures)
	{
		test(`renders ${name} with all row and code markers intact`, async () => withTempDir(async dir =>
		{
			const input = path.resolve("src/test/e2e/fixtures/continuations", name + ".g.md");
			const source = await fs.readFile(input, "utf8");
			const doc = await parseMD(input);
			enrichDoc(doc);
			const runic = runifyDoc(doc);
			alchemist(runic);
			const elements = runic.nodes.filter(n => n.type == "table" || n.type == "code");
			assert.equal(elements.length, 4);
			const expectedOrder = name == "01-table-first" ? ["table", "code", "table", "code"] :
				name == "02-listing-first" ? ["code", "table", "code", "table"] :
					name == "03-boundaries" ? ["code", "table", "table", "code"] : ["table", "code", "code", "table"];
			assert.deepEqual(elements.map(n => n.type), expectedOrder);
			if (name == "04-appendices")
			{
				const titles = elements.map(n => n.title?.map(r => r.text).join(""));
				assert.ok(titles[0]?.includes("А.1"));
				assert.ok(titles[2]?.includes("Б.1"));
			}
			const output = path.join(dir, name + ".docx");
			await serializeDocx(runic, output, dir, path.resolve("assets"), dir);
			const markers = /[A-Z][A-Z0-9]*_(?:ROW|LINE)_[0-9]{3}/g;
			assert.deepEqual(xml(openDocx(output), "word/document.xml").match(markers), source.match(markers));
		}));

		test(`checks ${name} in Word, including a second macro run`, async function ()
		{
			if (process.platform != "win32" || process.env.MD2GOST_TEST_WORD != "1") return this.skip();
			this.timeout(660000);
			await withTempDir(async dir =>
			{
				const doc = await parseMD(path.resolve("src/test/e2e/fixtures/continuations", name + ".g.md"));
				enrichDoc(doc);
				const runic = runifyDoc(doc);
				alchemist(runic);
				const output = path.join(dir, name + ".docx");
				await serializeDocx(runic, output, dir, path.resolve("assets"), dir);
				const { stdout } = await promisify(execFile)("powershell.exe", [
					"-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.resolve("src/test/e2e/helpers/word-continuation.ps1"),
					"-InputDoc", output, "-VbaDir", path.resolve("resources/vba"),
					...(["01-table-first", "02-listing-first"].includes(name) ? ["-WithoutContinuationStyles"] : []),
				], { timeout: 600000 });
				assert.ok(stdout.includes("WORD_OK"));
			});
		});
	}
});
