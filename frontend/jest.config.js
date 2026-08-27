const nextJest = require("next/jest");

const createJestConfig = nextJest({
  // Caminho para o app Next.js, para que next/jest carregue next.config.js e
  // .env automaticamente, além de resolver os paths do tsconfig (@/*).
  dir: "./",
});

/** @type {import('jest').Config} */
const customJestConfig = {
  setupFilesAfterEnv: ["<rootDir>/jest.setup.js"],
  testEnvironment: "jest-environment-jsdom",
  testPathIgnorePatterns: ["<rootDir>/.next/", "<rootDir>/node_modules/"],
};

module.exports = createJestConfig(customJestConfig);
