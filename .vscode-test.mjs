import { defineConfig } from "@vscode/test-cli";

export default defineConfig({
	files: "out/test/extension.test.js",
	launchArgs: ["--disable-extensions", "--disable-gpu", "--skip-welcome", "--skip-release-notes"],
	mocha: { timeout: 60000, ...(process.env.MD2GOST_VSCODE_GREP ? { grep: process.env.MD2GOST_VSCODE_GREP } : {}) },
});
