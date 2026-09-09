import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

import quality from "./eslint-rules/index.cjs";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/**/*.{js,jsx,ts,tsx}"],
    plugins: { quality },
    rules: {
      // Baseline: 4 arquivos acima de 350 linhas (medido em 2026-09-09,
      // apos split de integracoes/page.tsx).
      "quality/max-lines": ["warn", { max: 350 }],
      // Sem módulo de banco/ORM no frontend (SPA consome a API do backend
      // via src/lib/api.ts) — quality/no-direct-data-access não se aplica.
      "quality/no-direct-console": ["error"],
    },
  },
  {
    files: ["eslint-rules/**/*.cjs"],
    languageOptions: {
      sourceType: "commonjs",
      globals: { module: "readonly", require: "readonly" },
    },
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Jest config/setup files: CommonJS by design (Jest loads them directly,
    // outside the Next.js/SWC module pipeline).
    "jest.config.js",
    "jest.setup.js",
  ]),
]);

export default eslintConfig;
