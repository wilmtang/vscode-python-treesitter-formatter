import { FormatterContext } from './Context';

/**
 * Minimal interface for a Tree-sitter SyntaxNode.
 */
interface SyntaxNode {
  type: string;
  text: string;
  childCount: number;
  child(index: number): SyntaxNode | null;
  namedChildCount: number;
  namedChild(index: number): SyntaxNode | null;
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
  parent: SyntaxNode | null;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
}

/**
 * Printer walks the Tree-sitter AST using a visitor pattern and emits
 * PEP-8 formatted Python code into a FormatterContext.
 *
 * Design principle: format what we understand; for everything else emit the
 * original source text verbatim (the `default` case). We never reconstruct an
 * unknown node from its children, because the generic "concatenate children"
 * path silently drops required spacing. Worst case we under-format an
 * unsupported construct; we never mangle it. The Formatter adds a re-parse
 * safety net on top, so corruption is structurally impossible.
 */
export class Printer {
  private ctx: FormatterContext;

  private static readonly OPEN_BRACKETS = ['(', '[', '{'];
  private static readonly CLOSE_BRACKETS = [')', ']', '}'];

  // Bracketed, comma-separated groups that may be exploded across lines when
  // they don't fit. (Unbracketed comma lists like pattern_list, and grouping
  // parens like parenthesized_expression, are never exploded.)
  private static readonly EXPLODABLE = new Set([
    'argument_list', 'parameters', 'list', 'dictionary', 'set', 'tuple',
  ]);

  constructor(ctx: FormatterContext) {
    this.ctx = ctx;
  }

  public printNode(node: SyntaxNode | null): void {
    if (!node) return;

    // Error-tolerance: preserve malformed code verbatim
    if (node.type === 'ERROR') {
      this.ctx.write(node.text);
      return;
    }

    switch (node.type) {
      case 'module':
        this.printModule(node);
        break;

      case 'function_definition':
      case 'class_definition':
        this.printDefinition(node);
        break;

      case 'decorated_definition':
        this.printDecoratedDefinition(node);
        break;

      case 'block':
        this.printBlock(node);
        break;

      case 'for_statement':
      case 'while_statement':
      case 'if_statement':
      case 'try_statement':
      case 'with_statement':
      case 'elif_clause':
      case 'else_clause':
      case 'except_clause':
      case 'finally_clause':
        this.printStatementWithBlock(node);
        break;

      // Compound expression nodes that need spaces between children
      case 'as_pattern':
      case 'with_clause':
      case 'with_item':
      case 'as_pattern_target':
      case 'for_in_clause':
      case 'if_clause':
        this.printChildrenSpaced(node);
        break;

      case 'expression_statement':
      case 'return_statement':
      case 'pass_statement':
      case 'break_statement':
      case 'continue_statement':
      case 'raise_statement':
      case 'assert_statement':
      case 'delete_statement':
      case 'global_statement':
      case 'nonlocal_statement':
      case 'import_statement':
      case 'import_from_statement':
      case 'print_statement':
      case 'exec_statement':
      case 'yield':
        this.printChildrenSpaced(node);
        break;

      case 'binary_operator':
      case 'boolean_operator':
      case 'comparison_operator':
      case 'augmented_assignment':
        this.printBinaryLike(node);
        break;

      // `name = value`, `name: type`, `name: type = value`, and the parameter
      // forms `x: int` / `x: int = 0`: no space before `:`, one space after;
      // spaces around `=`.
      case 'assignment':
      case 'typed_parameter':
      case 'typed_default_parameter':
        this.printColonEquals(node);
        break;

      case 'not_operator':
        // 'not' <expr>  — space after 'not'
        this.printChildrenSpaced(node);
        break;

      case 'call':
        this.printCall(node);
        break;

      // Bracketed / comma-separated sequences. printListLike inserts a space
      // after each comma and drops a redundant trailing comma.
      case 'argument_list':
      case 'parameters':
      case 'tuple':
      case 'list':
      case 'dictionary':
      case 'set':
      case 'pattern_list':
      case 'expression_list':
      case 'lambda_parameters':
        this.printListLike(node);
        break;

      case 'parenthesized_expression':
        // ( inner ) — drop the parens when they're redundant, else keep them.
        this.printParenthesized(node);
        break;

      // Comprehensions / generator expressions: the body and the
      // `for`/`in`/`if` clauses must be space-separated, or "a for a" collapses
      // into "afor a" (the original corruption bug).
      case 'list_comprehension':
      case 'dictionary_comprehension':
      case 'set_comprehension':
      case 'generator_expression':
        this.printComprehension(node);
        break;

      case 'pair':
        // dict key: value
        if (node.childCount >= 3) {
          this.printNode(node.child(0));
          this.ctx.write(':');
          this.ctx.space();
          this.printNode(node.child(2));
        } else {
          this.printChildrenSpaced(node);
        }
        break;

      case 'keyword_argument':
        // func(key=value) — no spaces around =
        if (node.childCount >= 3) {
          this.printNode(node.child(0));
          this.ctx.write('=');
          this.printNode(node.child(2));
        } else {
          this.printChildren(node);
        }
        break;

      case 'default_parameter':
        // def f(x=1) — no spaces around = (unannotated default)
        if (node.childCount >= 3) {
          this.printNode(node.child(0));
          this.ctx.write('=');
          this.printNode(node.child(2));
        } else {
          this.printChildren(node);
        }
        break;

      case 'attribute':
      case 'subscript':
      case 'unary_operator':
        // No spaces: obj.attr, obj[key], -x
        this.printChildren(node);
        break;

      case 'slice':
        // start:stop:step — colons get spaces only for complex operands.
        this.printSlice(node);
        break;

      case 'conditional_expression':
        this.printChildrenSpaced(node);
        break;

      case 'lambda':
        this.printLambda(node);
        break;

      case 'integer':
      case 'float':
        // Black-style literal normalization (casing only, never the value).
        this.ctx.write(Printer.normalizeNumber(node.text));
        break;

      case 'string':
        // Lowercase the string/bytes prefix (F"x" -> f"x"); body untouched.
        this.ctx.write(Printer.normalizeStringPrefix(node.text));
        break;

      case 'identifier':
      case 'concatenated_string':
      case 'true':
      case 'false':
      case 'none':
      case 'ellipsis':
      case 'type':
        this.ctx.write(node.text);
        break;

      case 'comment':
        this.ctx.write(node.text);
        this.ctx.newline();
        break;

      case 'decorator':
        this.ctx.write(node.text);
        this.ctx.newline();
        break;

      default:
        // Lossless fallback. Anything without a correct, tested handler is
        // emitted as its ORIGINAL source text rather than rebuilt from its
        // children — see the class comment.
        this.ctx.write(node.text);
        break;
    }
  }

