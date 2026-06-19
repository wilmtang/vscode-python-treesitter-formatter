# Error-Tolerant Python Formatter

A local, deterministic, PyCharm-style Python formatter for VS Code. It uses Tree-sitter to parse the Python AST and rebuild PEP-8 formatted code — and because Tree-sitter recovers from errors, it formats code that doesn't fully parse (which Black, autopep8, and yapf refuse), even repairing some breakage along the way. A re-parse safety net guarantees it never emits code that parses worse than what you gave it.

## 🚀 Features

- **PEP-8 formatting**: normalizes spacing around operators, commas, and colons; blank lines around and within definitions; comma-separated lists; and wraps lines that exceed a configurable width (default 88) one element per line.
- **Reindentation**: rebuilds indentation from structure, so tabs, mixed, over-, under-, or inconsistent indentation all normalize to your indent size.
- **Syntax repair**: inserts a missing colon after a compound-statement header (`if`/`for`/`while`/`def`/`class`/…). Every repair is verified by re-parsing and kept only if it reduces syntax errors — going beyond Black/autopep8 (which refuse unparseable code) without the risk.
- **Never corrupts your code**: anything the formatter doesn't understand is preserved verbatim, and a re-parse safety net falls back to your original text if formatting would ever introduce a syntax error. Backed by property tests (*valid stays valid*, *idempotent*, *never worsens broken code*).
- **Local, deterministic, WASM-powered**: built on `@vscode/tree-sitter-wasm` — fast, fully offline, with zero external Python dependencies (no `black`, `autopep8`, or `yapf` needed).

## ⚖️ How It Compares to Black

