import { ParserService } from '../parser/ParserService';

/**
 * Repairer performs best-effort, deterministic repair of common syntax breakage
 * BEFORE formatting — turning code that doesn't parse into code that does, the
 * way an error-recovering IDE (PyCharm) would.
 *
 * The cardinal rule is verify-or-revert: every candidate edit is applied to a
 * copy, the copy is re-parsed, and the edit is kept ONLY if it strictly reduces
 * the number of parse errors. An edit that doesn't help (or makes things worse)
 * is discarded. This makes repair safe by construction: it can never make code
 * parse worse than it already did, and ambiguous cases are simply left alone.
 *
 * Tree-sitter does not model these errors as tidy MISSING tokens — it collapses
 * a broken construct into a flat ERROR node and discards the nesting — so repair
 * works at the source-text level, guided by the parse-error count.
 */
export class Repairer {
  /**
   * Compound-statement headers that must end with a colon. `async` is included
   * so that `async def` / `async for` / `async with` headers are handled; the
   * verify-or-revert guard makes a spurious match harmless.
   */
  private static readonly HEADER_KEYWORDS = new Set([
    'if', 'elif', 'else', 'for', 'while', 'def', 'class',
    'try', 'except', 'finally', 'with', 'async',
  ]);

  /**
   * Attempt to repair `code`. Returns repaired source (which parses at least as
   * well as the input), or the input unchanged if nothing could be improved.
   */
  public static repair(code: string): string {
    if (this.errorCount(code) === 0) {
      return code;
    }
    return this.repairMissingColons(code);
  }

  /**
   * Insert a missing colon at the end of a compound-statement header line.
   * Each insertion is verified by re-parsing and kept only if it reduces errors.
   */
  private static repairMissingColons(code: string): string {
    const lines = code.split('\n');
    let errors = this.errorCount(lines.join('\n'));

    for (let i = 0; i < lines.length && errors > 0; i++) {
      const line = lines[i];
      const afterIndent = line.slice(line.length - line.trimStart().length);
      const keyword = /^([A-Za-z_]+)/.exec(afterIndent)?.[1];
      if (!keyword || !this.HEADER_KEYWORDS.has(keyword)) {
        continue;
      }

      const { codePart, comment } = this.splitTrailingComment(line);
      const trimmed = codePart.replace(/\s+$/, '');
      if (trimmed === '' || trimmed.endsWith(':')) {
        continue;
      }

      const candidate = trimmed + ':' + (comment ? '  ' + comment : '');
      const trial = lines.slice();
      trial[i] = candidate;
      const trialErrors = this.errorCount(trial.join('\n'));

      if (trialErrors < errors) {
        lines[i] = candidate;
        errors = trialErrors;
      }
    }

    return lines.join('\n');
  }

  /**
   * Split a single line into its code and a trailing `# comment`, ignoring any
   * `#` that appears inside a string literal. Good enough for header lines.
   */
  private static splitTrailingComment(line: string): { codePart: string; comment: string } {
    let quote: string | null = null;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (ch === '\\') {
          i++;
        } else if (ch === quote) {
          quote = null;
        }
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '#') {
        return { codePart: line.slice(0, i), comment: line.slice(i) };
      }
    }
    return { codePart: line, comment: '' };
  }

  /** Count ERROR and MISSING nodes — a proxy for "how broken is this". */
  private static errorCount(code: string): number {
    const tree = ParserService.parse(code);
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
    walk(tree.rootNode);
    return count;
  }
}
