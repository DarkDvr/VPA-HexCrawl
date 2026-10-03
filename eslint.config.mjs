import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	{ ignores: ["main.js", "*.mjs"] },
	...obsidianmd.configs.recommended,
	{
		// DELETE is the literal confirmation keyword for the delete-map dialog.
		rules: {
			"obsidianmd/ui/sentence-case": ["warn", { ignoreWords: ["DELETE"] }],
		},
	},
	{
		languageOptions: {
			parserOptions: {
				projectService: true,
			},
		},
	},
]);
