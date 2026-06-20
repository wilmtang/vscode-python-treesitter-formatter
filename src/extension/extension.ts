import * as vscode from 'vscode';
import { ParserService } from '../parser/ParserService';
import { IncrementalParser } from '../parser/IncrementalParser';
import { Formatter } from '../formatter/Formatter';
import { IndentOnTypeProvider } from './IndentOnTypeProvider';

let incrementalParser: IncrementalParser | undefined;

export async function activate(context: vscode.ExtensionContext) {
  console.log('Activating Error-Tolerant Python Formatter');

  try {
    await ParserService.init(context.extensionPath);
  } catch (error) {
    console.error('Failed to initialize tree-sitter:', error);
    vscode.window.showErrorMessage(
      'Failed to initialize tree-sitter parser for Python Formatter.'
    );
    return;
  }

  const formatterProvider = vscode.languages.registerDocumentFormattingEditProvider(
    'python',
    {
      provideDocumentFormattingEdits(
        document: vscode.TextDocument
      ): vscode.TextEdit[] {
        try {
          const config = vscode.workspace.getConfiguration('treesitterFormatter');
          const indentSize = config.get<number>('indentSize') || 4;
          const repairSyntax = config.get<boolean>('repairSyntax') ?? true;
          const maxLineLength = config.get<number>('maxLineLength') || 88;

          const originalText = document.getText();
          const formattedText = Formatter.format(
            originalText,
            indentSize,
            repairSyntax,
            maxLineLength
          );

          const fullRange = new vscode.Range(
            document.positionAt(0),
            document.positionAt(originalText.length)
          );

          return [vscode.TextEdit.replace(fullRange, formattedText)];
        } catch (error) {
          console.error('Formatting error:', error);
          vscode.window.showErrorMessage(
            'Error-Tolerant Python Formatter encountered an internal error.'
          );
          return [];
        }
      }
    }
  );

  context.subscriptions.push(formatterProvider);

  // On-type indentation: keep a per-document tree updated incrementally, and use
  // it to indent the caret as the user types (Enter, and `:`/closing-bracket
  // re-alignment). Requires `editor.formatOnType` (defaulted on for Python via
  // package.json's configurationDefaults).
  const incremental = new IncrementalParser();
  incrementalParser = incremental;
  incremental.seed(vscode.workspace.textDocuments);

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument((doc) => incremental.onOpen(doc)),
    vscode.workspace.onDidChangeTextDocument((event) => incremental.onChange(event)),
    vscode.workspace.onDidCloseTextDocument((doc) => incremental.onClose(doc)),
    vscode.languages.registerOnTypeFormattingEditProvider(
      'python',
      new IndentOnTypeProvider(incremental),
      '\n',
      ':',
      ')',
      ']',
      '}'
    )
  );
}

export function deactivate() {
  incrementalParser?.dispose();
  incrementalParser = undefined;
}
