import path from "path";
import fs from "fs/promises";
import { render } from "./main";
import { UserInputError } from "./errors";
import type { JSONDict } from "./utils";
import type { TemplateExecOptions } from "./preprocessor";
import type { OfficeEngineType } from "./office";

export { UserInputError, JSONDict, TemplateExecOptions, OfficeEngineType as OfficeEngine };
export { reverseDocx, inspectDocx } from "./antirender";
export type { MDReverseConfig, MDReverseResult, MDInspectConfig, MDInspectResult, DocxWarning } from "./antirender";

declare const __MD2GOST_DIRNAME__: string;

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
	 * @note Generating `.pdf` files requires Microsoft Word on Windows or LibreOffice with Python UNO.
	 * @defaultValue inferred From the `output` filename extension if present, otherwise `"docx"`.
	 */
	format?: "docx" | "pdf";

	/**
	 * If `true`, retains the intermediate `.docx` file in the output directory after successfully generating a PDF.
	 * @defaultValue `false`
	 */
	keepIntermediateDocx?: boolean;

	/**
	 * Disables office postprocessing. When `true`, a basic `.docx` render is performed entirely in Node.js
	 * without requiring Microsoft Word, LibreOffice or Python.
	 * @note PDF generation is unavailable when macros are disabled.
	 * @defaultValue `false`
	 */
	disableMacros?: boolean;

	/**
	 * Office postprocessor. Auto prefers registered Word on Windows, otherwise LibreOffice.
	 * Linux and macOS use LibreOffice. Skipped when no postprocessing is needed.
	 * @defaultValue `"auto"`
	 */
	engine?: OfficeEngineType;

	/**
	 * Maps internal outputs to specific log levels:
	 * - **info**: Shadows {@link progress} and info in {@link MDRenderError.officeLog}
	 * - **warn**: Shadows {@link MDRenderResult.warnings} (and {@link MDRenderError.warnings})
	 * - **error**: Shadows errors in {@link MDRenderError.officeLog}
	 */
	logger?: { info: (msg: string) => void, warn: (msg: string) => void, error: (msg: string) => void };

	/**
	 * Optional callback function triggered periodically to report the total rendering progress.
	 * @param totalPercent - The total calculated completion progress, clamped between 0 and 100.
	 * @param message - A human-readable description of the active step.
	 */
	progress?: (totalPercent: number, message: string) => void;

	/**
	 * Optional `AbortSignal` used to cancel the rendering process.
	 */
	abortSignal?: AbortSignal;

	/**
	 * Restricts referenced files (e.g. images or `include` documents) to the specified directory.
	 *
	 * When set to a path, any referenced file that resolves outside that directory throws
	 * a `userInput` error. Symlinks are resolved before the containment check.
	 *
	 * When set to an empty string, the source file's working directory is used.
	 *
	 * When `false`, path containment checks are disabled and files outside the working
	 * directory may be referenced.
	 *
	 * @defaultValue `""`
	 */
	checkFilesIsInsidePath?: string | false;

	/**
	 * Variables available to `{{name}}` substitutions in the root Markdown document.
	 * Included Markdown files inherit these values and may override them with include parameters.
	 * When omitted, the root document is not treated as a template.
	 */
	variables?: JSONDict;

	/**
	 * Controls template loops, includes, and resource limits.
	 * @defaultValue `{ allowIncludes: true, allowLoops: true }`
	 * @example
	 * ```ts
	 * templateOptions: {
	 * 	allowLoops: true,
	 * 	allowIncludes: true,
	 * 	maxLoopIterations: 100,
	 * 	maxTotalIterations: 2_000,
	 * 	maxDepth: 20,
	 * 	maxIncludeDepth: 10,
	 * 	maxIncludes: 50,
	 * 	maxFileLength: 200_000,
	 * 	maxTotalInputLength: 1_000_000,
	 * 	maxGeneratedLength: 2_000_000,
	 * }
	 * ```
	 */
	templateOptions?: TemplateExecOptions;
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
 * @throws {MDRenderError} Thrown if compilation fails. Inspect `cause`, `code` and `officeLog` for details.
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
 * 		error.warnings.forEach(w => console.warn(`[W] ${w}`));
 *
 * 		if (error.officeLog.length > 0)
 * 			console.error("Office Logs:\n", error.officeLog.join(""));
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
	assert(config.engine === undefined || ["auto", "word", "libreoffice"].includes(config.engine), "engine must be auto, word or libreoffice.");
	assert(typeof config.checkFilesIsInsidePath == "string" || config.checkFilesIsInsidePath === false || typeof config.checkFilesIsInsidePath == "undefined", "checkFilesIsInsidePath must be a string, false or undefined.");
	assert(typeof config.progress == "function" || typeof config.progress == "undefined", "Progress callback must be a function or undefined.");
	assert((typeof config.variables == "object" && config.variables !== null && !Array.isArray(config.variables)) || typeof config.variables == "undefined", "variables must be an object or undefined.");
	assert((typeof config.templateOptions == "object" && config.templateOptions !== null && !Array.isArray(config.templateOptions)) || typeof config.templateOptions == "undefined", "templateOptions must be an object or undefined.");
	if (config.templateOptions)
	{
		const options = config.templateOptions;
		const booleanProps = ["allowLoops", "allowIncludes"] as const;
		const limitProps = ["maxLoopIterations", "maxTotalIterations", "maxDepth", "maxIncludeDepth", "maxIncludes", "maxFileLength", "maxTotalInputLength", "maxGeneratedLength"] as const;
		const extraProps = getExtraProperties(options, [...booleanProps, ...limitProps]);
		assert(extraProps.length == 0, `Found unknown properties in config.templateOptions: ${extraProps.join(", ")}`);
		booleanProps.forEach(p =>
			assert(options[p] === undefined || typeof options[p] == "boolean", `config.templateOptions.${p} must be a boolean or undefined.`),
		);
		limitProps.forEach(p =>
			assert(options[p] === undefined || (Number.isSafeInteger(options[p]) && options[p] >= 0), `config.templateOptions.${p} must be a non-negative safe integer or undefined.`),
		);
	}
	assert(config.abortSignal instanceof AbortSignal || typeof config.abortSignal == "undefined", "abortSignal must be an AbortSignal or undefined.");
	{
		const extraProps = getExtraProperties(config,
			["input", "output", "format", "keepIntermediateDocx", "disableMacros", "engine", "progress", "logger", "abortSignal", "checkFilesIsInsidePath", "variables", "templateOptions"],
		);
		assert(extraProps.length == 0, `Found unknown properties in config: ${extraProps.join(", ")}`);
	}
	assert((typeof config.logger == "object" && config.logger) || typeof config.logger == "undefined", "Logger must be a object or undefined.");
	const logger = config.logger;
	if (logger)
	{
		const props = ["info", "warn", "error"] as const;
		const extraProps = getExtraProperties(logger, props as unknown as string[]);
		assert(extraProps.length == 0, `Found unknown properties in config.logger: ${extraProps.join(", ")}`);
		props.forEach(p =>
			assert(typeof logger[p] == "function", `config.logger.${p} must be a function.`),
		);
	}

	let outputIsDirectory = false;
	if (config.output)
	{
		const info = await fs.stat(config.output).catch(error =>
		{
			if (error.code == "ENOENT" || error.code == "ENOTDIR") return undefined;
			throw error;
		});
		outputIsDirectory = !!info?.isDirectory() || config.output.endsWith("/") || config.output.endsWith("\\") || !path.extname(config.output);
	}
	const outputExtension = !outputIsDirectory && config.output ? path.extname(config.output).toLowerCase() : undefined;
	const renderPDF = config.format === "pdf" || (!config.format && outputExtension === ".pdf");
	const removeIntermediateDocx = !config.keepIntermediateDocx;
	const disableMacros = !!config.disableMacros;
	const engine = config.engine ?? "auto";
	const checkFilesIsInsidePath = config.checkFilesIsInsidePath === undefined ? "" : config.checkFilesIsInsidePath;

	assert(!(disableMacros && renderPDF), "Office postprocessing must be enabled to render PDF output.");
	if (outputExtension && outputExtension !== ".docx" && outputExtension !== ".pdf")
		throw new TypeError("Output file extension must be either '.docx' or '.pdf'.");
	if (outputExtension && outputExtension !== (renderPDF ? ".pdf" : ".docx"))
		throw new TypeError(`Output file extension must match the selected '${renderPDF ? "pdf" : "docx"}' format.`);

	const pin = path.parse(path.resolve(config.input));
	const fname = pin.name.endsWith(".g") ? pin.name.slice(0, -2) : pin.name;

	let resolvedOutput = config.output;
	if (resolvedOutput)
	{
		if (outputIsDirectory)
		{
			const ext = renderPDF ? ".pdf" : ".docx";
			resolvedOutput = path.join(resolvedOutput, fname + ext);
		}
	}

	const warnings: string[] = [];
	const officeLog: string[] = [];
	let totalPercent = 0;
	const handleProgress = (increment: number, message: string) =>
	{
		totalPercent = Math.min(totalPercent + increment, 99);
		config.progress?.(totalPercent, message);
	};

	try
	{
		const { fout, err, errS } = await render({
			progress: handleProgress,
			assets: getAssetsDir(),
			file: config.input,
			output: resolvedOutput,
			renderPDF,
			removeIntermediateDocx,
			disableMacros,
			engine,
			checkFilesIsInsidePath,
			variables: config.variables,
			templateOptions: config.templateOptions,
			loginfo: logger?.info,
			logwarn: msg => { logger?.warn(msg); warnings.push(msg); },
			logPS: msg => { logger?.info(msg); officeLog.push(msg); },
			logPSError: msg => { logger?.error(msg); officeLog.push(msg); },
			signal: config.abortSignal,
		});
		function throwMDE(code: MDRenderErrorCode, msg: string)
		{
			throw new MDRenderError(code, msg, fout, warnings, officeLog, errS ? { cause: errS } : undefined);
		}
		if (err == "noOffice" || err == "office") throwMDE(err, errS instanceof Error ? errS.message : String(errS));
		if (err == "noPS") throwMDE("noPS", "Failed to initialize PowerShell. Ensure PowerShell is installed and added to PATH.");
		if (err == "inPS") throwMDE("inPS", "Microsoft Word postprocessing failed. Check the office log and the Word installation.");
		if (err == "vba") throwMDE("vba", `Microsoft Word VBA Macro execution failed: ${errS}`);
		if (err == "pdf") throwMDE("pdf", `Failed to export document to PDF.`);
		config.progress?.(100, "Done!");

		let intermediateDocxPath: string | undefined;
		if (renderPDF && !removeIntermediateDocx)
		{
			const pout = resolvedOutput ? path.parse(path.resolve(resolvedOutput)) : undefined;
			intermediateDocxPath = pout ? path.join(pout.dir, pout.name + ".docx") : path.join(pin.dir, fname + ".docx");
		}

		return {
			filePath: fout,
			...(intermediateDocxPath && { intermediateDocxPath }),
			warnings,
		};
	}
	catch (x)
	{
		if (x instanceof MDRenderError) throw x;
		if (x instanceof UserInputError) throw new MDRenderError("userInput", x.message, null, warnings, officeLog, { cause: x });
		const message = x instanceof Error ? x.message : String(x);
		throw new MDRenderError("unknown", `An unhandled internal error occurred during rendering: ${message}`, null, warnings, officeLog, { cause: x });
	}
}

