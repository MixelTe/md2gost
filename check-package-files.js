const fs = require("fs");
const path = require("path");
const tar = require("tar");
const yauzl = require("yauzl");
const package = require("./package.json");

const SNAPSHOT_FILE = path.join(__dirname, "file-snapshot.json");

const NAME = `${package.name}-${package.version}`;
const TGZ_PATH = path.join(__dirname, NAME + ".tgz");
const VSIX_PATH = path.join(__dirname, NAME + ".vsix");

run();
async function run()
{
	try
	{
		if (!fs.existsSync(TGZ_PATH) || !fs.existsSync(VSIX_PATH))
		{
			console.error("❌ Error: Build artifacts (.tgz or .vsix) not found. Run build step first.");
			process.exit(1);
		}

		console.log("📦 Analyzing build artifacts...");
		const currentTgzFiles = await getTgzFiles(TGZ_PATH);
		const currentVsixFiles = await getVsixFiles(VSIX_PATH);

		const currentSnapshot = {
			tgzFiles: currentTgzFiles,
			vsixFiles: currentVsixFiles,
		};

		if (!fs.existsSync(SNAPSHOT_FILE))
		{
			fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(currentSnapshot, null, 4));
			console.log(`✅ Created initial file snapshot at ${SNAPSHOT_FILE}. Commit this file to Git.`);
			return;
		}

		const expectedSnapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
		let hasMismatch = false;

		/** @type {(expected: string[], current: string[]) => { missing: string[], added: string[] } */
		const getDiff = (expected, current) =>
		{
			const missing = expected.filter(f => !current.includes(f));
			const added = current.filter(f => !expected.includes(f));
			return { missing, added };
		};

		const tgzDiff = getDiff(expectedSnapshot.tgzFiles, currentSnapshot.tgzFiles);
		const vsixDiff = getDiff(expectedSnapshot.vsixFiles, currentSnapshot.vsixFiles);

		if (tgzDiff.added.length || tgzDiff.missing.length)
		{
			console.error(`\n❌ Mismatch in .tgz package files! (Expected ${expectedSnapshot.tgzFiles.length}, Got ${currentSnapshot.tgzFiles.length})`);
			if (tgzDiff.added.length) console.error(`   Added files:\n     + ${tgzDiff.added.join("\n     + ")}`);
			if (tgzDiff.missing.length) console.error(`   Missing files:\n     - ${tgzDiff.missing.join("\n     - ")}`);
			hasMismatch = true;
		}

		if (vsixDiff.added.length || vsixDiff.missing.length)
		{
			console.error(`\n❌ Mismatch in .vsix extension files! (Expected ${expectedSnapshot.vsixFiles.length}, Got ${currentSnapshot.vsixFiles.length})`);
			if (vsixDiff.added.length) console.error(`   Added files:\n     + ${vsixDiff.added.join("\n     + ")}`);
			if (vsixDiff.missing.length) console.error(`   Missing files:\n     - ${vsixDiff.missing.join("\n     - ")}`);
			hasMismatch = true;
		}

		if (hasMismatch)
		{
			console.error(`\n💥 Build validation failed. If this change was intentional, delete "file-snapshot.json" and re-run to update the baseline.`);
			process.exit(1);
		}

		console.log(`\n✨ Success! File counts match snapshot (.tgz: ${currentSnapshot.tgzFiles.length} files, .vsix: ${currentSnapshot.vsixFiles.length} files).`);

	} catch (error)
	{
		console.error("An error occurred during verification:", error);
		process.exit(1);
	}
}

/** @type {(filePath: string) => Promise<string[]> */
async function getTgzFiles(filePath)
{
	const files = [];
	await tar.list({
		file: filePath,
		onentry: (entry_1) =>
		{
			files.push(entry_1.path);
		},
	});
	return files.sort();
}

/** @type {(filePath: string) => Promise<string[]> */
function getVsixFiles(filePath)
{
	return new Promise((resolve, reject) =>
	{
		const files = [];
		yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) =>
		{
			if (err) return reject(err);
			zipfile.readEntry();
			zipfile.on("entry", (entry) =>
			{
				if (!entry.fileName.endsWith("/"))
					files.push(entry.fileName);
				zipfile.readEntry();
			});
			zipfile.on("end", () => resolve(files.sort()));
			zipfile.on("error", reject);
		});
	});
}
