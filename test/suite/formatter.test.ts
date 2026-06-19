import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Comprehensive E2E tests for the Error-Tolerant Python Formatter.
 *
 * Every test goes through the full VS Code formatting pipeline:
 *   write .py file → open in editor → editor.action.formatDocument → assert
 *
 * This exercises the entire chain: extension activation → Tree-sitter WASM
 * init → parser → formatter → VS Code TextEdit application.
 */

const WORKSPACE_ROOT = path.resolve(__dirname, '../../../');
let testFileCounter = 0;

/**
 * Helper: write input to a temp .py file, open it in VS Code, trigger
 * format, and return the formatted text.
 */
async function formatViaVSCode(input: string): Promise<string> {
    const filename = `__e2e_test_${++testFileCounter}.py`;
    const filePath = path.join(WORKSPACE_ROOT, filename);
    fs.writeFileSync(filePath, input);

    try {
        const doc = await vscode.workspace.openTextDocument(filePath);

        // Wait for the extension to activate
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Request formatting edits directly from the provider without opening an editor window
        // This runs in the background and prevents the test from stealing focus or capturing user keystrokes
        const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>(
            'vscode.executeFormatDocumentProvider',
            doc.uri,
            { tabSize: 4, insertSpaces: true }
        );

        if (edits && edits.length > 0) {
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.set(doc.uri, edits);
            await vscode.workspace.applyEdit(workspaceEdit);
        }

        return doc.getText();
    } finally {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
}


describe('E2E: Error-Tolerant Python Formatter', () => {

    // ─────────────────────────────────────────────────────────────
    //  BASIC FORMATTING
    // ─────────────────────────────────────────────────────────────

    it('formats a basic function definition', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            'def foo(a,b):\n    print(a)\n    return b'
        );
        assert.strictEqual(result, 'def foo(a, b):\n    print(a)\n    return b\n');
    });

    it('formats binary operators with PEP-8 spacing', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x=1+2*3');
        assert.strictEqual(result, 'x = 1 + 2 * 3\n');
    });

    it('formats comparison operators', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('if x>5:\n    pass');
        assert.strictEqual(result, 'if x > 5:\n    pass\n');
    });

    it('formats assignment with extra whitespace', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x   =   42');
        assert.strictEqual(result, 'x = 42\n');
    });

    it('formats function call with multiple args', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('print(a,b,c)');
        assert.strictEqual(result, 'print(a, b, c)\n');
    });

    it('formats augmented assignment', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x+=1');
        assert.strictEqual(result, 'x += 1\n');
    });

    // ─────────────────────────────────────────────────────────────
    //  INDENTATION FIX (ERROR-TOLERANCE)
    // ─────────────────────────────────────────────────────────────

    it('fixes badly indented code', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            'for i in range(10):\n  print(i)\n   if i == 5:\n   break'
        );
        assert.strictEqual(
            result,
            'for i in range(10):\n    print(i)\n    if i == 5:\n        break\n'
        );
    });

    // ─────────────────────────────────────────────────────────────
    //  CONTROL FLOW
    // ─────────────────────────────────────────────────────────────

    it('formats if/elif/else', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            'if x>0:\n    y=1\nelif x<0:\n    y=-1\nelse:\n    y=0'
        );
        assert.strictEqual(
            result,
            'if x > 0:\n    y = 1\nelif x < 0:\n    y = -1\nelse:\n    y = 0\n'
        );
    });

    it('formats while loop', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('while x>0:\n    x-=1');
        assert.strictEqual(result, 'while x > 0:\n    x -= 1\n');
    });

    it('formats for loop with range', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            'for i in range(10):\n    print(i)'
        );
        assert.strictEqual(result, 'for i in range(10):\n    print(i)\n');
    });

    it('formats try/except/finally', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            'try:\n    x=1\nexcept ValueError:\n    x=0\nfinally:\n    print(x)'
        );
        assert.strictEqual(
            result,
            'try:\n    x = 1\nexcept ValueError:\n    x = 0\nfinally:\n    print(x)\n'
        );
    });

    // ─────────────────────────────────────────────────────────────
    //  CLASSES & FUNCTIONS
    // ─────────────────────────────────────────────────────────────

    it('formats a class definition', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            'class Foo:\n    def bar(self):\n        pass'
        );
        assert.strictEqual(
            result,
            'class Foo:\n    def bar(self):\n        pass\n'
        );
    });

    it('formats nested functions with PEP-8 blank lines', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            'def outer():\n    def inner():\n        pass\n    return inner'
        );
        assert.strictEqual(
            result,
            'def outer():\n    def inner():\n        pass\n\n    return inner\n'
        );
    });

    it('formats function with multiple arguments', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('result=func(a,b,c,d)');
        assert.strictEqual(result, 'result = func(a, b, c, d)\n');
    });

    // ─────────────────────────────────────────────────────────────
    //  IMPORTS
    // ─────────────────────────────────────────────────────────────

    it('formats import statement', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('import os');
        assert.strictEqual(result, 'import os\n');
    });

    it('formats from-import statement', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('from os import path');
        assert.strictEqual(result, 'from os import path\n');
    });

    // ─────────────────────────────────────────────────────────────
    //  EDGE CASES
    // ─────────────────────────────────────────────────────────────

    it('handles empty input', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('');
        assert.strictEqual(result, '\n');
    });

    it('handles whitespace-only input', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('   \n  \n');
        assert.strictEqual(result, '\n');
    });

    it('formats a single pass statement', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('pass');
        assert.strictEqual(result, 'pass\n');
    });

    // ─────────────────────────────────────────────────────────────
    //  ADVANCED: EXPRESSIONS & LITERALS
    // ─────────────────────────────────────────────────────────────

    it('formats a list literal', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = [1,2,3]');
        assert.strictEqual(result, 'x = [1, 2, 3]\n');
    });

    it('formats a dictionary literal', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode("x = {'a':1,'b':2}");
        assert.strictEqual(result, "x = {'a': 1, 'b': 2}\n");
    });

    it('formats a tuple', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = (1,2,3)');
        assert.strictEqual(result, 'x = (1, 2, 3)\n');
    });

    it('formats chained method calls', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode("x = foo.bar.baz()");
        assert.strictEqual(result, 'x = foo.bar.baz()\n');
    });

    it('formats subscript access', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = arr[0]');
        assert.strictEqual(result, 'x = arr[0]\n');
    });

    it('formats boolean operators', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('if a and b or c:\n    pass');
        assert.strictEqual(result, 'if a and b or c:\n    pass\n');
    });

    it('formats return with expression', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            'def f():\n    return x+1'
        );
        assert.strictEqual(result, 'def f():\n    return x + 1\n');
    });

    // ─────────────────────────────────────────────────────────────
    //  ADVANCED: MULTI-STATEMENT PROGRAMS
    // ─────────────────────────────────────────────────────────────

    it('formats a complete multi-statement program', async function () {
        this.timeout(30000);
        const input = [
            'import os',
            'x=1',
            'def foo():',
            '    return x+1',
        ].join('\n');
        const expected = [
            'import os',
            'x = 1',
            '',
            '',
            'def foo():',
            '    return x + 1',
            '',
        ].join('\n');
        const result = await formatViaVSCode(input);
        assert.strictEqual(result, expected);
    });

    it('formats two top-level functions with blank lines', async function () {
        this.timeout(30000);
        const input = [
            'def foo():',
            '    pass',
            'def bar():',
            '    pass',
        ].join('\n');
        const expected = [
            'def foo():',
            '    pass',
            '',
            '',
            'def bar():',
            '    pass',
            '',
        ].join('\n');
        const result = await formatViaVSCode(input);
        assert.strictEqual(result, expected);
    });

    it('formats with statement', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            "with open('file') as f:\n    data=f.read()"
        );
        assert.strictEqual(
            result,
            "with open('file') as f:\n    data = f.read()\n"
        );
    });

    // ─────────────────────────────────────────────────────────────
    //  COMMENTS
    // ─────────────────────────────────────────────────────────────

    it('preserves comments', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('# this is a comment\nx=1');
        assert.strictEqual(result, '# this is a comment\nx = 1\n');
    });

    // ─────────────────────────────────────────────────────────────
    //  STRINGS
    // ─────────────────────────────────────────────────────────────

    it('preserves string content', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode("x = 'hello world'");
        assert.strictEqual(result, "x = 'hello world'\n");
    });

    it('preserves multi-word string in function call', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode("print('hello','world')");
        assert.strictEqual(result, "print('hello', 'world')\n");
    });
});
