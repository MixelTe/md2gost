import path from "path";
import { fileURLToPath } from "url";
import { render } from "./main";

/**
 * Configuration options for the Markdown rendering process.
 */
export interface MDRenderConfig
{
	/** Absolute or relative file path to the source Markdown (`.md`) document. */
	input: string;

	/**
	 * Destination path for the rendered file (`.docx` or `.pdf`).
	 * @defaultValue Inferred from the `input` filepath, replacing its extension.
	 */
	output?: string;

	/**
	 * Target output format.
	 * @note Generating `.pdf` files depends on a Windows environment with Microsoft Word.
	 * @defaultValue inferred From the `output` filename extension if present, otherwise `"docx"`.
	 */
	format?: "docx" | "pdf";

	/**
	 * If `true`, retains the intermediate `.docx` file in the output directory after successfully generating a PDF.
	 * @defaultValue `false`
	 */
	keepIntermediateDocx?: boolean;

	/**
	 * Disables VBA macro execution. When `true`, a basic `.docx` render is performed entirely in Node.js
	 * without requiring Microsoft Word or PowerShell.
	 * @note PDF generation is unavailable when macros are disabled.
	 * @defaultValue `false`
	 */
	disableMacros?: boolean;

	/**
	 * Optional callback function triggered periodically to report the total rendering progress.
	 * @param totalPercent - The total calculated completion progress, clamped between 0 and 100.
	 * @param message - A human-readable description of the active step.
	 */
	progress?: (totalPercent: number, message: string) => void;
}

/**
 * The successful result of a Markdown rendering operation.
 */
export interface MDRenderResult
{
	/**
	 * The absolute file path to the successfully rendered document.
	 */
	filePath: string;

	/**
	 * The absolute file path to the intermediate `.docx` document.
	 * This field is populated exclusively during PDF compilation processes.
	 */
	intermediateDocxPath?: string;

	/**
	 * Non-fatal warnings captured during the compilation or conversion process.
	 * If no warning events were triggered, this array will be empty.
	 */
	warnings: string[];
}


/**
 * Renders a Markdown text file into a formatted `.docx` or `.pdf` document.
 * @param {MDRenderConfig} config - Configuration options for the renderer.
 * @returns {Promise<MDRenderResult>} A promise resolving to an {@link MDRenderResult} containing the generated file path and compilation warnings.
 * @throws {MDRenderError} Thrown if compilation fails. Inspect the `cause` property for the underlying native error, alongside custom fields like `code` and `powershellLog`.
 * @example
 * ```ts
 * const config: MDRenderConfig = {
 * 	input: "./proposals/spec.md",
 * 	output: "./dist/spec.pdf",
 * 	progress(totalPercent, message) {
 * 		console.log(`[${totalPercent}%] ${message}`);
 * 	},
 * };
 *
 * try {
 * 	const result = await renderMarkdown(config);
 * 	result.warnings.forEach(w => console.warn(`[W] ${w}`));
 * 	console.log(`Saved to ${result.filePath}`);
 * } catch (error) {
 * 	if (error instanceof MDRenderError) {
 * 		if (error.renderedFile)
 * 			console.log(`Partial file saved at: ${error.renderedFile}`);
 *
 * 		console.error(`[MDRenderError] ${error.message}`);
 *
 * 		if (error.cause)
 * 			console.error("Root cause:", error.cause);
 *
 * 		result.warnings.forEach(w => console.warn(`[W] ${w}`));
 *
 * 		if (error.code.endsWith("PS") && error.powershellLog.length > 0)
 * 			console.error("PowerShell Logs:\n", error.powershellLog.join(""));
 * 	} else {
 * 		console.error("Unexpected runtime error:", error);
 * 	}
 * }
 * ```
 */
