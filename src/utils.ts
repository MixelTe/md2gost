export function lt<T, R>(v: T, fn: (v: T) => R)
{
	return fn(v);
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
		return Math.floor(rnd() * (maxmin - max)) + max;
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
			while (str.endsWith(ch))
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

import fs from "fs/promises";
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

import { exec } from "child_process";
export function openFile(path: string)
{
	const command =
		process.platform === "win32" ? `start "" "${path}"` // Windows
			: process.platform === "darwin" ? `open "${path}"` // macOS
				: `xdg-open "${path}"`; // Linux

	exec(command, (err, stdout, stderr) =>
	{
		if (err)
		{
			console.error(`exec error: ${err}`);
			return;
		}
	});

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
		return Math.round(255 * color).toString(16).padStart(2, '0');
	};
	return `${f(0)}${f(8)}${f(4)}`;
}
