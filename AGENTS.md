# AGENTS.md

Guidance for AI agents (and humans) working in this repository. Read this
before making changes. This is the single source of truth for working in this
repo.

## What this is

An **error-tolerant, tree-sitter–based Python formatter** for VS Code, plus
**AST-aware on-type indentation**. Two independent features share one parser:

1. **Document formatter** — `Format Document` / format-on-save. Reprints the
   whole buffer from the syntax tree (PEP-8 spacing, reindentation, line
   wrapping, token normalization, opportunistic syntax repair).
2. **On-type indentation** — as you press Enter / `:` / `)`/`]`/`}`, the caret
   lands at the correct indent, computed from the parse tree and updated
   incrementally per keystroke.

Everything runs on the pre-compiled, ABI-matched `@vscode/tree-sitter-wasm`
grammar. See [DESIGN.md](DESIGN.md) and [README.md](README.md) for the formatter
internals and the comparison with Black/Ruff.

## Non-negotiable principles

- **Never corrupt code.** The formatter must emit code that parses no worse than
  the input; the on-type provider must never disrupt typing. Tree-sitter
  `ERROR`/unparseable spans are preserved **verbatim** — never deleted, mangled,
  or reformatted. Both features *fail closed*: when unsure, do nothing and leave
  the user's text exactly as-is. This is the product's core promise, not a
  nice-to-have.
- **Engineering excellence.** Complete, tested, production-quality changes. No
  half-done work, no untested logic, no silent `catch {}` that hides bugs.
- **Tests are part of "done".** Run `npm test` **and** `npm run e2e-test` before
  considering any change finished. Formatting logic in `Printer.ts` needs a
  matching Node case in `test_runner.js`; E2E tests must run silently in the
  background (never simulate real keystrokes — it steals focus and flakes).
- **Parser = `@vscode/tree-sitter-wasm` only.** Use the pre-compiled,
  ABI-matched grammar — never native C++ bindings or `web-tree-sitter` mixed
  with standalone `.wasm` files (that path is ABI-mismatch hell across Node /
  Electron versions). Keep the shipped `.vsix` small: `webpack.config.js` copies
  only the WASM binaries that are actually needed.

## Architecture map

```
                 ParserService  (singleton WASM parser; parse(code, oldTree?))
                  /                                   \
   Formatter.format()                         IncrementalParser
   ├─ Repairer  (verify-or-revert fixes)      (per-doc tree cache; tree.edit + reparse;
   ├─ Printer   (AST → text via Context)       updated from onDidChangeTextDocument)
   └─ re-parse safety net                              │ getTree(document)
                                              IndentOnTypeProvider  (VS Code adapter)
                                                       │  asks for an indent
                                              IndentResolver  (PURE oracle)
                                                computeIndentColumns()  [Enter]
                                                computeLineReindent()   [: and )]
```

| File | Role |
|---|---|
| [src/parser/ParserService.ts](src/parser/ParserService.ts) | Singleton WASM parser. `parse(code, oldTree?)` — pass `oldTree` for incremental reparse. |
| [src/parser/IncrementalParser.ts](src/parser/IncrementalParser.ts) | Per-document tree cache. Translates VS Code changes → tree edits, reparses, manages tree lifetime. |
| [src/parser/treeEdit.ts](src/parser/treeEdit.ts) | Pure (vscode-free) change→`Edit` translation. Kept separate so it's unit-testable in Node. |
| [src/formatter/IndentResolver.ts](src/formatter/IndentResolver.ts) | **Pure oracle.** `(tree, code, line, indentSize) → number \| null`. The brains of on-type indent. |
| [src/extension/IndentOnTypeProvider.ts](src/extension/IndentOnTypeProvider.ts) | Thin VS Code adapter: reads config + cached tree, calls the oracle, emits one `TextEdit`. |
| [src/formatter/Printer.ts](src/formatter/Printer.ts) | AST → formatted text (visitor). The document formatter's core. |
| [src/formatter/Context.ts](src/formatter/Context.ts) | Output buffer + indent/blank-line bookkeeping for the Printer. |
| [src/formatter/Repairer.ts](src/formatter/Repairer.ts) | Deterministic, verify-or-revert syntax repair (e.g. missing colon). |
| [src/extension/extension.ts](src/extension/extension.ts) | Activation: parser init, provider registration, event wiring, disposal. |

## Invariants to preserve

These are load-bearing. Changing code near them requires re-checking each:

1. **Formatter never worsens parse-error count.** Enforced by the re-parse net
   in [Formatter.ts](src/formatter/Formatter.ts) + the lossless `default` case
   in the Printer. Property tests assert it.
