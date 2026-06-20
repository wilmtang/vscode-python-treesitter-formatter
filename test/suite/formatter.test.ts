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

    // ─────────────────────────────────────────────────────────────
    //  REALISTIC PYTHON THE ORIGINAL SUITE AVOIDED
    //
    //  The cases above only exercise the handful of constructs the
    //  formatter happens to get right. The cases below cover everyday
    //  Python — comprehensions, lambdas, type annotations, inline
    //  comments, semicolons, blank-line and line-length handling.
    //
    //  Each `expected` value encodes the CORRECT PEP-8 output (verified
    //  to be valid Python). Several of these currently FAIL — that is
    //  intentional: they pin down the defects found in the audit so they
    //  can be fixed, rather than codifying the corrupted output as
    //  "expected". A few (e.g. collapsing a short multi-line call) pass
    //  today and guard against regressions.
    // ─────────────────────────────────────────────────────────────

    it('keeps inline (trailing) comments on the same line', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = 1  # set x to one\ny = 2  # and y');
        assert.strictEqual(result, 'x = 1  # set x to one\ny = 2  # and y\n');
    });

    it('formats a list comprehension without corrupting it', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('y = [a for a in items]');
        assert.strictEqual(result, 'y = [a for a in items]\n');
    });

    it('formats a dict comprehension without corrupting it', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = {k: v for k, v in items}');
        assert.strictEqual(result, 'x = {k: v for k, v in items}\n');
    });

    it('formats a generator expression in a call without corrupting it', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('total = sum(x for x in nums)');
        assert.strictEqual(result, 'total = sum(x for x in nums)\n');
    });

    it('preserves the lambda keyword', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('f = lambda x: x + 1');
        assert.strictEqual(result, 'f = lambda x: x + 1\n');
    });

    it('splits semicolon-separated statements onto their own lines', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = 1; y = 2; z = 3');
        assert.strictEqual(result, 'x = 1\ny = 2\nz = 3\n');
    });

    it('formats a variable annotation (space after colon, spaces around =)', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('count: int = 0');
        assert.strictEqual(result, 'count: int = 0\n');
    });

    it('formats annotated parameters and annotated defaults', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            'def f(x:int, y:str="a") -> bool:\n    return True'
        );
        assert.strictEqual(
            result,
            'def f(x: int, y: str = "a") -> bool:\n    return True\n'
        );
    });

    it('spaces commas in a bare (unparenthesized) tuple', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('a, b = b, a');
        assert.strictEqual(result, 'a, b = b, a\n');
    });

    it('does not leave a stray space at a trailing comma', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = [1, 2, 3,]');
        assert.strictEqual(result, 'x = [1, 2, 3]\n');
    });

    it('collapses multiple blank lines inside a function body to one', async function () {
        this.timeout(30000);
        const input = [
            'def f():',
            '    x = 1',
            '',
            '',
            '    y = 2',
            '    return x + y',
        ].join('\n');
        const expected = [
            'def f():',
            '    x = 1',
            '',
            '    y = 2',
            '    return x + y',
            '',
        ].join('\n');
        const result = await formatViaVSCode(input);
        assert.strictEqual(result, expected);
    });

    it('collapses a short multi-line call that fits on one line', async function () {
        this.timeout(30000);
        const input = [
            'foo(',
            '    a,',
            '    b,',
            '    c',
            ')',
        ].join('\n');
        const result = await formatViaVSCode(input);
        assert.strictEqual(result, 'foo(a, b, c)\n');
    });

    it('keeps every line within the PEP-8 max line length (79 cols)', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            'result = some_function(argument_one, argument_two, argument_three, argument_four, argument_five)'
        );
        const tooLong = result.split('\n').filter(line => line.length > 79);
        assert.deepStrictEqual(
            tooLong,
            [],
            `Expected no lines longer than 79 chars, but found: ${JSON.stringify(tooLong)}`
        );
    });

    it('formats a realistic class with a comprehension and inline comment', async function () {
        this.timeout(30000);
        const input = [
            'class Config:',
            '    def load(self,items):',
            '        result={k:v for k,v in items}  # build map',
            '        return result',
        ].join('\n');
        const expected = [
            'class Config:',
            '    def load(self, items):',
            '        result = {k: v for k, v in items}  # build map',
            '        return result',
            '',
        ].join('\n');
        const result = await formatViaVSCode(input);
        assert.strictEqual(result, expected);
    });

    // ─────────────────────────────────────────────────────────────
    //  REINDENTATION (structural repair)
    //
    //  Whenever tree-sitter recovers a clean tree, indentation is rebuilt
    //  purely from structural depth, so any input indentation normalizes to
    //  the editor's indent size.
    // ─────────────────────────────────────────────────────────────

    it('reindents tab-indented code to spaces', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('def f():\n\treturn 1');
        assert.strictEqual(result, 'def f():\n    return 1\n');
    });

    it('reindents over-indented code (8 spaces -> 4)', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('def f():\n        return 1');
        assert.strictEqual(result, 'def f():\n    return 1\n');
    });

    it('reindents under-indented code (2 spaces -> 4)', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('if x:\n  pass');
        assert.strictEqual(result, 'if x:\n    pass\n');
    });

    it('reindents mixed tabs and spaces', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('def f():\n\tif x:\n\t\treturn 1');
        assert.strictEqual(result, 'def f():\n    if x:\n        return 1\n');
    });

    it('reindents a tab-indented class body', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('class C:\n\tx = 1\n\ty = 2');
        assert.strictEqual(result, 'class C:\n    x = 1\n    y = 2\n');
    });

    // ─────────────────────────────────────────────────────────────
    //  SYNTAX REPAIR (missing colon, verify-or-revert)
    //
    //  Goes beyond Black/autopep8: these inputs do NOT parse, but a missing
    //  colon after a compound header is unambiguous and verifiable, so we
    //  repair it before formatting. Unrepairable breakage is left untouched.
    // ─────────────────────────────────────────────────────────────

    it('repairs a missing colon after def', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('def f()\n    return 1');
        assert.strictEqual(result, 'def f():\n    return 1\n');
    });

    it('repairs a missing colon after if', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('if x > 0\n    pass');
        assert.strictEqual(result, 'if x > 0:\n    pass\n');
    });

    it('repairs a missing colon after for', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('for i in range(3)\n    print(i)');
        assert.strictEqual(result, 'for i in range(3):\n    print(i)\n');
    });

    it('repairs a missing colon after class', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('class C\n    pass');
        assert.strictEqual(result, 'class C:\n    pass\n');
    });

    it('repairs one bad header amid otherwise good code', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = 1\ndef f()\n    return x\ny = 2');
        assert.strictEqual(result, 'x = 1\n\n\ndef f():\n    return x\n\n\ny = 2\n');
    });

    it('leaves genuinely unrepairable code untouched (no corruption)', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = foo(1, 2');
        assert.strictEqual(result, 'x = foo(1, 2\n');
    });

    // ─────────────────────────────────────────────────────────────
    //  LINE WRAPPING (max line length — extension default is 88)
    // ─────────────────────────────────────────────────────────────

    it('wraps a call that exceeds the max line length', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            'result = some_function(argument_one, argument_two, argument_three, argument_four, argument_five)'
        );
        assert.strictEqual(
            result,
            'result = some_function(\n    argument_one,\n    argument_two,\n    argument_three,\n    argument_four,\n    argument_five\n)\n'
        );
    });

    it('wraps a long parameter list', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode(
            'def process(first_argument, second_argument, third_argument, fourth_argument, fifth_arg):\n    pass'
        );
        assert.strictEqual(
            result,
            'def process(\n    first_argument,\n    second_argument,\n    third_argument,\n    fourth_argument,\n    fifth_arg\n):\n    pass\n'
        );
    });

    it('keeps a short call flat', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('result = f(a, b, c)');
        assert.strictEqual(result, 'result = f(a, b, c)\n');
    });

    // ─────────────────────────────────────────────────────────────
    //  REDUNDANT PARENTHESES (dropped in neutral positions)
    // ─────────────────────────────────────────────────────────────

    it('removes redundant parens after return', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('return (value)');
        assert.strictEqual(result, 'return value\n');
    });

    it('removes redundant parens on an assignment RHS', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = (a + b)');
        assert.strictEqual(result, 'x = a + b\n');
    });

    it('removes redundant parens in an if condition', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('if (x):\n    pass');
        assert.strictEqual(result, 'if x:\n    pass\n');
    });

    it('collapses doubled parens', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('((x))');
        assert.strictEqual(result, 'x\n');
    });

    it('keeps parens that carry precedence', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('r = (a + b) * c');
        assert.strictEqual(result, 'r = (a + b) * c\n');
    });

    it('keeps parens around a walrus assignment', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = (y := 1)');
        assert.strictEqual(result, 'x = (y := 1)\n');
    });

    it('keeps parens after a unary operator', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('r = -(a + b)');
        assert.strictEqual(result, 'r = -(a + b)\n');
    });

    // ─────────────────────────────────────────────────────────────
    //  SLICE SPACING (complex operands)
    // ─────────────────────────────────────────────────────────────

    it('spaces slice colons for complex operands', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('v = ham[lower + offset:upper + offset]');
        assert.strictEqual(result, 'v = ham[lower + offset : upper + offset]\n');
    });

    it('keeps a simple slice tight', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('v = ham[1:9]');
        assert.strictEqual(result, 'v = ham[1:9]\n');
    });

    it('keeps a step-only slice tight', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('v = ham[::2]');
        assert.strictEqual(result, 'v = ham[::2]\n');
    });

    it('omits the space on an absent slice bound', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('v = ham[a + 1:]');
        assert.strictEqual(result, 'v = ham[a + 1 :]\n');
    });

    // ─────────────────────────────────────────────────────────────
    //  NUMERIC LITERAL NORMALIZATION
    // ─────────────────────────────────────────────────────────────

    it('lowercases hex prefix and uppercases hex digits', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = 0Xff');
        assert.strictEqual(result, 'x = 0xFF\n');
    });

    it('lowercases the exponent marker', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = 1E3');
        assert.strictEqual(result, 'x = 1e3\n');
    });

    it('lowercases the imaginary suffix', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = 3J');
        assert.strictEqual(result, 'x = 3j\n');
    });

    it('normalizes hex with underscores', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('x = 0xab_cd');
        assert.strictEqual(result, 'x = 0xAB_CD\n');
    });

    // ─────────────────────────────────────────────────────────────
    //  STRING PREFIX NORMALIZATION
    // ─────────────────────────────────────────────────────────────

    it('lowercases an f-string prefix', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('s = F"hi"');
        assert.strictEqual(result, 's = f"hi"\n');
    });

    it('lowercases a raw-bytes prefix', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('s = RB"raw"');
        assert.strictEqual(result, 's = rb"raw"\n');
    });

    it('lowercases the prefix but preserves f-string interpolations', async function () {
        this.timeout(30000);
        const result = await formatViaVSCode('s = F"a {x + 1} b"');
        assert.strictEqual(result, 's = f"a {x + 1} b"\n');
    });
});
