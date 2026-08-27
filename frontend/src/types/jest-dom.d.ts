// Garante que os matchers customizados do @testing-library/jest-dom
// (toBeInTheDocument, toHaveTextContent, toBeDisabled, etc.) sejam
// reconhecidos pelo TypeScript nos arquivos de teste (`expect(...).toX()`).
import "@testing-library/jest-dom";
