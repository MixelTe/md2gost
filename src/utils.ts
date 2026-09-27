import fs from "fs/promises";
import fss from "fs";
import { spawn } from "child_process";
import * as path from "node:path";
import { UserInputError } from "./errors";

export type JSONValue = string | number | boolean | null | { [x: string]: JSONValue } | Array<JSONValue>;
export type JSONDict = Record<string, JSONValue>;
export function lt<T, R>(v: T | null | undefined, fn: (v: T) => R)
{
	if (v) return fn(v);
	return null;
}
export function also<T>(v: T, fn: (v: T) => any)
{
	fn(v);
	return v;
}
export function choice<T>(...options: T[]): T
{
	return options[randomInt(options.length)];
}
export function randomInt(max: number): number;
export function randomInt(min: number, max: number, rnd?: () => number): number;
export function randomInt(maxmin: number, max?: number, rnd = Math.random)
{
	if (max != undefined)
		return Math.floor(rnd() * (max - maxmin)) + maxmin;
	return Math.floor(rnd() * maxmin);
}

export function trimEnd(str: string, ...chs: string[])
{
	if (!chs || chs.length == 0) return str.trimEnd();
	let trimmed = false;
	do
	{
		trimmed = false;
		for (const ch of chs)
			while (str.endsWith(ch))
			{
				str = str.slice(0, -ch.length);
				trimmed = true;
			}
	}
	while (trimmed);
	return str;
}

export function trimStart(str: string, ...chs: string[])
{
	if (!chs || chs.length == 0) return str.trimStart();
	let trimmed = false;
	do
	{
		trimmed = false;
		for (const ch of chs)
			while (str.startsWith(ch))
			{
				str = str.slice(ch.length);
				trimmed = true;
			}
	}
	while (trimmed);
	return str;
}

export function toCapitalCase(str: string)
{
	return str.slice(0, 1).toUpperCase() + str.slice(1);
}

export type Writeable<T> = { -readonly [P in keyof T]: T[P] };
export type DeepWriteable<T> = { -readonly [P in keyof T]: DeepWriteable<T[P]> };
export type SetProgressFn = (increment: number, message: string) => void;

export async function checkIfFileIsBlocked(path: string)
{
	let file;
	try
	{
		file = await fs.open(path, "r+");
		return false;
	}
	catch (err: any)
	{
		if (!err) return false;
		if (err.code === "EBUSY" || err.code === "EACCES" || err.code === "EPERM") return true;
		if (err.code === "ENOENT") return false;
		throw err;
	}
	finally
	{
		if (file) await file.close();
	}
}

export function openFile(filepath: string)
{
	const command = process.platform === "win32" ? "explorer.exe"
		: process.platform === "darwin" ? "open" : "xdg-open";
	const child = spawn(command, [filepath], { detached: true, stdio: "ignore" });
	child.on("error", err => console.error(`open error: ${err}`));
	child.unref();
}

/**
 * Convert HSL color object to hex string without hash symbol.
 * @param h Hue (0-360)
 * @param s Saturation (0-100)
 * @param l Lightness (0-100)
 */
export function hslToHex(h: number, s: number, l: number): string
{
	l /= 100;
	const a = s * Math.min(l, 1 - l) / 100;
	const f = (n: number) =>
	{
		const k = (n + h / 30) % 12;
		const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
		return Math.round(255 * color).toString(16).padStart(2, "0");
	};
	return `${f(0)}${f(8)}${f(4)}`;
}


export function repeat(n: number): number[];
export function repeat<T>(n: number, v: T | ((i: number) => T)): T[];
export function repeat<T>(n: number, v?: T | ((i: number) => T)): T[]
{
	if (v === undefined) v = i => i as T;
	return new Array(n).fill(null).map((_, i) => v instanceof Function ? v(i) : v);
}


/**
 * Resolves a path to its canonical absolute path while allowing part of the
 * path to not exist.
 *
 * If the complete path exists, this behaves like `fs.realpath()`. Otherwise,
 * it walks up the path until it finds an existing ancestor, resolves that
 * ancestor through any symbolic links, and appends the missing path segments.
 *
 * @param inputPath The path to resolve. Relative paths are resolved against
 * the current working directory.
 * @returns The resolved absolute path.
 * @throws Any filesystem error other than `ENOENT` or `ENOTDIR`.
 */
export function realpathAllowMissing(inputPath: string): string
{
	const absolute = path.resolve(inputPath);

	try
	{
		return fss.realpathSync(absolute);
	}
	catch (err: unknown)
	{
		if (!isMissingPathError(err))
			throw err;
	}

	const missingParts: string[] = [];
	let current = absolute;

	while (true)
	{
		const parent = path.dirname(current);

		if (parent === current)
			return absolute;

		missingParts.unshift(path.basename(current));
		current = parent;

		try
		{
			const realParent = fss.realpathSync(current);
			return path.resolve(realParent, ...missingParts);
		}
		catch (err: unknown)
		{
			if (!isMissingPathError(err))
				throw err;
		}
	}
}

function isMissingPathError(err: unknown): err is NodeJS.ErrnoException
{
	return (
		err instanceof Error &&
		"code" in err &&
		(err.code === "ENOENT" || err.code === "ENOTDIR")
	);
}

export function getSafePathResolver(workdir: string, checkFilesIsInsidePath: string | false)
{
	const allowedRealPath = checkFilesIsInsidePath === false ? false
		: realpathAllowMissing(checkFilesIsInsidePath === "" ? workdir : checkFilesIsInsidePath);

	return (fname: string): string =>
	{
		if (process.platform != "win32") fname = fname.replaceAll("\\", "/");
		if (process.platform == "win32" && fname.startsWith("/")) fname = "." + fname;
		const targetPath = path.isAbsolute(fname)
			? path.resolve(fname)
			: path.resolve(workdir, fname);
		if (allowedRealPath !== false)
		{
			const targetRealPath = realpathAllowMissing(targetPath); // Resolve symlinks
			const relative = path.relative(allowedRealPath, targetRealPath);

			const isOutside = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
			if (isOutside) throw new UserInputError(`Access denied: "${fname}" resolves outside the working directory.`);
		}
		return targetPath;
	};
}


export function deepOverwrite(target: JSONDict, source: JSONDict): JSONDict
{
	const result: JSONDict = { ...target };

	for (const [key, sourceValue] of Object.entries(source))
	{
		if (key === "__proto__" || key === "prototype" || key === "constructor")
			continue;
		const targetValue = Object.hasOwn(result, key) ? result[key] : undefined;
		result[key] = isJSONDict(targetValue) && isJSONDict(sourceValue) ?
			deepOverwrite(targetValue, sourceValue) :
			sourceValue;
	}

	return result;

	function isJSONDict(value: JSONValue | undefined): value is JSONDict
	{
		return value !== null && typeof value === "object" && !Array.isArray(value);
	}
}
