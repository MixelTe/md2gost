import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";

export type OfficeEngineType = "auto" | "word" | "libreoffice";
const execute = promisify(execFile);

export class OfficeError extends Error
{
	constructor(public readonly code: "noOffice" | "office", message: string, options?: ErrorOptions)
	{
		super(message, options);
	}
}

export async function resolveOfficeEngine(engine: OfficeEngineType, signal?: AbortSignal | null): Promise<Exclude<OfficeEngineType, "auto">>
{
	if (engine == "word")
	{
		if (process.platform != "win32") throw new OfficeError("noOffice", "Microsoft Word requires Windows. Select the LibreOffice engine on this platform.");
		return engine;
	}
	if (engine == "libreoffice" || process.platform != "win32") return "libreoffice";
	// Check both registry views without starting Word. A 32-bit Office installation
	// can have an empty LocalServer32 default value in the 64-bit view.
	const options = { windowsHide: true, timeout: 10000, signal: signal || undefined };
	for (const view of ["/reg:64", "/reg:32"])
	{
		signal?.throwIfAborted();
		try
		{
			const registration = await execute("reg.exe", ["query", "HKCR\\Word.Application\\CLSID", "/ve", view], options);
			const clsid = /\{[0-9a-f-]+\}/i.exec(registration.stdout)?.[0];
			if (!clsid) continue;
			const server = await execute("reg.exe", ["query", `HKCR\\CLSID\\${clsid}\\LocalServer32`, "/ve", view], options);
			const executable = /REG_(?:EXPAND_)?SZ\s+"?(.+?\.exe)(?:"|\s|$)/i.exec(server.stdout)?.[1]
				.replace(/%([^%]+)%/g, (match, name: string) => process.env[name] || match);
			if (executable && await findExecutable([executable])) return "word";
		}
		catch { signal?.throwIfAborted(); }
	}
	return "libreoffice";
}

async function findExecutable(candidates: string[]): Promise<string | undefined>
{
	for (const candidate of candidates.filter(Boolean))
	{
		const names = path.isAbsolute(candidate) || candidate.includes("/") || candidate.includes("\\") ? [path.resolve(candidate)] :
			(process.env.PATH || "").split(path.delimiter).map(dir => path.join(dir, candidate));
		for (const name of names)
		{
			try
			{
				await fs.access(name, constants.X_OK);
				if ((await fs.stat(name)).isFile()) return name;
			}
			catch { /* Try the next installation or PATH entry. */ }
		}
	}
}

