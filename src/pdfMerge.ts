import fs from "node:fs/promises";
import path from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRef, PDFString } from "pdf-lib";

/** Copy complete inserted documents and retarget internal links to the copied pages. */
async function appendPDF(target: PDFDocument, file: string, signal?: AbortSignal)
{
	const source = await PDFDocument.load(await fs.readFile(file, { signal }));
	signal?.throwIfAborted();
	const original = source.getPages();
	const copied = await target.copyPages(source, source.getPageIndices());
	const refs = new Map(original.map((page, index) => [page.ref.toString(), copied[index].ref]));
	const names = new Map<string, unknown>();
	const readNames = (tree: PDFDict) =>
	{
		const entries = tree.lookupMaybe(PDFName.of("Names"), PDFArray);
		if (entries) for (let i = 0; i < entries.size(); i += 2)
		{
			const name = entries.lookup(i);
			if (name instanceof PDFString || name instanceof PDFHexString)
				names.set(name.decodeText(), entries.lookup(i + 1));
		}
		const kids = tree.lookupMaybe(PDFName.of("Kids"), PDFArray);
		if (kids) for (let i = 0; i < kids.size(); i++) readNames(kids.lookup(i, PDFDict));
	};
	const nameTree = source.catalog.lookupMaybe(PDFName.of("Names"), PDFDict)?.lookupMaybe(PDFName.of("Dests"), PDFDict);
	if (nameTree) readNames(nameTree);
	const oldNames = source.catalog.lookupMaybe(PDFName.of("Dests"), PDFDict);
	if (oldNames) for (const [name, value] of oldNames.entries()) names.set(name.decodeText(), source.context.lookup(value));
	const destination = (value: unknown): PDFArray =>
	{
		if (value instanceof PDFString || value instanceof PDFHexString || value instanceof PDFName)
			value = names.get(value.decodeText());
		if (value instanceof PDFDict) value = value.lookup(PDFName.of("D"));
		if (!(value instanceof PDFArray)) throw new Error(`Unresolved internal PDF destination in ${file}`);
		const first = value.get(0);
		const ref = first instanceof PDFRef ? refs.get(first.toString()) : first instanceof PDFNumber ? copied[first.asNumber()]?.ref : undefined;
		if (!ref) throw new Error(`Internal PDF destination points outside the inserted document: ${file}`);
		return target.context.obj([ref, ...value.asArray().slice(1)]);
	};
	for (let i = 0; i < copied.length; i++)
	{
		const sourceAnnotations = original[i].node.Annots();
		const targetAnnotations = copied[i].node.Annots();
		if (sourceAnnotations && targetAnnotations) for (let j = 0; j < sourceAnnotations.size(); j++)
		{
			const before = sourceAnnotations.lookup(j, PDFDict);
			const after = targetAnnotations.lookup(j, PDFDict);
			const direct = before.lookup(PDFName.of("Dest"));
			if (direct) after.set(PDFName.of("Dest"), destination(direct));
			const action = before.lookupMaybe(PDFName.of("A"), PDFDict);
			if (action?.get(PDFName.of("S")) === PDFName.of("GoTo"))
				after.lookup(PDFName.of("A"), PDFDict).set(PDFName.of("D"), destination(action.lookup(PDFName.of("D"))));
		}
		target.addPage(copied[i]);
	}
}

/** Manifest from a full-document office export; original page refs retain TOC links. */
export async function assemblePDFManifest(file: string, signal?: AbortSignal): Promise<PDFDocument>
{
	const plan = JSON.parse(await fs.readFile(file, { encoding: "utf8", signal }));
	if (plan.version !== 1 || !Array.isArray(plan.parts)) throw new Error("Unsupported PDF assembly manifest");
	const localFile = (name: unknown) =>
	{
		if (typeof name !== "string" || !/^\d+-(main|include|pdf)\.pdf$/.test(name)) throw new Error("Invalid PDF assembly filename");
		return path.join(path.dirname(file), name);
	};
	const pdf = await PDFDocument.load(await fs.readFile(localFile(plan.main), { signal }));
	const pages = pdf.getPages();
	for (let i = pages.length - 1; i >= 0; i--) pdf.removePage(i);
	let lastPage = 0;
	for (const part of plan.parts)
	{
		signal?.throwIfAborted();
		if (part.type === "main")
		{
			if (!Number.isInteger(part.from) || !Number.isInteger(part.to) || part.from <= lastPage || part.to < part.from || part.to > pages.length)
				throw new Error("Invalid or overlapping PDF assembly page range");
			for (let i = part.from - 1; i < part.to; i++) pdf.addPage(pages[i]);
			lastPage = part.to;
		}
		else if (part.type === "include") await appendPDF(pdf, localFile(part.file), signal);
		else throw new Error("Unknown PDF assembly part");
	}
	if (!pdf.getPageCount()) throw new Error("PDF assembly has no pages");
	return pdf;
}
