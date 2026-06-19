# Project Rules & Engineering Guidelines

When working on this project, adhere strictly to the following core principles:

## 1. Engineering Excellence
- Write clean, robust, and well-architected code.
- "Half-ass work" is strictly forbidden. 
- Solutions must be complete, tested, and built with production-quality standards in mind.

## 2. Graceful Error Handling & Tolerance
- This project is an "Error-Tolerant" Python formatter. The primary constraint is that it **must gracefully handle malformed code**.
- Users will type incomplete code (e.g., missing colons, unclosed parentheses, dangling brackets) while the formatter is active.
- If an AST node cannot be parsed or contains syntax errors (Tree-sitter `ERROR` nodes), you must **never** delete, mangle, or incorrectly format that code. The formatter must fall back safely and preserve the original text exactly as written.

## 3. Strict Testing Standards
- All formatting logic (`Printer.ts`) must have corresponding unit tests in `test_runner.js`.
- End-to-end (E2E) tests must run silently in the background (`vscode.executeFormatDocumentProvider`) inside a real, isolated VS Code instance to prevent UI interruptions and test flakiness from user typing.
- Always run the full test suite (`npm run compile && node test_runner.js` and `npm run e2e-test`) before considering a task finished.

## 4. WebAssembly & Tooling
- Do NOT use native C++ tree-sitter bindings (e.g., `web-tree-sitter` mixed with standalone `.wasm` files).
- Always use the pre-compiled, ABI-matched `@vscode/tree-sitter-wasm` package to prevent WASM ABI mismatch bugs across different Node/Electron versions.
- Keep the bundled `.vsix` extension size minimal (e.g., via `webpack.config.js` selectively copying only necessary WASM binaries).
