import renderMarkdown, { MDRenderConfig, MDRenderError } from "./index";

(async function ()
{
	const { Command } = await import("commander");
	const program = new Command();

	program
		.name("md2gost")
		.description("Render Markdown files into formatted .docx or .pdf documents")
		.argument("<input>", "Absolute or relative file path to the source Markdown document")
		.option("-o, --output <path>", "Destination path for the rendered file")
		.option("-f, --format <type>", 'Target output format ("docx" or "pdf")')
		.option("-k, --keep-intermediate-docx", "Retain the intermediate .docx file after generating a PDF", false)
		.option("-d, --disable-macros", "Disable VBA macro execution (PDF generation will be unavailable)", false)
		.action(action);

	program.parse(process.argv);
})();

async function action(input: string, options: any)
{

	const config: MDRenderConfig = {
		input,
		output: options.output,
		format: options.format,
		keepIntermediateDocx: options.keepIntermediateDocx,
		disableMacros: options.disableMacros,
		progress: (totalPercent, message) =>
		{
			if (process.stdout.isTTY)
			{
				process.stdout.clearLine(0);
				process.stdout.cursorTo(0);
				process.stdout.write(`[${totalPercent}%] ${message}`);
			} else
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

		result.warnings.forEach((w) => console.warn(`[WARNING] ${w}`));

		console.log(`\nSuccessfully saved to: ${result.filePath}`);

		if (result.intermediateDocxPath)
		{
			console.log(`Intermediate DOCX saved to: ${result.intermediateDocxPath}`);
		}

		process.exit(0);
	} catch (error)
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
				error.warnings.forEach((w) => console.warn(` - ${w}`));
			}

			if (error.code.endsWith("PS") && error.powershellLog && error.powershellLog.length > 0)
			{
				console.error("\n--- PowerShell Log Trace ---");
				console.error(error.powershellLog.join(""));
				console.error("----------------------------");
			}

			if (error.cause)
			{
				console.error("\nRoot cause:", error.cause);
			}
		} else
		{
			console.error("\n[FATAL] Unexpected runtime error:");
			console.error(error);
		}

		process.exit(1);
	}
}
