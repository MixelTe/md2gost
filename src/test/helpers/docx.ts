import PizZip from "pizzip";
import * as fs from "node:fs";

export function openDocx(file: string)
{
	return new PizZip(fs.readFileSync(file));
}

export function xml(zip: PizZip, name: string)
{
	const entry = zip.file(name);
	if (!entry) throw new Error(`DOCX is missing ${name}`);
	return entry.asText();
}

export function hasFile(zip: PizZip, name: string)
{
	return !!zip.file(name);
}