/** Error codes identifying unique failure points in the compilation. */
export type MDRenderErrorCode = "unknown" | "userInput" | "noPS" | "inPS" | "vba" | "pdf" | "noWin" | "noOffice" | "office";

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
	 * - `userInput`: Invalid user input or Markdown document structure.
	 * - `noPS`: PowerShell could not be started or found in the system PATH.
	 * - `inPS`: A failure occurred inside PowerShell; MS Word may be missing or corrupt.
	 * - `vba`: An error occurred during the execution of internal Word VBA macros.
	 * - `noOffice`: The selected office engine or its Python UNO dependency is unavailable.
	 * - `office`: LibreOffice postprocessing failed.
	 * - `pdf`: A failure occurred specifically during the PDF export phase.
	 * - `noWin`: Legacy platform restriction code retained for compatibility.
	 */
	public code: MDRenderErrorCode;

	/**
	 * Non-fatal warnings captured during the process *before* the fatal error was thrown.
	 */
	public warnings: string[];

	/**
	 * Standard output and diagnostics from the selected office engine.
	 */
	public officeLog: string[];

	/**
	 * @param code - Machine-readable error code.
	 * @param message - Human-readable error details.
	 * @param renderedFile - Path to a partial output file, if any.
	 * @param warnings - List of non-fatal warnings gathered prior to the exception.
	 * @param officeLog - Output and diagnostics collected from the selected office engine.
	 * @param options - Standard native error options (e.g., to preserve the error `cause`).
	 */
	constructor(code: MDRenderErrorCode, message: string, renderedFile: string | null, warnings: string[] = [], officeLog: string[], options?: ErrorOptions)
	{
		super(message, options);
		this.name = "MDRenderError";
		this.code = code;
		this.renderedFile = renderedFile;
		this.warnings = warnings;
		this.officeLog = officeLog;

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
	return path.resolve(__MD2GOST_DIRNAME__, "../assets");
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
		key => !allowedConfigKeys.includes(key),
	);
}
