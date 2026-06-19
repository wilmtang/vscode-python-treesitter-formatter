# Error-Tolerant Python Formatter

A robust, fully PEP-8 compliant Python formatter for VS Code, built with engineering excellence. It uses Tree-sitter to parse the Python AST and intelligently rebuilds the formatted code, ensuring that even severely malformed or incomplete code is handled gracefully.

## 🚀 Features

- **PEP-8 Compliant**: Automatically formats indentation, spacing around operators, line breaks, and more according to PEP-8 standards.
- **Error Tolerant**: Unlike regex-based formatters, this extension understands the structure of your code. If you have syntax errors (e.g., missing colons, unclosed parentheses), it gracefully skips formatting the broken sections while continuing to format the rest of the file.
- **WASM Powered**: Built on `@vscode/tree-sitter-wasm`, ensuring lightning-fast formatting entirely locally with zero external Python dependencies (no need for `black`, `autopep8`, or `yapf` in your environment).

## 🛠️ How It Works

The extension uses a multi-stage pipeline to format your code:

1. **Parsing (`ParserService.ts`)**: 
   When you trigger a format, the raw code is passed to Tree-sitter (running via WebAssembly). Tree-sitter produces an Abstract Syntax Tree (AST) representing the structure of your code.
2. **Context Management (`Context.ts`)**: 
   A stateful context tracks indentation levels and pending blank lines. This ensures strict adherence to rules like "two blank lines between top-level function definitions."
3. **AST Traversal (`Printer.ts` & `Formatter.ts`)**: 
   A recursive visitor pattern walks through the Tree-sitter AST. It knows how to print every single Python node type (`function_definition`, `binary_operator`, `list`, etc.) with perfect PEP-8 spacing.
4. **Error Handling**: 
   If Tree-sitter encounters malformed code, it generates an `ERROR` node. The `Printer` detects these nodes and outputs their original text exactly as written, meaning the formatter will never accidentally delete or mangle your broken code while you're in the middle of typing.

## 💻 How to Use

### Installing and Running Locally
1. Clone the repository and install dependencies:
   ```bash
   npm install
   ```
2. Open the project in VS Code.
3. Press `F5` to launch the **Extension Development Host**.
4. In the new VS Code window that opens, create or open a Python (`.py`) file.
5. Right-click and select **Format Document**, or use the keyboard shortcut `Shift+Alt+F` (Windows/Linux) or `Shift+Option+F` (macOS).

### Configuration
The extension registers as a standard VS Code formatting provider. It respects your standard editor settings:
- `editor.tabSize` (defaults to 4 spaces)
- `editor.insertSpaces` (defaults to true)

#### Setting as Default Formatter
To make this extension your default formatter for Python files so that it runs automatically when you format or save:
1. Open your VS Code Settings (JSON) or Workspace `settings.json`.
2. Add the following configuration:
   ```json
   "[python]": {
       "editor.defaultFormatter": "undefined_publisher.vscode-python-treesitter-formatter",
       "editor.formatOnSave": true
   }
   ```
*(Note: Replace `undefined_publisher` with the actual publisher name once you publish the extension to the marketplace).*

## 🧪 Testing

This project is backed by a robust, two-tier testing strategy.

### 1. Fast Unit Tests (Standalone)
We have a custom test runner that executes directly against the formatting engine without the overhead of launching VS Code. It covers over 30 test cases including edge cases, nested functions, and syntax error recovery.

```bash
# Compile TypeScript to JavaScript, then run the fast tests
npm run compile && node test_runner.js
```

### 2. End-to-End (E2E) Tests
To guarantee the extension behaves correctly in production, the E2E suite launches a completely isolated instance of VS Code (without your local settings/extensions) and triggers the format command via the native VS Code API (`vscode.executeFormatDocumentProvider`).

```bash
# Run the full headless E2E suite inside a real VS Code instance
npm run e2e-test
```

## 🏗️ Architecture Notes

### Why WebAssembly (WASM)?
While `tree-sitter` is available as a standard npm package, using it inside a VS Code extension is problematic because it relies on native C++ bindings. Native C++ bindings must be cross-compiled against the exact version of Electron that VS Code uses (via `electron-rebuild`), which is fragile, breaks during VS Code updates, requires the user to have a C++ compiler installed, and prevents the extension from running in the browser (`vscode.dev`). 

Using the WebAssembly (WASM) compilation of Tree-sitter eliminates the need for C++ compilation and allows the extension to run anywhere.

### Avoiding ABI Mismatches
**ABI** stands for Application Binary Interface. When `tree-sitter.js` (the loader) and `tree-sitter-python.wasm` (the grammar) are compiled using different versions of the Emscripten toolchain, their ABIs do not match. This causes fatal memory alignment errors or function linking crashes (e.g., `RangeError: byte length of Uint32Array should be a multiple of 4`).

To solve this, the project explicitly uses the pre-compiled **`@vscode/tree-sitter-wasm`** package. The VS Code team compiles the Tree-sitter core engine, the JS loader, and the language grammars all together using the exact same Emscripten toolchain. This guarantees perfect ABI compatibility out of the box, without requiring us to manage C++ to WASM compilation pipelines ourselves.

### Optimized Bundle
Using a custom `webpack.config.js`, the extension externalizes the WASM loader and only copies the 3 strictly necessary WASM binaries, keeping the extension bundle size incredibly small (~840KB).
