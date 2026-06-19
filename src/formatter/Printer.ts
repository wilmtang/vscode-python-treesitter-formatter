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
 * For ERROR nodes (syntax errors), the original text is preserved as-is
 * to provide error-tolerant formatting.
 */
export class Printer {
  private ctx: FormatterContext;

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
      case 'assignment':
      case 'augmented_assignment':
        this.printBinaryLike(node);
        break;

      case 'not_operator':
        // 'not' <expr>  — space after 'not'
        this.printChildrenSpaced(node);
        break;

      case 'call':
        this.printCall(node);
        break;

      case 'argument_list':
      case 'parameters':
      case 'tuple':
      case 'list':
      case 'dictionary':
      case 'set':
      case 'parenthesized_expression':
      case 'generator_expression':
      case 'list_comprehension':
      case 'dictionary_comprehension':
      case 'set_comprehension':
        this.printListLike(node);
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
        // def f(x=1) — no spaces around =
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
      case 'slice':
      case 'unary_operator':
        // No spaces: obj.attr, obj[key], start:stop, -x
        this.printChildren(node);
        break;

      case 'lambda':
      case 'conditional_expression':
        this.printChildrenSpaced(node);
        break;

      case 'identifier':
      case 'integer':
      case 'float':
      case 'string':
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
        if (node.childCount === 0) {
          this.ctx.write(node.text);
        } else {
          this.printChildren(node);
        }
        break;
    }
  }

  /**
   * Print module-level children with PEP-8 blank line separation:
   * - Two blank lines before/after top-level function/class definitions
   * - One newline after other statements
   */
  private printModule(node: SyntaxNode): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      const isDefLike = child.type === 'function_definition' ||
                         child.type === 'class_definition' ||
                         child.type === 'decorated_definition';

      // PEP-8: two blank lines before top-level definitions
      if (isDefLike && i > 0) {
        this.ctx.twoBlankLines();
      }

      this.printNode(child);

      // PEP-8: two blank lines after top-level definitions
      if (isDefLike) {
        this.ctx.twoBlankLines();
      } else {
        this.ctx.newline();
      }
    }
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
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      const isDefLike = child.type === 'function_definition' ||
                         child.type === 'class_definition' ||
                         child.type === 'decorated_definition';

      // PEP-8: blank line before nested definitions
      if (isDefLike && i > 0) {
        this.ctx.emptyLine();
      }

      this.printNode(child);

      // PEP-8: blank line after nested definitions
      if (isDefLike && i < node.childCount - 1) {
        this.ctx.emptyLine();
      } else {
        this.ctx.newline();
      }
    }
    this.ctx.dedent();
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

  private printCall(node: SyntaxNode): void {
    // No space between function name and argument_list
    for (let i = 0; i < node.childCount; i++) {
      this.printNode(node.child(i));
    }
  }

  private printListLike(node: SyntaxNode): void {
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i)!;
      this.printNode(child);
      if (child.type === ',') {
        this.ctx.space();
      }
    }
  }
}
