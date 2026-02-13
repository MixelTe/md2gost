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
	return options[Math.floor(Math.random() * options.length)];
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