export default async function renderMarkdown(config: MDRenderConfig): Promise<MDRenderResult>
{
	function assert(value: unknown, message: string)
	{
		if (!value) throw new TypeError(message);
	}
	assert(config && typeof config == "object", "Config object is required");
	assert(typeof config.input == "string", "Input file path must be a string.");
	assert(typeof config.output == "string" || typeof config.output == "undefined", "Output path must be a string or undefined.");
	assert(config.format == "docx" || config.format == "pdf" || typeof config.format == "undefined", "Format must be either 'docx' or 'pdf', or undefined.");
	assert(typeof config.keepIntermediateDocx == "boolean" || typeof config.keepIntermediateDocx == "undefined", "keepIntermediateDocx must be a boolean or undefined.");
	assert(typeof config.disableMacros == "boolean" || typeof config.disableMacros == "undefined", "disableMacros must be a boolean or undefined.");
	assert(typeof config.progress == "function" || typeof config.progress == "undefined", "Progress callback must be a function or undefined.");
	{
		const extraProps = getExtraProperties(config,
			["input", "output", "format", "keepIntermediateDocx", "disableMacros", "progress"],
		);
		assert(extraProps.length == 0, `Found unknown properties in config: ${extraProps.join(', ')}`);
	}

	const renderPDF = config.format === "pdf" || (!config.format && !!config.output?.endsWith(".pdf"));
	const removeIntermediateDocx = !config.keepIntermediateDocx;
	const disableMacros = !!config.disableMacros;

	assert(!(disableMacros && renderPDF), "Macros must be enabled to render PDF output.");

	const warnings: string[] = [];
	const logPS: string[] = [];
	let totalPercent = 0;
	const handleProgress = config.progress
		? (increment: number, message: string) =>
		{
			totalPercent = Math.min(totalPercent + increment, 99);
			config.progress!(totalPercent, message);
		}
		: undefined;

	try
	{
		const { fout, err, errS } = await render({
			progress: handleProgress,
			assets: getAssetsDir(),
			file: config.input,
			output: config.output,
			renderPDF,
			removeIntermediateDocx,
			disableMacros,
			logwarn: msg => warnings.push(msg),
			logPS: msg => logPS.push(msg),
			logPSError: msg => logPS.push(msg),
		});
		config.progress?.(100, "Done!");
		function throwMDE(code: MDRenderErrorCode, msg: string)
		{
			throw new MDRenderError(code, msg, fout, warnings, logPS, errS ? { cause: errS } : undefined);
		};
		if (err == "noPS") throwMDE("noPS", `Failed to initialize PowerShell. Ensure PowerShell is installed and explicitly added to your system's PATH environment variable.`);
		if (err == "inPS") throwMDE("inPS", `An unexpected error occurred executing commands inside PowerShell. Verify that Microsoft Word is properly installed and licensed.`);
		if (err == "vba") throwMDE("vba", `Microsoft Word VBA Macro execution failed: ${errS}`);
		if (err == "pdf") throwMDE("pdf", `Failed to export document to PDF.`);
		if (err == "noWin") throwMDE("noWin", `Platform restriction: Extended formatting macros and PDF rendering are only supported natively on Windows systems.`);

		let intermediateDocxPath: string | undefined;
		if (renderPDF)
		{
			const pin = path.parse(path.resolve(config.input));
			const fname = pin.name.endsWith(".g") ? pin.name.slice(0, -2) : pin.name;
			const pout = config.output ? path.parse(path.resolve(config.output)) : undefined;
			intermediateDocxPath = pout ? path.join(pout.dir, pout.name + ".docx") : path.join(pin.dir, fname + ".docx");
		}

		return {
			filePath: fout,
			...(intermediateDocxPath && { intermediateDocxPath }),
			warnings
		};
	}
	catch (x)
	{
		if (x instanceof MDRenderError) throw x;
		const message = x instanceof Error ? x.message : String(x);
		throw new MDRenderError("unknown", `An unhandled internal error occurred during rendering: ${message}`, null, warnings, logPS, { cause: x });
	}
}

/** Error codes identifying unique failure points in the compilation. */
export type MDRenderErrorCode = "unknown" | "noPS" | "inPS" | "vba" | "pdf" | "noWin";

/**
 * Custom error thrown when compilation or rendering fails.
 * Captures historical console buffers, partial file states, and downstream environment warnings.
 */
export class MDRenderError extends Error
{
	/**
	 * File path of the partially rendered `.docx` file, if available when the error occurred.
	 */
	public renderedFile: string | null;

	/**
	 * Code indicating the underlying cause of the failure:
	 * - `unknown`: An unhandled or unexpected internal runtime error.
	 * - `noPS`: PowerShell could not be started or found in the system PATH.
	 * - `inPS`: A failure occurred inside PowerShell; MS Word may be missing or corrupt.
	 * - `vba`: An error occurred during the execution of internal Word VBA macros.
	 * - `pdf`: A failure occurred specifically during the PDF export phase.
	 * - `noWin`: The operation requires Windows capabilities that are unavailable on the host OS.
	 */
	public code: MDRenderErrorCode;

	/**
	 * Non-fatal warnings captured during the process *before* the fatal error was thrown.
	 */
	public warnings: string[];

	/**
	 * Standard output and error streams aggregated from the underlying PowerShell shell session.
	 */
	public powershellLog: string[];

	/**
	 * @param code - Machine-readable error code.
	 * @param message - Human-readable error details.
	 * @param renderedFile - Path to a partial output file, if any.
	 * @param warnings - List of non-fatal warnings gathered prior to the exception.
	 * @param powershellLog - List of shell execution strings collected during execution.
	 * @param options - Standard native error options (e.g., to preserve the error `cause`).
	 */
	constructor(code: MDRenderErrorCode, message: string, renderedFile: string | null, warnings: string[] = [], powershellLog: string[], options?: ErrorOptions)
	{
		super(message, options);
		this.name = "MDRenderError";
		this.code = code;
		this.renderedFile = renderedFile;
		this.warnings = warnings;
		this.powershellLog = powershellLog;

		if (Error.captureStackTrace)
			Error.captureStackTrace(this, MDRenderError);
	}
}

/**
 * Resolves the path to the internal asset directory.
 * Accommodates both CommonJS (`__dirname`) and ESM (`import.meta.url`) contexts safely.
 */
function getAssetsDir()
{
	if (typeof __dirname !== "undefined")
		return path.resolve(__dirname, "../assets");
	const metaUrl = new Function("return import.meta.url")();
	return path.resolve(path.dirname(fileURLToPath(metaUrl)), "../assets");
}

/**
 * Filters an object to identify any unexpected properties that do not match an allowed whitelist.
 * Used primarily for defensive runtime verification against untyped JS consumption.
 * @param configObj - The base object configuration to parse.
 * @param allowedConfigKeys - Keys that are valid configuration targets.
 * @returns An array containing keys that failed the evaluation whitelist.
 */
function getExtraProperties(configObj: any, allowedConfigKeys: string[])
{
	return Object.keys(configObj).filter(
		(key) => !allowedConfigKeys.includes(key)
	);
}