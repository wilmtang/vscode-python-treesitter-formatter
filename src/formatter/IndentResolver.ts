/**
 * IndentResolver — AST-aware indentation oracle for on-type editing.
 *
 * Pure functions (no VS Code types): given a Tree-sitter tree + the document
 * text, they compute the number of leading-space columns a line should have.
 * The extension feeds the cached incremental tree; unit tests feed a full-parse
 * tree. Incrementality affects speed, not the result.
 *
 * Everything is measured in *columns* = spaces (a leading tab counts as
 * `indentSize` columns). Output is always spaces, matching the document
 * formatter. Both entry points return `null` when they cannot confidently
 * decide — the caller then emits no edit and leaves the editor's own indent.
 */

interface Point {
  row: number;
  column: number;
}

interface SyntaxNode {
  type: string;
  startPosition: Point;
  endPosition: Point;
  startIndex: number;
  endIndex: number;
  parent: SyntaxNode | null;
  children: (SyntaxNode | null)[];
  namedChildren: (SyntaxNode | null)[];
  descendantForPosition(start: Point, end?: Point): SyntaxNode | null;
}

interface SyntaxTree {
  rootNode: SyntaxNode;
}

const OPEN = new Set(['(', '[', '{']);
const CLOSE = new Set([')', ']', '}']);

/** Compound statements / clauses that introduce an indented `block` body. */
const COMPOUND = new Set([
  'function_definition', 'class_definition',
  'if_statement', 'elif_clause', 'else_clause',
  'for_statement', 'while_statement', 'with_statement',
  'try_statement', 'except_clause', 'except_group_clause', 'finally_clause',
  'match_statement', 'case_clause',
]);

/** Simple statements that terminate control flow (next line dedents). */
const FLOW = new Set([
  'return_statement', 'raise_statement',
  'pass_statement', 'break_statement', 'continue_statement',
]);

/**
 * For a dedenting clause keyword, which leading keywords open a statement it can
 * attach to. Used by the text-based clause reindent (see `clauseReindent`).
 */
const CLAUSE_OPENERS: Record<string, string[]> = {
  elif: ['if', 'elif'],
  else: ['if', 'elif', 'for', 'while', 'try'],
  except: ['try', 'except'],
  finally: ['try', 'except', 'else'],
  case: ['match'],
};

/**
 * Indent (in space-columns) for a brand-new line — i.e. the line the caret
 * lands on after pressing Enter. Decided from the previous non-blank line's
 * syntactic context. Returns `null` when there is nothing meaningful above.
 */
export function computeIndentColumns(
  tree: SyntaxTree,
  code: string,
  line: number,
  indentSize: number
): number | null {
  const lines = splitLines(code);
  const prev = prevNonBlank(lines, line);
  if (prev < 0) {
    return null;
  }
  const prevText = lines[prev];
  const lastCol = Math.max(0, trimEnd(prevText).length - 1);
  const prevEnd: Point = { row: prev, column: lastCol };

  const root = tree.rootNode;
  const node = root.descendantForPosition(prevEnd) || root;

  // 1. Continuation inside an unclosed bracket.
  const bracket = findEnclosingOpenBracket(node, prevEnd);
  if (bracket) {
    const open = bracket.kids[bracket.openIdx]!;
    if (isVisualBracket(bracket.kids, bracket.openIdx)) {
      return open.endPosition.column; // align under the first element
    }
    return lineIndentColumns(lines[open.startPosition.row], indentSize) + indentSize;
  }

  // 2. Opening a new block: previous line ends a compound-statement header.
  const header = climb(node, (n) => COMPOUND.has(n.type) && hasBlockChild(n));
  if (header) {
    const colon = lastColon(header);
    if (colon && colon.endPosition.row === prev) {
      return lineIndentColumns(lines[header.startPosition.row], indentSize) + indentSize;
    }
  }

  // 3. Dedent after a flow-terminating statement that ends its block. Measure
  // from the statement's own first line, not `prevText`, so a multi-line
  // `return (...)` dedents from the `return`, not from its closing bracket line.
  const flow = climb(node, (n) => FLOW.has(n.type));
  if (flow && flow.parent && flow.parent.type === 'block' && isLastNamedChild(flow)) {
    const base = lineIndentColumns(lines[flow.startPosition.row], indentSize);
    return Math.max(0, base - indentSize);
  }

  // 4. Otherwise continue at the previous line's indent.
  return lineIndentColumns(prevText, indentSize);
}

