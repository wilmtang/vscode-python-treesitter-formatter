/**
 * FormatterContext manages output generation state: indentation level,
 * pending blank lines, and the output buffer.
 *
 * Instead of appending newlines immediately (and then fighting trimEnd()),
 * we track pending blank lines as a count. When actual content is written,
 * we flush the pending newlines first. This makes it trivial to enforce
 * PEP-8's "two blank lines between top-level definitions" vs "one blank
 * line between methods" without trimEnd() eating accumulated newlines.
 */
export class FormatterContext {
  private indentLevel = 0;
  private indentSize: number;
  private output = '';

  /**
   * Number of newlines pending before the next content write.
   *
   * - 0 means "continue on the current line"
   * - 1 means "start a new line" (one \n)
   * - 2 means "one blank line" (two \n's)
   * - 3 means "two blank lines" (three \n's — PEP-8 top-level separation)
   *
   * When content is written, we flush exactly this many \n's, then reset to 0.
   * Multiple calls to newline/emptyLine take the max, not the sum.
   */
  private pendingNewlines = 0;

  /** Whether we've written any content at all yet. */
  private hasContent = false;

  constructor(indentSize: number = 4) {
    this.indentSize = indentSize;
  }

  /**
   * Return the final formatted output, with a single trailing newline.
   */
  public getOutput(): string {
    // Trim trailing whitespace/blank lines, then add exactly one \n
    return this.output.trimEnd() + '\n';
  }

  public indent(): void {
    this.indentLevel++;
  }

  public dedent(): void {
    if (this.indentLevel > 0) {
      this.indentLevel--;
    }
  }

  /**
   * Write content. Flushes any pending newlines first.
   */
  public write(text: string): void {
    if (text.length === 0) return;
    this.flushPendingNewlines();
    this.output += text;
  }

  /**
   * Write a space (unless we're at line start or already have one).
   */
  public space(): void {
    if (this.pendingNewlines === 0 && this.output.length > 0 && !this.output.endsWith(' ')) {
      this.output += ' ';
    }
  }

  /**
   * Request a newline before the next content.
   * Multiple calls are idempotent — the max wins.
   */
  public newline(): void {
    this.pendingNewlines = Math.max(this.pendingNewlines, 1);
  }

  /**
   * Request one blank line (= 2 newline characters) before the next content.
   */
  public emptyLine(): void {
    this.pendingNewlines = Math.max(this.pendingNewlines, 2);
  }

  /**
   * Request two blank lines (= 3 newline characters) before the next content.
   * PEP-8: "Surround top-level function and class definitions with two blank lines."
   */
  public twoBlankLines(): void {
    this.pendingNewlines = Math.max(this.pendingNewlines, 3);
  }

  /**
   * Flush pending newlines into the output buffer, then apply indentation.
   */
  private flushPendingNewlines(): void {
    if (this.pendingNewlines > 0 && this.hasContent) {
      // Trim trailing spaces from the last line (but not newlines)
      const lastNewline = this.output.lastIndexOf('\n');
      if (lastNewline !== -1 && lastNewline < this.output.length - 1) {
        const trailing = this.output.slice(lastNewline + 1);
        if (trailing.trim() === '') {
          this.output = this.output.slice(0, lastNewline + 1);
        }
      } else if (lastNewline === -1) {
        // No newline in output yet — trim trailing spaces from the whole thing
        this.output = this.output.trimEnd();
      }

      this.output += '\n'.repeat(this.pendingNewlines);
      this.pendingNewlines = 0;
    }

    // Apply indentation for the upcoming content
    if (this.hasContent && this.output.endsWith('\n')) {
      this.output += ' '.repeat(this.indentLevel * this.indentSize);
    } else if (!this.hasContent) {
      // First write — no newlines before it, but maybe indent
      // (top-level code shouldn't be indented, so indentLevel is 0)
    }

    this.hasContent = true;
  }
}
