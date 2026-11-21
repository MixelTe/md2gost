import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { render } from "../main";
import * as Office from "../office";
import { openDocx, xml } from "./helpers/docx";
import { withTempDir, writeMarkdown } from "./helpers/fixtures";

// Replace only the office boundary: exercise the real parser and DOCX recovery
// without launching Word or LibreOffice. Restore globals before the next test.
const office = require("../office") as typeof Office;

suite("office errors and recovered DOCX", () =>
{
	for (const [platform, engine, code, contextual] of [
		["win32", "auto", "noOffice", true],
		["linux", "auto", "noOffice", false],
		["win32", "libreoffice", "noOffice", false],
		["win32", "auto", "office", false],
	] as const)
		test(`${platform}/${engine}/${code} preserves the document and reports the appropriate error`, async () => withTempDir(async dir =>
		{
			const input = await writeMarkdown(dir, "# СОДЕРЖАНИЕ\n\n# Раздел\n\nRECOVERED_CONTENT");
			const output = path.join(dir, "recovered.docx");
			const original = new Office.OfficeError(code, "Office unavailable or document processing failed");
			const paths = { sofficePath: path.join(dir, "custom-office"), unoPythonPath: path.join(dir, "custom-python") };
			const errors: string[] = [];
			const descriptor = Object.getOwnPropertyDescriptor(process, "platform")!;
			const resolve = office.resolveOfficeEngine;
			const run = office.runLibreOffice;
			let result: Awaited<ReturnType<typeof render>>;
			try
			{
				Object.defineProperty(process, "platform", { ...descriptor, value: platform });
				office.resolveOfficeEngine = async () => "libreoffice";
				office.runLibreOffice = async options =>
				{
					assert.equal(options.sofficePath, paths.sofficePath);
					assert.equal(options.unoPythonPath, paths.unoPythonPath);
					throw original;
				};
				result = await render({ file: input, output, assets: path.resolve("assets"), engine, ...paths,
					loginfo() {}, logwarn() {}, logPS() {}, logPSError: message => errors.push(message),
				});
			}
			finally
			{
				Object.defineProperty(process, "platform", descriptor);
				office.resolveOfficeEngine = resolve;
				office.runLibreOffice = run;
			}
			assert.equal(result.err, code);
			assert.equal(result.fout, output);
			assert.ok(xml(openDocx(output), "word/document.xml").includes("RECOVERED_CONTENT"));
			assert.deepEqual((await fs.readdir(dir)).filter(name => name.startsWith(".md2gost-")), []);
			if (contextual)
			{
				assert.ok(result.errS instanceof Office.OfficeError);
				assert.match(result.errS.message, /ни Microsoft Word, ни LibreOffice/);
				assert.equal(result.errS.cause, original);
				assert.deepEqual(errors, [original.message + "\n"]);
			}
			else
			{
				assert.equal(result.errS, original);
				assert.deepEqual(errors, []);
			}
		}));
});