[Black](https://black.readthedocs.io/) is the gold standard for formatting Python that **already parses**. This formatter targets the case Black refuses — code that doesn't parse — and is intentionally more conservative on valid code. The two are complementary.

> The **This formatter** column is real output from the test suite. The **Black** column reflects Black's documented, standard behavior.

### ✅ What this formatter can do that Black can't

Black builds a strict syntax tree first; if the file doesn't parse it **refuses and changes nothing** (`error: cannot format …: Cannot parse`). Because Tree-sitter recovers from errors, this formatter formats what it can and repairs what it safely can.

**Reindent invalid Python** (inconsistent indentation is an `IndentationError`, so the input below does not parse):

```python
# input                         # this formatter
for i in range(10):             for i in range(10):
  print(i)                          print(i)
   if i == 5:                       if i == 5:
   break                                break
```
> **Black:** ❌ refuses — `Cannot parse`.

**Repair a missing colon, then format:**

```python
# input                         # this formatter
def add(a, b)                   def add(a, b):
    return a + b                    return a + b
```
> **Black:** ❌ refuses — `Cannot parse`.

**Format the valid parts and leave an unfinished region untouched** (e.g. mid-edit):

```python
# input                         # this formatter
import os                       import os
x=1+2                           x = 1 + 2
val = compute(1,2               val = compute(1,2     ← preserved verbatim
y=3                             y=3
```
> **Black:** ❌ refuses the entire file — `Cannot parse`.

### ⬛ What Black can do that this formatter can't

On code that already parses, Black does more. These are real differences:

| Feature | Input | This formatter | Black |
|---|---|---|---|
| Quote normalization | `name = 'world'` | `name = 'world'` | `name = "world"` |
| Numeric literals | `x = 0XFF` | `x = 0XFF` | `x = 0xFF` |
| String prefixes | `s = F"hi"` | `s = F"hi"` | `s = f"hi"` |
| Power-operator hugging | `x = 2**8` | `x = 2 ** 8` | `x = 2**8` |
| Slice spacing (complex operands) | `ham[lower + offset:upper + offset]` | `ham[lower + offset:upper + offset]` | `ham[lower + offset : upper + offset]` |
| Redundant parens | `return (value)` | `return (value)` | `return value` |

**Magic trailing comma** — a trailing comma tells Black to keep a collection exploded; this formatter simply drops it:

```python
# input:  data = [1, 2, 3,]

data = [1, 2, 3]          # ← this formatter (drops the redundant comma)

data = [                  # ← Black (trailing comma forces one-per-line)
    1,
    2,
    3,
]
```

**Wrapping long operator chains** — this formatter only wraps *bracketed* groups (calls, collections, parameter lists); a long boolean / arithmetic / comparison chain is left over-width, whereas Black parenthesizes it:

```python
# input (92 columns)
result = alpha_one and beta_two and gamma_three and delta_four and epsilon_five and zeta_six

# this formatter → unchanged, still 92 columns ❌

# Black →
result = (
    alpha_one and beta_two and gamma_three and delta_four and epsilon_five and zeta_six
)
```

### Bottom line

Use Black (or Ruff) for everyday formatting of valid code — they do more and are battle-tested. Reach for this formatter when the code **doesn't parse yet**: while you're mid-edit, or to safely tidy a file with a syntax error that Black would reject outright.

## 🛠️ How It Works

Formatting runs as a pipeline. Two rules hold it together — **format what you understand, copy everything else verbatim**, and **never emit code that parses worse than the input** — and they're enforced at the *edges* of the pipeline (the parse/repair front and the safety-net back), so the formatting logic in the middle can stay simple.

```text
                    ┌──── has errors? ────┐
  source ──▶ parse ─┤                     ├─▶ print ──▶ re-parse & compare ──▶ output
            (Tree-  └─▶ repair ─▶ re-parse┘  (visitor +  (revert to original
             sitter)    (verify-or-revert)    Context)    if it parses worse)
```

### 1. Parse — `ParserService.ts`

The source is parsed by Tree-sitter, compiled to WebAssembly. The property that makes this whole project possible is that Tree-sitter is **error-recovering**: it returns a usable syntax tree even for code that doesn't compile, isolating the parts it can't make sense of as `ERROR` nodes. (Black, autopep8, and yapf use strict parsers and simply refuse a file that won't parse.) The parser is initialized once and reused for every format.

### 2. Repair — `Repairer.ts` (only when the input is broken)

If the tree has errors and `repairSyntax` is enabled, a repair pre-pass runs. The non-obvious part: Tree-sitter does **not** hand you a tidy "missing colon here" marker. For input like `if x` (no colon) it collapses the entire construct into one flat `ERROR` node and discards the block structure — so there is nothing in the *tree* to patch. Repair therefore works on the **source text**:

1. Find each line whose first token is a compound-statement keyword (`if`, `elif`, `else`, `for`, `while`, `def`, `class`, `try`, `except`, `finally`, `with`, `async`) and that doesn't already end in `:`.
2. Try appending a `:` (before any trailing comment).
3. **Re-parse and count errors.** Keep the edit *only if the `ERROR`/`MISSING` count strictly drops*; otherwise revert it.

This **verify-or-revert** loop is what makes repair safe: a wrong guess can never make the code worse, and genuinely ambiguous breakage (an unclosed bracket, a half-typed line) reduces no errors and is left untouched. The improved source is then re-parsed for the printing stage.

### 3. Print — `Printer.ts` + `Context.ts`

A recursive visitor (`Printer.printNode`) walks the tree and writes into a `FormatterContext`. This is where the PEP-8 shaping happens.

**The output model (`Context.ts`).** Rather than writing newlines immediately and trimming later, the context tracks *pending* newlines as a **count** and flushes them only when the next real content is written. Requests take the **maximum**, never the sum: `newline()` (1), `emptyLine()` (one blank line), and `twoBlankLines()` (PEP-8 separation around top-level defs) combine to the strongest request instead of stacking. Indentation is applied at flush time from a structural depth counter (`indent()` / `dedent()`) — so the input's own indentation is **ignored and rebuilt from tree depth**, which is exactly why tabs, mixed, or inconsistent indentation all normalize for free.

**Spacing & statement layout.** Each node type has a handler: binary/boolean/comparison operators are surrounded by spaces; `:` and `,` get a space *after* but not before; `=` is hugged in `f(x=1)` but spaced in annotated form `x: int = 1`; comprehensions space-separate their `for`/`in`/`if` clauses; and so on. `printStatements` lays out a module or block body — it splits `;`-joined statements onto their own lines, keeps an inline `# comment` attached to the row it was written on, preserves author blank lines (capped at 2 top-level / 1 nested, by comparing source row numbers), and enforces the 2-/1-blank-line rule around definitions.

**Line wrapping.** When `maxLineLength` is finite, a bracketed group (call arguments, `list`/`dict`/`set`/`tuple`, parameter lists) is **measured flat first**: it is rendered into a throwaway context, and if `currentColumn + flatWidth` (plus a trailing `:` for a `def`/`class` header) exceeds the limit, the group is *exploded* — one element per line, closing bracket dedented back to the statement. Because the decision is purely width-driven, an already-exploded group collapses back to a single line when it fits, which keeps the formatter idempotent. (Operator chains like `a and b and …` are not wrapped yet — see the comparison above.)

**Lossless passthrough — the safety-critical default.** Any node type *without* a dedicated handler — and every `ERROR` node — hits the `default` case, which emits the node's **original source text** instead of rebuilding it from its children. This single rule is what guarantees "never mangle": an unsupported or broken construct comes out byte-for-byte unchanged rather than being silently corrupted by a generic "concatenate the children" path. (It is also the root-cause fix for the original bugs — a comprehension with no handler used to become `[afor a in items]`; now it is copied verbatim until a real handler exists.)

### 4. Safety net — `Formatter.ts`

After printing, the output is **re-parsed** and its error count compared with the original input's. If formatting somehow *increased* the count — i.e. introduced a syntax error — the formatter discards its own output and returns the original text unchanged. Combined with lossless passthrough, this makes corruption **structurally impossible**: the worst case is "this region wasn't reformatted," never "this code is now broken."

### The guarantees, in one place

- **Never corrupts** — output always parses at least as well as the input (stage 4), and anything not understood is preserved verbatim (stage 3).
- **Idempotent** — `format(format(x)) == format(x)`; indentation and wrapping are *derived* each run, never accumulated.
- **Deterministic & local** — no AI, no network; identical input always yields identical output.

All three are locked in by property tests in `test_runner.js` (*never corrupts valid code*, *idempotent*, *never worsens broken code*).

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
