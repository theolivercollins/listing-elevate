import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  // Ban raw fmtCents* calls in dashboard surfaces — use <MoneyValue> for JSX
  // or fmtMoney() for string contexts. primitives.tsx (where they are defined)
  // is excluded so the definitions themselves don't trigger the rule.
  {
    files: [
      "src/pages/dashboard/**/*.{ts,tsx}",
      "src/components/dashboard/**/*.{ts,tsx}",
    ],
    ignores: ["src/components/dashboard/primitives.tsx"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name=/^fmtCents/]",
          message:
            "Use <MoneyValue> (or fmtMoney for string contexts) instead of raw fmtCents — fmtCents can fabricate a misleading $0/format and bypasses the no-fabrication cost contract.",
        },
      ],
    },
  },
);
