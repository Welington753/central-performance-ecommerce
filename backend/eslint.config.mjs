// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import quality from './eslint-rules/index.cjs';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      // Convenção padrão da comunidade: parâmetros/variáveis prefixados com
      // "_" são intencionalmente não usados (ex.: stubs de connector que
      // implementam uma interface mas ainda não usam o argumento).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  {
    files: ['{src,apps,libs}/**/*.ts'],
    plugins: { quality },
    rules: {
      // Baseline: 10 arquivos acima de 350 linhas (medido em 2026-09-09,
      // apos split de marketplace-analytics-response.dto.ts).
      'quality/max-lines': ['warn', { max: 350 }],
      // Baseline: 3 ocorrências em src/database/seeds/create-admin.seed.ts
      // (script CLI de seed, roda fora do bootstrap do Nest).
      'quality/no-direct-console': [
        'warn',
        { logger: 'Logger do NestJS (@nestjs/common)' },
      ],
      'quality/no-direct-data-access': [
        'error',
        {
          modules: ['typeorm', '@nestjs/typeorm'],
          bindings: ['Repository', 'DataSource', 'EntityManager', 'InjectRepository'],
          layers: ['.controller.ts'],
        },
      ],
    },
  },
  {
    files: ['eslint-rules/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'readonly', require: 'readonly' },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
