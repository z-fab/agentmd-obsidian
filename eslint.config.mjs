import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

export default tseslint.config(
  {
    ignores: ["main.js", "esbuild.config.mjs", "eslint.config.mjs", "node_modules/**", "tests/**"],
  },
  ...tseslint.configs.recommendedTypeChecked,
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Opinionated UI-copy casing rule; not enforced by the publish review and
      // would lowercase intentional labels ("✓ Approve"). Keep our casing.
      "obsidianmd/ui/sentence-case": "off",
    },
  },
);