/**
 * Indent (in space-columns) for the *current* line's existing content — used
 * when a `:` finishes a dedenting clause header, or a closing bracket starts a
 * line. Returns `null` when the line is not one of those (e.g. a dict/lambda
 * colon, or an inline closing bracket), leaving it untouched.
 */
export function computeLineReindent(
  tree: SyntaxTree,
  code: string,
  line: number,
  indentSize: number
): number | null {
  const lines = splitLines(code);
  if (line < 0 || line >= lines.length) {
    return null;
  }
  const text = lines[line];
  const firstNonWs = text.search(/\S/);
  if (firstNonWs < 0) {
    return null;
  }

  // A closing bracket that begins the line aligns with the line that opened it.
  // Brackets aren't indentation-sensitive, so the tree stays clean here even
  // while the closer itself is mis-indented.
  if (CLOSE.has(text[firstNonWs])) {
    const root = tree.rootNode;
    const node = root.descendantForPosition({ row: line, column: firstNonWs }) || root;
    const closeTok = CLOSE.has(node.type) ? node : firstCloseChild(node);
    const container = closeTok ? closeTok.parent : null;
    const open = container ? firstOpenChild(container) : null;
    return open ? lineIndentColumns(lines[open.startPosition.row], indentSize) : null;
  }

  // A dedenting clause header (else/elif/except/finally/case) aligns with its
  // opener. This is deliberately text-based, not tree-based: an over-indented
  // clause — the common case we're asked to fix — collapses into ERROR nodes and
  // never forms a clean clause node, so we locate the opener structurally over
  // the physical lines instead.
  return clauseReindent(lines, line, indentSize);
}

/**
 * Find the indent a dedenting clause header should take by scanning upward for
 * its matching opener, using a shrinking indent "limit" to step over nested
 * blocks. The clause's current indent (`cur`) disambiguates which opener it
 * belongs to (we never attach to an opener more indented than where it was
 * typed), which resolves cases like `for: … else:` vs `if: … else:`.
 */
