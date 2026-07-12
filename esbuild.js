const esbuild = require("esbuild");
const fs = require("node:fs");
const { copy } = require("esbuild-plugin-copy");
const package = require("./package.json");

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");
const npmPackage = process.argv.includes("--npm-package");

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: "esbuild-problem-matcher",

	setup(build)
	{
		build.onStart(() =>
		{
			console.log("[watch] build started");
		});
		build.onEnd(result =>
		{
			result.errors.forEach(({ text, location }) =>
			{
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log("[watch] build finished");
		});
	},
};

async function main(entryPoint = "src/extension.ts", outfile = "dist/extension.js", format = "cjs", banner, extraExternals = [])
{
	const externalList = [
		"vscode",
		...(npmPackage ? Object.keys({ ...package.dependencies, ...package.peerDependencies }) : []),
		...extraExternals,
	];

	const ctx = await esbuild.context({
		entryPoints: [entryPoint],
		metafile: true,
		bundle: true,
		format: format,
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: "node",
		target: "node18",
		outfile: outfile,
		external: externalList,
		logLevel: "silent",
		...(banner ? { banner } : {}),
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
			copy({
				resolveFrom: "cwd",
				assets: {
					from: ["./assets/grammars.json"],
					to: ["./assets/grammars.copy.json"],
				},
			}),
		],
	});

	if (watch)
	{
		await ctx.watch();
	}
	else
	{
		const result = await ctx.rebuild();
		if (result.metafile)
			fs.writeFileSync("esbuild-meta.json", JSON.stringify(result.metafile));
		await ctx.dispose();
	}
}

function runMain(entryPoint, outfile, format, banner, extraExternals)
{
	main(entryPoint, outfile, format, banner, extraExternals).catch(e =>
	{
		console.error(e);
		process.exit(1);
	});
}

if (npmPackage)
{
	runMain("src/index.ts", "dist/index.mjs", "esm");
	runMain("src/index.ts", "dist/index.js", "cjs");
	runMain("src/cli.ts", "dist/cli.js", "cjs", { js: "#!/usr/bin/env node" }, ["./index"]);
}
else
{
	runMain();
}