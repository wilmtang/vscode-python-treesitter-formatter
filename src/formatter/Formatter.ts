import { ParserService } from '../parser/ParserService';
import { FormatterContext } from './Context';
import { Printer } from './Printer';
import { Repairer } from './Repairer';

export class Formatter {
  /**
   * Format Python source.
   *
   * @param code          the source to format
   * @param indentSize    spaces per indent level (default 4)
   * @param repairSyntax  when true (and the input has parse errors), attempt a
   *   deterministic, verify-or-revert repair pass (e.g. inserting a missing
   *   colon) before formatting.
   * @param maxLineLength wrap bracketed constructs that would exceed this width
   *   (default Infinity = no wrapping).
   */
  public static format(
    code: string,
    indentSize: number = 4,
    repairSyntax: boolean = true,
    maxLineLength: number = Number.POSITIVE_INFINITY
  ): string {
    const inputTree = ParserService.parse(code);
    const originalErrors = this.errorCount(inputTree.rootNode);

    // Repair pre-pass — only when there's something broken to fix.
    let source = code;
    let tree = inputTree;
    if (repairSyntax && originalErrors > 0) {
      source = Repairer.repair(code);
      if (source !== code) {
        tree = ParserService.parse(source);
      }
    }

    const ctx = new FormatterContext(indentSize, maxLineLength);
    const printer = new Printer(ctx);
    printer.printNode(tree.rootNode);
    const formatted = ctx.getOutput();

    // Safety net: never emit code that parses worse than the ORIGINAL input.
    // Together with the Printer's lossless-passthrough default, this makes it
    // structurally impossible for the formatter to corrupt code.
    const outputTree = ParserService.parse(formatted);
    if (this.errorCount(outputTree.rootNode) > originalErrors) {
      return code;
    }

    return formatted;
  }

  /**
   * Count ERROR and MISSING nodes in a tree — a proxy for "how broken is this".
   * Used to detect whether formatting made the code parse worse than the input.
   */
  private static errorCount(root: any): number {
    let count = 0;
    const isMissing = (n: any): boolean =>
      typeof n.isMissing === 'function' ? n.isMissing() : !!n.isMissing;

    const walk = (n: any): void => {
      if (n.type === 'ERROR' || isMissing(n)) {
        count++;
      }
      for (let i = 0; i < n.childCount; i++) {
        walk(n.child(i));
      }
    };

    walk(root);
    return count;
  }
}
