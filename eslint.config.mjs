import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import prettier from "eslint-config-prettier";

export default tseslint.config(
    {
        ignores: [
            "dist/**",
            "vendor/**",
            "artifacts/**",
            "node_modules/**",
            "coverage/**",
        ],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    prettier,
    {
        rules: {
            // Stage boundaries pass pdf.js/API payloads around; narrow `any` is
            // acceptable at those edges but must be deliberate.
            "@typescript-eslint/no-explicit-any": "warn",
            "@typescript-eslint/no-unused-vars": [
                "error",
                { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
            ],
            "no-console": ["warn", { allow: ["warn", "error"] }],
        },
    },
    {
        // Scripts and tests are developer tooling: console output is the point.
        files: ["scripts/**", "test/**", "esbuild.config.mjs"],
        rules: {
            "no-console": "off",
        },
    },
    {
        // Plain-JS dev scripts run under Node; browser-check also evaluates
        // snippets inside a page context (document/window).
        files: ["**/*.mjs"],
        languageOptions: {
            globals: { ...globals.node, ...globals.browser },
        },
    }
);
