const fs = require("fs");
const path = require("path");

if (process.argv.length != 5 && process.argv.length != 8)
{
	const name = path.parse(process.argv[1]).base
	console.log(`Usage: node ${name} path/to/doc.md path/to/doc.patch.md path/to/out.md`);
	console.log(`Usage: node ${name} path/to/doc.md path/to/doc.patch.md path/to/out.md GITHUB_USER REPO_NAME BRANCH`);
	process.exit(1);
}

const BASE_URL = process.argv.length == 8 && `https://raw.githubusercontent.com/${process.argv[5]}/${process.argv[6]}/${process.argv[7]}/`

const README_PATH = path.resolve(process.argv[2]);
const PATCH_PATH = path.resolve(process.argv[3]);
const OUTPUT_PATH = path.resolve(process.argv[4]);

let content = readFile("Source MD", README_PATH).split("\n").map(l => l.trimEnd());
const patch = readFile("MD patch", PATCH_PATH).split("\n").map(l => l.trimEnd());

let patchSec = { start: 0, end: 0 };
while (patchSec = findNextSection(patch, patchSec.end))
{
	const header = patch[patchSec.start];
	const contentSec = findSection(content, header);
	if (!contentSec)
	{
		console.error("Section not found in source: " + header);
		process.exit(1);
	}
	let newLines = patch.slice(patchSec.start, patchSec.end);
	if (newLines.slice(1).join("").replaceAll(/\s/g, "") == "") newLines = [];
	else if (/^\s+#+\s/.exec(newLines[1] || ""))
	{
		newLines.splice(0, 1);
		newLines[0] = newLines[0].trimStart();
	}
	if (/^\s+\[diff\]\s*$/.exec(newLines[1] || ""))
	{
		let oldLines = content.slice(contentSec.start, contentSec.end);
		oldLines[0] = newLines[0];
		newLines = applyDiff(oldLines, newLines.slice(1), header);
	}
	content.splice(contentSec.start, contentSec.end - contentSec.start, ...newLines);
}

let textContent = content.join("\n");

if (BASE_URL)
{
	textContent = textContent
		.replace(/src="\.\/([^"]+)"/g, `src="${BASE_URL}$1"`)
		.replace(/!\[([^\]]*)\]\(\.\/([^)]+)\)/g, `![$1](${BASE_URL}$2)`);

}

fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, textContent, "utf8");
console.log(`Successfully patched MD at ${OUTPUT_PATH}`);

function readFile(name, path)
{
	if (!fs.existsSync(path))
	{
		console.error(`${name} not found at ${path}`);
		process.exit(1);
	}
	return fs.readFileSync(path, "utf8");
}

/** @type {(lines: string[], startLine: number) => {start: number, end: number} | null} */
function findNextSection(lines, startLine)
{
	let start = -1;
	let end = -1;
	let level = -1;
	let codeBlock = "";
	for (let i = startLine; i < lines.length; i++)
	{
		const codeBlockM = /^(```+)/.exec(lines[i]);
		if (codeBlockM)
		{
			if (!codeBlock) codeBlock = codeBlockM[1];
			else if (codeBlock == codeBlockM[1]) codeBlock = "";
		}
		if (codeBlock) continue;
		const headingM = /^(#+)\s/.exec(lines[i]);
		if (!headingM) continue;
		if (start < 0)
		{
			start = i;
			level = headingM[1].length;
		}
		else if (level == 1 || level >= headingM[1].length)
		{
			end = i;
			break;
		}
	}
	// console.log(level, start, end);
	if (start < 0) return null;
	if (end < 0) end = lines.length;
	// console.log(`---\n${lines.slice(start, end).join("\n")}\n---`);
	return { start, end };
}

/** @type {(lines: string[], header: string) => {start: number, end: number} | null} */
function findSection(lines, header)
{
	let start = -1;
	let end = -1;
	const re = /^(#+)\s/;
	const level = re.exec(header)?.[1].length ?? 1;
	let codeBlock = "";

	for (let i = 0; i < lines.length; i++)
	{
		const codeBlockM = /^(```+)/.exec(lines[i]);
		if (codeBlockM)
		{
			if (!codeBlock) codeBlock = codeBlockM[1];
			else if (codeBlock == codeBlockM[1]) codeBlock = "";
		}
		if (codeBlock) continue;
		if (lines[i] == header)
		{
			start = i;
			continue;
		}
		if (start < 0) continue;
		const m = re.exec(lines[i]);
		if (m && (m[1].length <= level || level == 1))
		{
			end = i;
			break;
		}
	}
	// console.log(level, start, end);
	if (start < 0) return null;
	if (end < 0) end = lines.length;
	// console.log(`---\n${lines.slice(start, end).join("\n")}\n---`);
	return { start, end };
}

/** @type {(lines: string[], diff: string[]) => string[]} */
function applyDiff(lines, diff, header)
{
	lines = lines.slice();
	let start = -1;
	let insertAt = 0;

	for (let i = 0; i < diff.length; i++)
	{
		const block = /^([+-]+)\s*$/.exec(diff[i])?.[1];
		if (block && (start < 0 || block.length >= diff[start].trim().length))
		{
			processBlock(i);
			start = i;
		}
	}
	processBlock(lines.length);
	return lines;

	function processBlock(end)
	{
		if (start < 0) return;
		const block = diff[start].trim();
		const content = diff.slice(start + 1, end);
		if (content.length == 0) return;
		if (block[0] == "-")
		{
			const startI = lines.indexOf(content[0]);
			function notFound()
			{
				console.error(`Diff section not found in source (${header}):\n` + content.join("\n"));
				process.exit(1);
			}
			if (startI < 0) notFound();
			for (let i = 0; i < content.length; i++)
			{
				if (lines[startI + i] != content[i])
					notFound();
			}
			lines.splice(startI, content.length);
			insertAt = startI;
		}
		if (block[0] == "+")
		{
			lines.splice(insertAt, 0, ...content);
			insertAt += content.length;
		}
	}
}