async function libreOfficeRuntime(options: { sofficePath?: string, unoPythonPath?: string, signal?: AbortSignal | null })
{
	const { signal } = options;
	const sofficePath = options.sofficePath || process.env.SOFFICE_PATH;
	const unoPythonPath = options.unoPythonPath || process.env.UNO_PYTHON_PATH;
	const installations = process.platform == "win32" ?
		[process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter((dir): dir is string => !!dir).map(dir => path.join(dir, "LibreOffice", "program", "soffice.com")) :
		process.platform == "darwin" ? ["/Applications/LibreOffice.app/Contents/MacOS/soffice", path.join(os.homedir(), "Applications/LibreOffice.app/Contents/MacOS/soffice")] : [];
	let soffice = await findExecutable(sofficePath ? [sofficePath] : [...installations, process.platform == "win32" ? "soffice.com" : "soffice"]);
	if (!soffice) throw new OfficeError("noOffice", `LibreOffice was not found${sofficePath ? `: "${sofficePath}"` : ""}. Install LibreOffice Writer and specify its executable path in the extension settings or SOFFICE_PATH.`);
	if (process.platform == "win32" && path.basename(soffice).toLowerCase() == "soffice.exe")
		soffice = await findExecutable([path.join(path.dirname(soffice), "soffice.com")]) || soffice;
	const candidates = unoPythonPath ? [unoPythonPath] : [
		...(process.platform == "win32" ? [path.join(path.dirname(soffice), "python.exe")] : []),
		...(process.platform == "darwin" ? [path.resolve(path.dirname(soffice), "../Resources/python")] : []),
		process.platform == "win32" ? "python.exe" : "python3",
	];
	const failures: string[] = [];
	for (const candidate of candidates)
	{
		signal?.throwIfAborted();
		const python = await findExecutable([candidate]);
		if (!python)
		{
			failures.push(`${candidate}: executable was not found`);
			continue;
		}
		try
		{
			await execute(python, ["-c", "import uno"], {
				windowsHide: true, timeout: 15000, signal: signal || undefined,
				env: { ...process.env, PYTHONUTF8: "1", PYTHONDONTWRITEBYTECODE: "1" },
			});
			return { soffice, python };
		}
		catch (error)
		{
			signal?.throwIfAborted();
			failures.push(`${python}: ${error instanceof Error ? error.message : error}`);
		}
	}
	throw new OfficeError("noOffice", `Python with LibreOffice UNO support was not found. On Linux install python3-uno for the system Python; otherwise specify a compatible interpreter in the extension settings or UNO_PYTHON_PATH. ${failures.join("\n")}`);
}

export function runDocxMacro(progress: (stage: string) => void, log: (msg: string) => void, logError: (msg: string) => void, assets: string, cwd: string, fin: string, fout: string, renderPDF: boolean, signal: AbortSignal | null)
{
	const script = path.join(assets, "run.ps1");
	const templateMacro = path.join(assets, "template.dotm");
	// console.log(template);
	return new Promise<boolean>((res, rej) =>
	{
		if (signal?.aborted)
			return rej(signal.reason ?? new Error("Aborted before execution started"));
		const child = spawn("powershell", [
			"-NoProfile", "-ExecutionPolicy", "Bypass",
			"-File", script,
			"-InputDoc", fin,
			"-OutputDoc", fout,
			"-MacroTemplate", templateMacro,
			...(renderPDF ? ["-RenderPDF"] : []),
		], {
			cwd,
			detached: process.platform !== "win32", // Enables PGID on POSIX
			// detached: true,
			// shell: true,
		});

		let wordPid: number | null = null;

		let onAbort: (() => void) | undefined;
		if (signal)
		{
			onAbort = () =>
			{
				logError("Operation aborted. Terminating process tree...");
				killProcessTree(child, wordPid);
			};
			signal.addEventListener("abort", onAbort, { once: true });
		}

		child.stdout.on("data", data =>
		{
			const raw = `${data}`;

			const pidMatch = /\[WordPID:(\d+)\]/.exec(raw);
			if (pidMatch) wordPid = parseInt(pidMatch[1], 10);

			const m = /\[\*(\d)\]/.exec(raw);
			if (m) progress(m[1]);
			log(raw);
		});
		let ok = true;
		child.stderr.on("data", data =>
		{
			ok = false;
			logError(`${data}`);
		});

		child.on("close", code =>
		{
			if (signal && onAbort)
			{
				signal.removeEventListener("abort", onAbort);
			}
			if (signal?.aborted) rej(signal.reason ?? new Error("Job timed out or aborted"));
			else res(ok && code === 0);
		});

		child.on("error", err =>
		{
			if (signal && onAbort)
			{
				signal.removeEventListener("abort", onAbort);
			}
			rej(err);
		});
	});
}

export async function runLibreOffice(options: {
	assets: string, input: string, output: string, cwd: string, workdir: string, renderPDF: boolean,
	log: (message: string) => void, logError: (message: string) => void, progress: (stage: string) => void,
	signal?: AbortSignal | null,
	sofficePath?: string, unoPythonPath?: string,
})
{
	const { soffice, python } = await libreOfficeRuntime(options);
	const script = process.env.MACRO_ENGINE_PATH || path.join(options.assets, "macro_engine.py");
	try { await fs.access(script); }
	catch (error) { throw new OfficeError("noOffice", `LibreOffice processor was not found: ${script}`, { cause: error }); }
	options.signal?.throwIfAborted();
	// Keep Linux profiles off bind/network output volumes; Writer needs local locks.
	const profile = await fs.mkdtemp(path.join(process.platform == "win32" ? options.workdir : os.tmpdir(), "md2gost-profile-"));
	try
	{
		await new Promise<void>((resolve, reject) =>
		{
			const child = spawn(python, [script, "--input", options.input, "--output", options.output,
				"--soffice", soffice, "--work-dir", options.workdir, "--profile-dir", profile, "--shared-process-group", ...(options.renderPDF ? ["--render-pdf"] : [])], {
				cwd: options.cwd, windowsHide: true, detached: process.platform != "win32",
				env: { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" },
			});
			let failure: unknown;
			const stop = (reason: unknown) =>
			{
				failure = reason;
				killProcessTree(child);
			};
			const onAbort = () => stop(options.signal?.reason || new Error("Office operation aborted"));
			options.signal?.addEventListener("abort", onAbort, { once: true });
			const timeout = setTimeout(() => stop(new OfficeError("office", "LibreOffice processing exceeded the 10 minute time limit.")), 600000);
			const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
			lines.on("line", line =>
			{
				options.log(line + "\n");
				const stage = /\[\*(\d)\]/.exec(line)?.[1];
				if (stage) options.progress(stage);
			});
			const errors = createInterface({ input: child.stderr, crlfDelay: Infinity });
			errors.on("line", line => (/^(Warning:|warn:)/i.test(line) ? options.log : options.logError)(line + "\n"));
			const cleanup = () =>
			{
				clearTimeout(timeout);
				options.signal?.removeEventListener("abort", onAbort);
				lines.close();
				errors.close();
			};
			child.on("error", error => { cleanup(); reject(new OfficeError("noOffice", `Could not start the LibreOffice processor: ${error.message}`, { cause: error })); });
			// An office descendant may hold stderr open after Python has exited.
			// Reap its owned POSIX group on exit, before waiting for pipe closure.
			child.on("exit", () => { if (process.platform != "win32") killProcessTree(child); });
			child.on("close", code =>
			{
				cleanup();
				if (failure) reject(failure);
				else if (code !== 0) reject(new OfficeError(code == 3 ? "noOffice" : "office", `LibreOffice ${code == 3 ? "startup" : "processing"} failed (exit code ${code}). See the office log for details.`));
				else resolve();
			});
			if (options.signal?.aborted) onAbort();
		});
	}
	finally
	{
		await fs.rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
	}
}

/**
 * Cross-platform process tree killer.
 * - On Windows: Uses taskkill /T /F to terminate the entire process hierarchy.
 * - On POSIX: Sends SIGKILL to the negative PID (process group).
 */
export function killProcessTree(child: ChildProcess, wordPid?: number | null): void
{
	if (!child.pid) return;

	if (process.platform === "win32")
	{
		if (wordPid)
		{
			// Send polite WM_CLOSE to Word (no /F flag)
			execFile("taskkill", ["/PID", String(wordPid)], { windowsHide: true }, () =>
			{
				setTimeout(() =>
				{
					execFile("taskkill", ["/PID", String(wordPid), "/F"], { windowsHide: true }, () => {});
					setTimeout(() =>
					{
						killProcessTree(child);
					}, 2000);
				}, 2000);

			});
		}
		else
		{
			execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => { });
		}
	}
	else
	{
		try
		{
			process.kill(-child.pid, "SIGKILL");
		}
		catch {}
	}
}
