import * as vscode from 'vscode';
import { IncrementalParser } from '../parser/IncrementalParser';
import { computeIndentColumns, computeLineReindent } from '../formatter/IndentResolver';

/**
 * On-type indentation for Python, driven by the Tree-sitter parse.
 *
 * Registered with triggers `\n`, `:`, `)`, `]`, `}` (see extension.ts):
 *  - On Enter (`\n`) it sets the new line's indent (block openers, bracket
 *    continuations, flow dedents).
 *  - On `:` / closing bracket it re-aligns the current line (dedenting clause
 *    headers like `else:`/`except:`/`case:`, or a closing-bracket line).
 *
 * It edits only the leading whitespace of the affected line, so it never
 * disturbs typed content or line endings. When the oracle can't decide, it
 * returns no edits and the editor's built-in indentation stands.
 */
export class IndentOnTypeProvider implements vscode.OnTypeFormattingEditProvider {
  constructor(private readonly parser: IncrementalParser) {}

  provideOnTypeFormattingEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    ch: string,
    _options: vscode.FormattingOptions,
    token: vscode.CancellationToken
  ): vscode.TextEdit[] {
    try {
      if (token.isCancellationRequested) {
        return [];
      }

      const config = vscode.workspace.getConfiguration('treesitterFormatter');
      if (!config.get<boolean>('indentOnType', true)) {
        return [];
      }
      const indentSize = config.get<number>('indentSize') || 4;

      const tree = this.parser.getTree(document);
      if (!tree) {
        return [];
      }
      const text = document.getText();

      const columns =
        ch === '\n'
          ? computeIndentColumns(tree, text, position.line, indentSize)
          : computeLineReindent(tree, text, position.line, indentSize);
      if (columns === null) {
        return [];
      }

      const line = document.lineAt(position.line);
      const wsRange = new vscode.Range(
        position.line,
        0,
        position.line,
        line.firstNonWhitespaceCharacterIndex
      );
      const desired = ' '.repeat(Math.max(0, columns));
      if (document.getText(wsRange) === desired) {
        return []; // already correct — avoid a no-op edit
      }
      return [vscode.TextEdit.replace(wsRange, desired)];
    } catch (error) {
      // On-type formatting must never disrupt the user's typing — fail closed.
      console.error('On-type indentation failed:', error);
      return [];
    }
  }
}
