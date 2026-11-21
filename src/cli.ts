import type * as Renderer from "./index";
import * as fs from "node:fs";
import * as path from "node:path";

const packageDir = path.resolve(__dirname, "..");
const packageVersion: string = JSON.parse(fs.readFileSync(path.join(packageDir, "package.json"), "utf8")).version;

(async function ()
{
	const { Command } = await import("commander");
	const program = new Command();

	program
		.name("md2gost")
		.enablePositionalOptions()
		.description("Render Markdown files into formatted .docx or .pdf documents")
		.version(packageVersion)
		.argument("[input]", "Absolute or relative file path to the source Markdown document")
		.option("--skill-info", "Print bundled report skill metadata as JSON")
		.option("-o, --output <path>", "Destination path for the rendered file")
		.option("-f, --format <type>", 'Target output format ("docx" or "pdf")')
		.option("--engine <name>", "Office engine (auto, word or libreoffice)")
		.option("-k, --keep-intermediate-docx", "Retain the intermediate .docx file after generating a PDF", false)
		.option("-d, --disable-macros", "Disable office postprocessing (PDF generation will be unavailable)", false)
		.option("--check-files-inside <path>", "Restrict referenced files to this directory", process.cwd())
		.option("-x, --allow-files-outside", "Allow referenced files outside the permitted directory", false)
		.action((input: string | undefined, options) =>
		{
			if (options.skillInfo)
			{
				console.log(JSON.stringify(getSkillInfo(), null, 2));
				return;
			}
			if (!input) return program.error("missing required argument 'input'");
			return action(input, options);
		});

	program.command("reverse <input>")
		.description("Convert a DOCX file into editable .g.md and extract embedded images")
		.option("-o, --output <path>", "Destination .g.md file or directory")
		.option("--force", "Replace an existing Markdown output", false)
		.action((input: string, options) => antirenderAction("reverse", input, options));
	program.command("inspect <input>")
		.description("Read DOCX body text and structure without Office")
		.option("-f, --format <type>", 'Inspection format ("text" or "json")', "text")
		.action((input: string, options) => antirenderAction("inspect", input, options));

	await program.parseAsync(process.argv);
})();

async function action(input: string, options: any)
{
	const { default: renderMarkdown, MDRenderError }: typeof Renderer = require("./index");
	const controller = new AbortController();
	let interruption: "SIGINT" | "SIGTERM" | undefined;
	const interrupt = (signal: "SIGINT" | "SIGTERM") =>
	{
		interruption = signal;
		controller.abort(new Error(`Operation aborted by ${signal}`));
	};
	const onInterrupt = () => interrupt("SIGINT");
	const onTerminate = () => interrupt("SIGTERM");
	process.on("SIGINT", onInterrupt);
	process.on("SIGTERM", onTerminate);
	const config: Renderer.MDRenderConfig = {
		input,
		output: options.output,
		format: options.format,
		keepIntermediateDocx: options.keepIntermediateDocx,
		disableMacros: options.disableMacros,
		engine: options.engine,
		abortSignal: controller.signal,
		checkFilesIsInsidePath: options.allowFilesOutside ? false : options.checkFilesInside,
		progress: (totalPercent, message) =>
		{
			if (process.stdout.isTTY)
			{
				process.stdout.clearLine(0);
				process.stdout.cursorTo(0);
				process.stdout.write(`[${totalPercent}%] ${message}`);
			}
			else
			{
				console.log(`[${totalPercent}%] ${message}`);
			}
		},
	};

	try
	{
		const result = await renderMarkdown(config);

		if (process.stdout.isTTY)
		{
			process.stdout.write("\n");
		}

		result.warnings.forEach(w => console.warn(`[WARNING] ${w}`));

		console.log(`\nSuccessfully saved to: ${result.filePath}`);

		if (result.intermediateDocxPath)
		{
			console.log(`Intermediate DOCX saved to: ${result.intermediateDocxPath}`);
		}

		process.exitCode = 0;
	}
	catch (error)
	{
		if (process.stdout.isTTY)
		{
			process.stdout.write("\n");
		}

		if (error instanceof MDRenderError)
		{
			console.error(`\n[ERROR: ${error.code.toUpperCase()}] ${error.message}`);

			if (error.renderedFile)
			{
				console.error(`Partial file recovered at: ${error.renderedFile}`);
			}

			if (error.warnings && error.warnings.length > 0)
			{
				console.warn("\nWarnings prior to failure:");
				error.warnings.forEach(w => console.warn(` - ${w}`));
			}

			if (error.officeLog.length > 0)
			{
				console.error("\n--- Office Log Trace ---");
				console.error(error.officeLog.join(""));
				console.error("----------------------------");
			}

			if (error.cause)
			{
				console.error("\nRoot cause:", error.cause);
			}
		}
		else
		{
			console.error("\n[FATAL] Unexpected runtime error:");
			console.error(error);
		}

		process.exitCode = interruption == "SIGINT" ? 130 : interruption == "SIGTERM" ? 143 : 1;
	}
	finally
	{
		process.removeListener("SIGINT", onInterrupt);
		process.removeListener("SIGTERM", onTerminate);
	}
}

async function antirenderAction(mode: "reverse" | "inspect", input: string, options: any)
{
	const { reverseDocx, inspectDocx }: typeof Renderer = require("./index");
	const controller = new AbortController();
	let interruption = 0;
	const onInterrupt = () => { interruption = 130; controller.abort(); };
	const onTerminate = () => { interruption = 143; controller.abort(); };
	process.on("SIGINT", onInterrupt);
	process.on("SIGTERM", onTerminate);
	try
	{
		if (mode == "inspect")
		{
			const result = await inspectDocx({ input, format: options.format, abortSignal: controller.signal });
			result.warnings.forEach(w => console.warn(`[WARNING${w.block ? ` block ${w.block}` : ""}] ${w.message}`));
			process.stdout.write(result.content);
		}
		else
		{
			const result = await reverseDocx({ input, output: options.output, overwrite: options.force, abortSignal: controller.signal });
			result.warnings.forEach(w => console.warn(`[WARNING${w.block ? ` block ${w.block}` : ""}] ${w.message}`));
			console.log(`Successfully saved to: ${result.filePath}`);
		}
	}
	catch (error)
	{
		console.error(`[ERROR] ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = interruption || 1;
	}
	finally
	{
		process.removeListener("SIGINT", onInterrupt);
		process.removeListener("SIGTERM", onTerminate);
	}
}

function getSkillInfo()
{
	const name = "md2gost-report";
	const skillPath = path.join(packageDir, "skills", name, "SKILL.md");
	const document = fs.readFileSync(skillPath, "utf8");
	const header = /^---\r?\n([\s\S]*?)\r?\n---/.exec(document)?.[1] || "";
	const metadata = /^metadata:[ \t]*\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))+)/m.exec(header)?.[1] || "";
	// The bundled skill owns this metadata block; read its version fields directly.
	const readVersion = (key: string) =>
	{
		const value = new RegExp(`^[ \\t]+${key}:[ \\t]*["']?([^\\s"'#]+)["']?[ \\t]*(?:#.*)?$`, "m").exec(metadata)?.[1];
		if (!value) throw new Error(`Missing skill metadata: ${key}`);
		return value;
	};
	return {
		version: packageVersion,
		skill: {
			name,
			version: readVersion("version"),
			md2gostVersion: readVersion("md2gost-version"),
			path: skillPath,
		},
	};
}
