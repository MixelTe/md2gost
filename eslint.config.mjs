import htmlPlugin from "eslint-plugin-html";
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import globals from "globals";

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	{ files: ["**/*.{js,mjs,cjs,ts,mts,cts,html}"] },
	{ ignores: ["dist/**", "build/**", "node_modules/**", "**/*.d.ts"] },
	{
		plugins: {
			"@typescript-eslint": tseslint.plugin,
			"@stylistic": stylistic,
			html: htmlPlugin,
		},

		languageOptions: {
			parser: tseslint.parser,
			ecmaVersion: 2022,
			sourceType: "module",
			globals:
			{
				...globals.node,
			},
		},

		rules: {
			// --- Formatting & Stylistic Rules ---

			// Enforce Allman bracing style (new line for braces) while allowing single-line blocks
			"@stylistic/brace-style": ["error", "allman", { allowSingleLine: true }],

			// Enforce tab indentation
			"@stylistic/indent": ["error", "tab", { SwitchCase: 1 }],

			// Enforce double quotes, but allow backtick quotes
			"@stylistic/quotes": ["error", "double", { avoidEscape: true, allowTemplateLiterals: "always" }],

			// Enforce mandatory semicolons
			"@stylistic/semi": ["error", "always"],

			// Enforce trailing commas for multiline objects/arrays/params
			"@stylistic/comma-dangle": ["error", "always-multiline"],

			// Omit parentheses around single arrow function parameters when possible (e.g., `v => ...`)
			"@stylistic/arrow-parens": ["error", "as-needed"],

			// No space before named function parentheses
			"@stylistic/space-before-function-paren": ["error", {
				anonymous: "always",
				named: "never",
				asyncArrow: "always",
				catch: "always",
			}],

			// --- TypeScript Style & Leniency ---

			// Allow inline type imports: `import { Doc, type DocNode } from "./doc";`
			"@typescript-eslint/consistent-type-imports": ["error", {
				prefer: "type-imports",
				fixStyle: "inline-type-imports",
			}],

			// Allow legacy require statements for build environments/older modules
			"@typescript-eslint/no-require-imports": "off",

			// Allow explicit `any`
			"@typescript-eslint/no-explicit-any": "off",

			// Allow non-null assertions `!`
			"@typescript-eslint/no-non-null-assertion": "off",

			// Allow unused parameters in callbacks
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": ["warn", {
				args: "none",
				varsIgnorePattern: "^_",
				caughtErrorsIgnorePattern: "^_",
			}],

			// Allow variable shadowing
			"@typescript-eslint/no-shadow": "off",
			"no-shadow": "off",

			// --- General JS/TS Rules ---

			// Allow empty catch blocks: `catch { }`
			"no-empty": ["error", { allowEmptyCatch: true }],

			// Allow lexical declarations in case clauses
			"no-case-declarations": "off",

			// Prefer const when variables are not reassigned
			"prefer-const": ["error", { destructuring: "all" }],
		},
	},{
		files: ["**/*.html"],

		languageOptions: {
			sourceType: "script",
			globals:
			{
				...globals.browser,
			},
		},
	});