  private printModule(node: SyntaxNode): void {
    this.printStatements(node, true);
  }

  /**
   * Print a function_definition or class_definition.
   *
   * Children of function_definition:
   *   def, identifier, parameters, :, block
   *   (optionally: ->, type for return annotation)
   *
   * Children of class_definition:
   *   class, identifier, argument_list (bases), :, block
   */
  private printDefinition(node: SyntaxNode): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;

      if (child.type === 'block') {
        // Block handles its own indentation and newlines
        this.printNode(child);
      } else if (child.type === 'parameters' || child.type === 'argument_list') {
        // No space before ( — function name is immediately followed by params
        this.printNode(child);
      } else if (child.type === ':') {
        this.ctx.write(':');
      } else if (child.type === '->') {
        this.ctx.space();
        this.ctx.write('->');
        this.ctx.space();
      } else {
        this.printNode(child);
        // Add space after keywords like 'def', 'class', and after identifier
        // (but only if the next child is not parameters/argument_list/colon)
        const next = i < node.childCount - 1 ? node.child(i + 1) : null;
        if (next && next.type !== 'parameters' && next.type !== 'argument_list' && next.type !== ':') {
          this.ctx.space();
        }
      }
    }
  }

  /**
   * Print a decorated_definition: decorator(s) followed by a definition.
   */
  private printDecoratedDefinition(node: SyntaxNode): void {
    for (let i = 0; i < node.childCount; i++) {
      this.printNode(node.child(i));
    }
  }

  /**
   * Print a block (indented body of a statement).
   */
  private printBlock(node: SyntaxNode): void {
    this.ctx.indent();
    this.ctx.newline();
    this.printStatements(node, false);
    this.ctx.dedent();
    // Leave a pending newline so whatever follows the block — a sibling clause
    // (elif/else/except/finally) or a dedented statement — starts on its own
    // line instead of running onto the block's last line.
    this.ctx.newline();
  }

  private isDefLike(node: SyntaxNode): boolean {
    return (
      node.type === 'function_definition' ||
      node.type === 'class_definition' ||
      node.type === 'decorated_definition'
    );
  }

  /**
   * Print a sequence of statements (a module body or a block body) with:
   *  - PEP-8 blank-line separation around definitions (2 at top level, 1 nested)
   *  - preservation of author blank lines, capped (2 at top level, 1 nested)
   *  - inline (trailing) comments kept on the previous statement's line
   *  - semicolon-separated simple statements split onto their own lines
   */
  private printStatements(node: SyntaxNode, topLevel: boolean): void {
    const defBlanks = topLevel ? 2 : 1;
    const maxBlanks = topLevel ? 2 : 1;
    let prev: SyntaxNode | null = null;
    let prevWasDef = false;

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;

      // Semicolons separate simple statements on one line; we split them, so
      // the token itself is dropped.
      if (child.type === ';') {
        continue;
      }

      if (prev !== null) {
        // Inline comment sharing the previous statement's source line.
        if (child.type === 'comment' && child.startPosition.row === prev.endPosition.row) {
          this.ctx.trailingComment(child.text);
          prev = child;
          continue;
        }

        const gap = child.startPosition.row - prev.endPosition.row;
        let blanks = Math.min(Math.max(gap - 1, 0), maxBlanks);
        if (this.isDefLike(child) || prevWasDef) {
          blanks = Math.max(blanks, defBlanks);
        }
        if (blanks >= 2) {
          this.ctx.twoBlankLines();
        } else if (blanks === 1) {
          this.ctx.emptyLine();
        } else {
          this.ctx.newline();
        }
      }

      this.printNode(child);
      prev = child;
      prevWasDef = this.isDefLike(child);
    }
  }

  private printChildren(node: SyntaxNode): void {
    for (let i = 0; i < node.childCount; i++) {
      this.printNode(node.child(i));
    }
  }

  private printChildrenSpaced(node: SyntaxNode): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      this.printNode(child);
      if (i < node.childCount - 1) {
        const next = node.child(i + 1)!;
        // Don't add space before/after certain punctuation
        if (
          ![':', ',', '.', '(', ')', '[', ']', '{', '}'].includes(next.type) &&
          !['(', '[', '{'].includes(child.type)
        ) {
          this.ctx.space();
        }
      }
    }
  }

  private printStatementWithBlock(node: SyntaxNode): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === 'block') {
        this.printNode(child);
      } else {
        this.printNode(child);
        if (
          child.type !== ':' &&
          i < node.childCount - 1 &&
          node.child(i + 1)?.type !== ':'
        ) {
          this.ctx.space();
        }
      }
    }
  }

  private printBinaryLike(node: SyntaxNode): void {
    if (node.childCount >= 3) {
      this.printNode(node.child(0));
      this.ctx.space();
      this.printNode(node.child(1));
      this.ctx.space();
      this.printNode(node.child(2));
      // Handle chained comparisons: a < b < c
      for (let i = 3; i < node.childCount; i++) {
        this.ctx.space();
        this.printNode(node.child(i));
      }
    } else {
      this.printChildrenSpaced(node);
    }
  }

  /**
   * Print nodes whose children are separated by `:` (annotation) and/or `=`
   * (assignment / annotated default). No space before `:`, one space after;
   * spaces around `=`. Covers assignment, typed_parameter, typed_default_parameter.
   */
  private printColonEquals(node: SyntaxNode): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === ':') {
        this.ctx.write(':');
        this.ctx.space();
      } else if (child.type === '=') {
        this.ctx.space();
        this.ctx.write('=');
        this.ctx.space();
      } else {
        this.printNode(child);
      }
    }
  }

  private printCall(node: SyntaxNode): void {
    // No space between function name and argument_list
    for (let i = 0; i < node.childCount; i++) {
      this.printNode(node.child(i));
    }
  }

  private printListLike(node: SyntaxNode): void {
    if (this.shouldExplode(node)) {
      this.printExploded(node);
    } else {
      this.printFlatList(node);
    }
  }

  /**
   * Decide whether a bracketed group should be exploded across lines: only when
   * wrapping is enabled, the group is explodable and non-empty, and its flat
   * rendering would push the current line past the max width.
   */
  private shouldExplode(node: SyntaxNode): boolean {
    if (!Number.isFinite(this.ctx.maxWidth)) return false;
    if (!Printer.EXPLODABLE.has(node.type)) return false;
    if (node.childCount <= 2) return false; // just the brackets, nothing inside
    const lineWidth =
      this.ctx.currentColumn() + this.flatWidth(node) + this.headerSuffixWidth(node);
    return lineWidth > this.ctx.maxWidth;
  }

  /**
   * Width of the tokens that follow this group on the same line. Today this only
   * matters for a function/class `parameters` list, which is always followed by
   * `:` (and optionally `-> <type>`) — without counting them, a header that is
   * one or two chars over the limit is wrongly judged to fit.
   */
  private headerSuffixWidth(node: SyntaxNode): number {
    const parent = node.parent;
    if (!parent || node.type !== 'parameters') return 0;
    let width = 0;
    let seenParams = false;
    for (let i = 0; i < parent.childCount; i++) {
      const sib = parent.child(i);
      if (!sib) continue;
      if (seenParams) {
        if (sib.type === 'block') break;
        if (sib.type === ':') width += 1;
        else if (sib.type === '->') width += 4; // " -> "
        else width += this.flatWidth(sib);
      }
      if (sib.type === 'parameters') seenParams = true;
    }
    return width;
  }

  /** Width of `node` rendered flat (no wrapping), via a throwaway context. */
  private flatWidth(node: SyntaxNode): number {
    const probe = new FormatterContext(this.ctx.getIndentSize(), Number.POSITIVE_INFINITY);
    new Printer(probe).printNode(node);
    return probe.getRaw().length;
  }

  /** Single-line rendering: `space` after each comma, redundant trailing comma dropped. */
  private printFlatList(node: SyntaxNode): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === ',') {
        const next = i + 1 < node.childCount ? node.child(i + 1)! : null;
        const isTrailing = !!next && Printer.CLOSE_BRACKETS.includes(next.type);
        // Drop a redundant trailing comma — but NOT in a tuple, where a single
        // trailing comma is significant: "(1,)" is a 1-tuple, "(1)" is not.
        if (isTrailing && node.type !== 'tuple') {
          continue;
        }
        this.ctx.write(',');
        if (!isTrailing) {
          this.ctx.space();
        }
      } else {
        this.printNode(child);
      }
    }
  }

  /**
   * Multi-line rendering: open bracket, then one element per indented line
   * (recursively, so a too-wide element is itself wrapped), then the closing
   * bracket back at the statement's indent. No trailing comma is added — this
   * keeps `*args`/`**kwargs` valid and lets the group collapse back to one line
   * if it later fits (idempotent, width-driven).
   */
  private printExploded(node: SyntaxNode): void {
    const open = node.child(0)!;
    const close = node.child(node.childCount - 1)!;

    const elements: SyntaxNode[] = [];
    for (let i = 1; i < node.childCount - 1; i++) {
      const child = node.child(i)!;
      if (child.type !== ',') {
        elements.push(child);
      }
    }

    this.printNode(open);
    this.ctx.indent();
    for (let i = 0; i < elements.length; i++) {
      this.ctx.newline();
      this.printNode(elements[i]);
      if (i < elements.length - 1) {
        this.ctx.write(',');
      }
    }
    this.ctx.dedent();
    this.ctx.newline();
    this.printNode(close);
  }

  /**
   * Comprehensions and generator expressions: space-separate the body and each
   * clause, but keep brackets tight (no space after `[`/`(`/`{` or before the
   * closer).
   */
  private printComprehension(node: SyntaxNode): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      this.printNode(child);
      const next = i + 1 < node.childCount ? node.child(i + 1)! : null;
      if (
        next &&
        !Printer.OPEN_BRACKETS.includes(child.type) &&
        !Printer.CLOSE_BRACKETS.includes(next.type)
      ) {
        this.ctx.space();
      }
    }
  }

  private printLambda(node: SyntaxNode): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === 'lambda') {
        // Write the keyword token directly. Recursing would re-enter this same
        // case on the keyword child (it shares the node type "lambda") and emit
        // nothing — which is exactly how the keyword used to get deleted.
        this.ctx.write('lambda');
      } else if (child.type === ':') {
        this.ctx.write(':');
        this.ctx.space();
      } else {
        // A space separates the `lambda` keyword from its parameters.
        const prevChild = i > 0 ? node.child(i - 1) : null;
        if (prevChild && prevChild.type === 'lambda') {
          this.ctx.space();
        }
        this.printNode(child);
      }
    }
  }

  /**
   * A parenthesized_expression `( inner )`. When the parentheses are redundant we
   * print only the inner expression (`return (x)` -> `return x`); otherwise the
   * parens are kept (printed like any other bracketed group).
   */
  private printParenthesized(node: SyntaxNode): void {
    if (this.parensAreRedundant(node)) {
      this.printNode(node.child(1)); // the single inner expression
    } else {
      this.printListLike(node);
    }
  }

  /**
   * Parentheses are redundant only when BOTH hold:
   *  - the parent is a "neutral" position where the parens cannot be carrying
   *    operator precedence — a statement value, an assignment side, a flow
   *    condition, or an enclosing pair of parens; and
   *  - the inner expression doesn't itself require parentheses (`:=` walrus and
   *    `yield` are kept, since stripping them can change validity or meaning).
   *
   * This is why precedence is always safe: in `(a + b) * c` the inner parens'
   * parent is the `*` binary_operator, not a neutral position, so they're kept.
   */
  private parensAreRedundant(node: SyntaxNode): boolean {
    if (node.childCount !== 3) return false; // exactly ( inner )
    const open = node.child(0)!;
    const inner = node.child(1)!;
    const close = node.child(2)!;
    if (open.type !== '(' || close.type !== ')') return false;
    if (inner.type === 'named_expression' || inner.type === 'yield') return false;

    const parent = node.parent;
    if (!parent) return false;
    switch (parent.type) {
      case 'expression_statement':
      case 'return_statement':
      case 'assignment':
      case 'augmented_assignment':
      case 'if_statement':
      case 'while_statement':
      case 'elif_clause':
      case 'parenthesized_expression':
        return true;
      default:
        return false;
    }
  }

  /** Operand node types simple enough to keep a slice tight (no colon spaces). */
  private static readonly SIMPLE_SLICE_OPERANDS = new Set([
    'identifier', 'integer', 'float', 'none', 'true', 'false',
    'unary_operator', 'attribute',
  ]);

  /**
   * A slice `start:stop:step`. PEP-8/Black treat the colon like a binary operator
   * and space it equally — but only for a "complex" slice (any operand beyond a
   * bare name/number). Simple slices like `a[1:9]` or `a[::2]` stay tight. The
   * space is omitted on a side whose operand is absent, so `a[x + 1 :]` doesn't
   * grow a dangling space before `]`.
   */
  private printSlice(node: SyntaxNode): void {
    const complex = this.sliceIsComplex(node);
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === ':') {
        const prev = i > 0 ? node.child(i - 1) : null;
        const next = i + 1 < node.childCount ? node.child(i + 1) : null;
        if (complex && prev && prev.type !== ':') this.ctx.space();
        this.ctx.write(':');
        if (complex && next && next.type !== ':') this.ctx.space();
      } else {
        this.printNode(child);
      }
    }
  }

  /** A slice is "complex" if any present operand is more than a bare name/number. */
  private sliceIsComplex(node: SyntaxNode): boolean {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      if (child.type === ':') continue;
      if (!Printer.SIMPLE_SLICE_OPERANDS.has(child.type)) return true;
    }
    return false;
  }

  /**
   * Black-style numeric normalization: lowercase the literal, but UPPERCASE the
   * digits of a hex literal. `0XFF` -> `0xFF`, `1E3` -> `1e3`, `3J` -> `3j`,
   * `0xab_cd` -> `0xAB_CD`. Only casing changes; the value never does.
   */
  private static normalizeNumber(text: string): string {
    const lower = text.toLowerCase();
    if (lower.startsWith('0x')) {
      return '0x' + lower.slice(2).toUpperCase();
    }
    return lower;
  }

  /**
   * Lowercase a string/bytes prefix: `F"x"` -> `f"x"`, `RB'y'` -> `rb'y'`. Only a
   * recognized prefix (a 1-2 letter combo of r/b/f/u before the opening quote) is
   * touched; the quote style and the body — including f-string interpolations —
   * are left exactly as written.
   */
  private static normalizeStringPrefix(text: string): string {
    const m = /^([A-Za-z]{1,2})(['"])/.exec(text);
    if (!m || !/^[rbfu]+$/i.test(m[1])) {
      return text;
    }
    return m[1].toLowerCase() + text.slice(m[1].length);
  }
}