function clauseReindent(
  lines: string[],
  line: number,
  indentSize: number
): number | null {
  const text = lines[line];
  const kw = leadingKeyword(text);
  const openers = kw ? CLAUSE_OPENERS[kw] : undefined;
  if (!openers) {
    return null;
  }
  // Must read as a header: ends with ':' (ignoring a trailing comment).
  if (!/:\s*(#.*)?$/.test(text)) {
    return null;
  }

  const cur = lineIndentColumns(text, indentSize);
  let limit = Number.POSITIVE_INFINITY;
  for (let i = line - 1; i >= 0; i--) {
    const t = lines[i];
    if (t.trim() === '') {
      continue;
    }
    const ci = lineIndentColumns(t, indentSize);
    if (ci >= limit) {
      continue; // inside a deeper nested block — skip
    }
    if (ci <= cur && openers.includes(leadingKeyword(t) ?? '')) {
      return kw === 'case' ? ci + indentSize : ci;
    }
    limit = ci;
    if (ci === 0) {
      break;
    }
  }
  return null;
}

function leadingKeyword(lineText: string): string | null {
  const m = /^\s*([a-z]+)\b/.exec(lineText);
  return m ? m[1] : null;
}

// ─── tree helpers ───────────────────────────────────────────────────────────

function climb(
  start: SyntaxNode,
  pred: (n: SyntaxNode) => boolean
): SyntaxNode | null {
  for (let n: SyntaxNode | null = start; n; n = n.parent) {
    if (pred(n)) {
      return n;
    }
  }
  return null;
}

function hasBlockChild(node: SyntaxNode): boolean {
  return node.children.some((c) => c?.type === 'block');
}

function lastColon(node: SyntaxNode): SyntaxNode | null {
  const kids = node.children;
  for (let i = kids.length - 1; i >= 0; i--) {
    if (kids[i]?.type === ':') {
      return kids[i]!;
    }
  }
  return null;
}

function firstOpenChild(node: SyntaxNode): SyntaxNode | null {
  return node.children.find((c) => c && OPEN.has(c.type)) || null;
}

function firstCloseChild(node: SyntaxNode): SyntaxNode | null {
  return node.children.find((c) => c && CLOSE.has(c.type)) || null;
}

function isLastNamedChild(node: SyntaxNode): boolean {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  const named = parent.namedChildren;
  const last = named[named.length - 1];
  return !!last && last.startIndex === node.startIndex && last.endIndex === node.endIndex;
}

/**
 * Innermost ancestor that directly contains an open bracket which is still open
 * at `prevEnd`. Returns the child array (single access, for stable indexing) and
 * the index of the controlling open bracket, or null if not inside a bracket.
 */
function findEnclosingOpenBracket(
  start: SyntaxNode,
  prevEnd: Point
): { kids: (SyntaxNode | null)[]; openIdx: number } | null {
  for (let anc: SyntaxNode | null = start; anc; anc = anc.parent) {
    // A controlling open bracket only ever sits directly inside an
    // expression/statement, never as a direct child of a `block` or the
    // `module` root. Stop before those so we don't materialize their
    // (potentially huge) child lists on every keystroke.
    if (anc.type === 'block' || anc.type === 'module') {
      break;
    }
    const kids = anc.children;
    const stack: number[] = [];
    for (let i = 0; i < kids.length; i++) {
      const ch = kids[i];
      if (!ch) {
        continue;
      }
      if (posLt(prevEnd, ch.startPosition)) {
        break; // children are ordered; nothing more before prevEnd
      }
      if (OPEN.has(ch.type)) {
        stack.push(i);
      } else if (CLOSE.has(ch.type)) {
        stack.pop();
      }
    }
    if (stack.length) {
      return { kids, openIdx: stack[stack.length - 1] };
    }
  }
  return null;
}

/**
 * True when the open bracket has a real element after it on the *same* row
 * (visual/aligned continuation); false when the bracket is last on its line
 * (hanging continuation).
 */
function isVisualBracket(kids: (SyntaxNode | null)[], openIdx: number): boolean {
  const open = kids[openIdx]!;
  for (let i = openIdx + 1; i < kids.length; i++) {
    const ch = kids[i];
    if (!ch || ch.type === 'comment') {
      continue;
    }
    if (CLOSE.has(ch.type)) {
      return false;
    }
    return ch.startPosition.row === open.startPosition.row;
  }
  return false;
}

// ─── text helpers ───────────────────────────────────────────────────────────

/** Split into physical lines, EOL-agnostic (\r\n, \r, \n). */
function splitLines(code: string): string[] {
  return code.split(/\r\n|\r|\n/);
}

function trimEnd(s: string): string {
  return s.replace(/\s+$/, '');
}

/** Leading-whitespace width in columns: space = 1, tab = indentSize. */
function lineIndentColumns(lineText: string, indentSize: number): number {
  let cols = 0;
  for (let i = 0; i < lineText.length; i++) {
    const ch = lineText[i];
    if (ch === ' ') {
      cols += 1;
    } else if (ch === '\t') {
      cols += indentSize;
    } else {
      break;
    }
  }
  return cols;
}

function prevNonBlank(lines: string[], before: number): number {
  for (let i = Math.min(before, lines.length) - 1; i >= 0; i--) {
    if (lines[i].trim() !== '') {
      return i;
    }
  }
  return -1;
}

function posLt(a: Point, b: Point): boolean {
  return a.row < b.row || (a.row === b.row && a.column < b.column);
}