2. **The oracle is pure.** `IndentResolver` imports no `vscode`, does no I/O,
   mutates nothing, and is deterministic. This is why it's unit-testable in Node
   and why incrementality can't affect correctness. Keep it that way — put any
   VS Code interaction in the provider.
3. **Incremental tree ≡ fresh parse.** After applying edits, the cached tree
   must equal a from-scratch parse. The Node invariant test asserts S-expression
   equality after every edit (incl. CRLF and multi-change events).
4. **On-type edits touch only leading whitespace.** The provider replaces the
   `(line, 0)…(line, firstNonWhitespace)` range only — never the EOL or typed
   content. This is what makes it safe and EOL-preserving.
5. **Indent unit is spaces, sized by `treesitterFormatter.indentSize`,** so
   on-type indent and Format-Document agree.

## Gotchas (learned the hard way)

- **`@vscode/tree-sitter-wasm` indices/columns are UTF-16 code units**, not
  bytes — despite the d.ts comments saying "byte" (inherited C-API wording).
  This matches VS Code's offset model, so changes map across with **no byte
  conversion**. Verified empirically; don't "fix" it.
- **Mis-indented clauses don't form clean nodes.** An over-indented
  `else:`/`except:`/`case:` (the common thing on-type reindent must fix)
  collapses into `ERROR` nodes — there is no `else_clause` to find. So clause
  reindent in `IndentResolver` is **deliberately text-based** (an indent-stack
  scan for the matching opener), while closing-bracket reindent stays tree-based
  (brackets aren't indentation-sensitive, so the tree stays clean).
- **`node.children` / `namedChildren` may contain `null`** — always guard.
- **`parser.parse(...)` can return `null`** (cancellation). Callers must handle
  it; `IncrementalParser` falls back to a clean state.
- **`node.children` materializes wrappers.** Don't iterate children of `module`
  or `block` per keystroke — `findEnclosingOpenBracket` stops before them
  precisely to bound per-keystroke cost.
- **Tree memory is manual.** `tree.delete()` superseded/closed trees to avoid
  WASM leaks (see `IncrementalParser`). The whole-document `Formatter` path
  intentionally does a full parse (it also repairs), so don't wire it through
  the incremental cache without thought.
- **Multi-change events** (multi-cursor, find/replace-all) must apply tree edits
  **high-offset-first** so original-doc offsets stay valid; never assume VS Code
  delivers them in a particular order.

## Build & test

```bash
npm run compile-tests   # tsc → out/  (type-check everything)
npm test                # Node: formatter + indent oracle + incremental invariants (fast, no VS Code)
npm run e2e-test         # builds webpack bundle, launches a real VS Code, runs the full suite
npm run lint             # eslint src
npm run package          # production webpack bundle (dist/)
```

- **Node tests** ([test_runner.js](test_runner.js)) cover everything that
  doesn't need a VS Code host: formatter cases + property/safety invariants, the
  pure indent oracle, and the incremental-parse invariant. Prefer adding
  coverage here first — it's deterministic and sub-second.
- **E2E tests** ([test/suite/](test/suite)) run inside a real, isolated VS Code
  instance and must execute **silently** in the background
  (`vscode.executeFormatDocumentProvider` / `vscode.executeFormatOnTypeProvider`)
  — never simulate real keystrokes (steals focus, flaky). On-type cases are
  data-driven from [test/fixtures/indent/cases.json](test/fixtures/indent/cases.json):
  each case is the document *right after the keystroke* + cursor + trigger +
  expected result.

## Extending

- **New on-type indent behavior** → add/adjust a rule in `IndentResolver`
  (return `null` when unsure), cover it in `test_runner.js`, then add a fixture
  case in `cases.json`. If it needs a new trigger character, also register it in
  `extension.ts`.
- **New formatting rule** → handle the node type in `Printer.ts`; never
  reconstruct an unknown node from children (the lossless `default` is the
  safety net). Add a Node case in `test_runner.js` and an E2E case mirroring it.
- **Grammar questions** → write a throwaway probe that prints
  `parse(code).rootNode.toString()` rather than guessing node types/structure;
  delete it after. (Several design decisions here came from doing exactly that.)

## Conventions

- TypeScript, 2-space indent, explicit return types on exported functions, small
  pure helpers over cleverness. Match the surrounding comment density — explain
  *why*, especially around tree-sitter quirks.
- Keep VS Code APIs out of `src/formatter/` and `src/parser/treeEdit.ts` so that
  logic stays Node-testable.
- Only commit/push when explicitly asked.
