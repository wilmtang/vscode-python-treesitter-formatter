import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * E2E tests for AST-aware on-type indentation, driven through the real provider
 * on a live VS Code instance via the `vscode.executeFormatOnTypeProvider`
 * command (which runs the registered provider but does not depend on the user's
 * `editor.formatOnType` setting, so results are deterministic).
 *
 * Cases are pre-created test data in test/fixtures/indent/cases.json. Each case
 * is the document *as it exists right after the keystroke*; we invoke the
 * provider at the given position/trigger, apply the returned edits, and assert
 * the document matches `expected`.
 */

const WORKSPACE_ROOT = path.resolve(__dirname, '../../../');
const CASES_PATH = path.join(WORKSPACE_ROOT, 'test', 'fixtures', 'indent', 'cases.json');

interface IndentCase {
  name: string;
  input: string;
  line: number;
  character: number;
  ch: string;
  expected: string;
  config?: { indentOnType?: boolean };
}

const cases: IndentCase[] = JSON.parse(fs.readFileSync(CASES_PATH, 'utf8'));
let counter = 0;

async function runOnTypeCase(testCase: IndentCase): Promise<string> {
  const filePath = path.join(WORKSPACE_ROOT, `__indent_e2e_${++counter}.py`);
  fs.writeFileSync(filePath, testCase.input);

  const cfg = vscode.workspace.getConfiguration('treesitterFormatter');
  const overriding = !!testCase.config && 'indentOnType' in testCase.config;

  try {
    const doc = await vscode.workspace.openTextDocument(filePath);

    // Wait for the extension to activate (parser + provider registration).
    await new Promise((resolve) => setTimeout(resolve, 2000));

    if (overriding) {
      await cfg.update(
        'indentOnType',
        testCase.config!.indentOnType,
        vscode.ConfigurationTarget.Global
      );
    }

    try {
      const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
        'vscode.executeFormatOnTypeProvider',
        doc.uri,
        new vscode.Position(testCase.line, testCase.character),
        testCase.ch,
        { tabSize: 4, insertSpaces: true }
      );

      if (edits && edits.length > 0) {
        const workspaceEdit = new vscode.WorkspaceEdit();
        workspaceEdit.set(doc.uri, edits);
        await vscode.workspace.applyEdit(workspaceEdit);
      }

      return doc.getText();
    } finally {
      if (overriding) {
        await cfg.update('indentOnType', undefined, vscode.ConfigurationTarget.Global);
      }
    }
  } finally {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

describe('E2E: AST-aware on-type indentation', () => {
  for (const testCase of cases) {
    it(testCase.name, async function () {
      this.timeout(30000);
      const result = await runOnTypeCase(testCase);
      assert.strictEqual(result, testCase.expected);
    });
  }
});
