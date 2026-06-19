# Design: Local, deterministic, PyCharm-style repair + format

## Goal

A VS Code Python formatter that **runs entirely locally and deterministically** (no
AI, no network), formats to PEP-8, and — unlike Black/Ruff/autopep8/yapf — is
**error-tolerant**: it formats code that does not fully parse instead of refusing the
whole file, and where it can, it *repairs* common breakage (bad indentation, missing
colons). This is the PyCharm lineage (error-recovering parser), built on tree-sitter.

## Guiding principle

> **Format what you understand; copy everything else through byte-for-byte; never emit
> code that parses worse than the input.**

This inverts the original design (rebuild everything from the AST, concatenate unknown
nodes with no spaces → corruption). The default for any node we don't have a correct,
tested handler for — or any subtree containing a parse error — is to emit its **original
source text verbatim**. We format *around* breakage at the smallest granularity possible.

## Key technical finding (tree-sitter-python error model)

Measured directly against the grammar:

- **Pure indentation problems** (colons present, only whitespace is wrong) → tree-sitter
  **fully recovers**: `rootNode.hasError === false`, clean nested tree. Reindenting is
  therefore *safe* — the structure is real. This is the "fix my indentation" win.
- **True syntax errors** (missing colon, unclosed bracket) → tree-sitter does **not**
  insert a tidy `MISSING` token. It collapses the construct into one flat `ERROR` node
  and **discards the nesting** (`if x\n    pass` → `ERROR[if, x, pass]`). So there is no
  "free" repair from the parser; real repair means editing the source text and
  re-parsing.

Consequence: repair splits into (a) **free structural reindent** when the tree recovers,
and (b) **bounded heuristic source-repair** with verify-or-revert for a small set of
high-confidence cases.

## Architecture (pipeline)

```
source ─▶ [1. Repair pre-pass] ─▶ [2. Parse] ─▶ [3. Format] ─▶ [4. Safety verify] ─▶ output
            edit + reparse,         tree-sitter   lossless         re-parse result;
            verify-or-revert                       passthrough      revert if worse
```

The two load-bearing safety pieces:
- **(3) lossless passthrough** — unhandled / error subtrees emit original bytes.
- **(4) safety verify** — re-parse the output; if it has parse errors the input did not,
  fall back (per-statement, else whole-file) to the original. Corruption becomes
  structurally impossible.

## Decisions (adopted)

1. **Repair ambition:** ship M0–M2 first (safe formatting + reindent), then M3
   (heuristic syntax repair), starting with missing-colon.
2. **Line wrapping (M4):** configurable width via `treesitterFormatter.maxLineLength`
   (default **88**; 79 = strict PEP-8, 120 = PyCharm default). Deferred to last.
3. **Fallback granularity:** when one statement can't be safely formatted, preserve
   *just that statement* verbatim and still format the rest of the file (not Black's
   all-or-nothing refusal).

## Roadmap (each phase ships and is verified independently)

- **M0 — Safety foundation ("never corrupt").** Verbatim passthrough default in the
  Printer; remove handlers that emit *invalid* code (comprehensions, lambda) so they fall
  to passthrough; re-parse safety net in `Formatter`. Add property tests
  (*valid-stays-valid*, *idempotency*). Outcome: safe, may under-format.
- **M1 — Correct PEP-8 on valid code.** Implement correct handlers for the constructs
  passed through in M0: comprehensions, lambda, type annotations (`x: int`, annotated
  defaults), bare-tuple commas, `count: int = 0`, semicolon→split, trailing-comma
  spacing, inline-comment attachment, blank-line normalization.
- **M2 — Structural repair: reindentation.** Harden the clean-recovery path so tabs /
  mixed / over- / under-indentation all normalize to the editor's indent size.
- **M3 — Heuristic syntax repair (opt-in), verify-or-revert.** Recognize a small set of
  high-confidence breakages, edit source, re-parse, keep the edit only if the error count
  strictly drops. Start with missing colon after a compound header.
- **M4 — (Optional) Line wrapping.** Small Doc-IR (group / indent / soft-line) for
  wrappable constructs (calls, collections, arg/param lists, imports). Highest
  effort/risk; isolated.

## Status

- [x] M0 — Safety foundation
- [x] M1 — Correct PEP-8 on valid code
- [x] M2 — Reindentation hardening
- [x] M3 — Heuristic syntax repair (missing colon)
- [x] M4 — Line wrapping (configurable width, default 88)
