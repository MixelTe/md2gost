import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

export async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T>
{
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "md2gost-test-"));
	try { return await fn(dir); }
	finally { await fs.rm(dir, { recursive: true, force: true }); }
}

export async function writeMarkdown(dir: string, markdown: string, name = "report.g.md")
{
	const file = path.join(dir, name);
	await fs.writeFile(file, markdown, "utf8");
	return file;
}

/** A valid 1×1 transparent PNG, kept inline so fixtures need no external files. */
export async function writePng(dir: string, name = "image.PNG")
{
	const file = path.join(dir, name);
	await fs.writeFile(file, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL9WQAAAABJRU5ErkJggg==", "base64"));
	return file;
}
