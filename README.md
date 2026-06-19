# Error-Tolerant Python Formatter

A local, deterministic, PyCharm-style Python formatter for VS Code. It uses Tree-sitter to parse the Python AST and rebuild PEP-8 formatted code — and because Tree-sitter recovers from errors, it formats code that doesn't fully parse (which Black, autopep8, and yapf refuse), even repairing some breakage along the way. A re-parse safety net guarantees it never emits code that parses worse than what you gave it.

## 🚀 Features

- **PEP-8 formatting**: normalizes spacing around operators, commas, and colons; blank lines around and within definitions; comma-separated lists; and wraps lines that exceed a configurable width (default 88) one element per line.
- **Reindentation**: rebuilds indentation from structure, so tabs, mixed, over-, under-, or inconsistent indentation all normalize to your indent size.
- **Syntax repair**: inserts a missing colon after a compound-statement header (`if`/`for`/`while`/`def`/`class`/…). Every repair is verified by re-parsing and kept only if it reduces syntax errors — going beyond Black/autopep8 (which refuse unparseable code) without the risk.
- **Never corrupts your code**: anything the formatter doesn't understand is preserved verbatim, and a re-parse safety net falls back to your original text if formatting would ever introduce a syntax error. Backed by property tests (*valid stays valid*, *idempotent*, *never worsens broken code*).
- **Local, deterministic, WASM-powered**: built on `@vscode/tree-sitter-wasm` — fast, fully offline, with zero external Python dependencies (no `black`, `autopep8`, or `yapf` needed).

## 🛠️ How It Works

The extension uses a multi-stage pipeline to format your code:

1. **Parsing (`ParserService.ts`)**: 
   When you trigger a format, the raw code is passed to Tree-sitter (running via WebAssembly). Tree-sitter produces an Abstract Syntax Tree (AST) representing the structure of your code.
2. **Context Management (`Context.ts`)**: 
   A stateful context tracks indentation levels and pending blank lines. This ensures strict adherence to rules like "two blank lines between top-level function definitions."
3. **AST Traversal (`Printer.ts`)**: 
   A recursive visitor walks the Tree-sitter AST and prints each supported node type (`function_definition`, `binary_operator`, `list`, etc.) with PEP-8 spacing, wrapping bracketed groups that don't fit the line width. Nodes without a dedicated handler fall back to lossless passthrough (see below).
4. **Repair (`Repairer.ts`)**: 
   When the input has parse errors, a pre-pass attempts targeted, deterministic fixes (e.g. inserting a missing colon after a compound header). Each candidate edit is applied to a copy, re-parsed, and kept only if it strictly reduces the number of parse errors — otherwise it's reverted. This makes repair safe by construction.
5. **Lossless passthrough & safety net (`Printer.ts` & `Formatter.ts`)**: 
   The `Printer` only reformats nodes it has a tested handler for; everything else (including Tree-sitter `ERROR` nodes) is emitted as its original source text, so broken or unsupported code is never deleted or mangled. As a final guard, `Formatter` re-parses its own output and falls back to the original text if formatting would ever introduce a syntax error.

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
The extension registers as a standard VS Code formatting provider and contributes these settings:
- `treesitterFormatter.indentSize` (default `4`) — spaces per indentation level.
- `treesitterFormatter.maxLineLength` (default `88`) — bracketed constructs (calls, collections, parameter lists) that exceed this width are wrapped one element per line. Use `79` for strict PEP-8, or `120` for PyCharm's default.
- `treesitterFormatter.repairSyntax` (default `true`) — attempt verify-or-revert syntax repair (e.g. inserting missing colons) before formatting.

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
We have a custom test runner that executes directly against the formatting engine without the overhead of launching VS Code. It covers 70+ checks — basic formatting, comprehensions/lambdas/annotations, reindentation, syntax repair, line wrapping — plus safety-invariant property tests (*never corrupts valid code*, *idempotent*, *never worsens broken code*).

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
