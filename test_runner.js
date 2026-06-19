/**
 * Standalone test runner for the Python formatter.
 *
 * Mirrors every test case from the E2E suite (test/suite/formatter.test.ts)
 * but calls Formatter.format() directly — no VS Code, no file I/O.
 *
 * Run: `node test_runner.js` (after `npx tsc -p . --outDir out`)
 */
const assert = require('assert');

async function runTests() {
  let Formatter, ParserService;
  try {
    Formatter = require('./out/src/formatter/Formatter').Formatter;
    ParserService = require('./out/src/parser/ParserService').ParserService;
  } catch (e) {
    console.error('Cannot load compiled output. Run "npx tsc -p . --outDir out" first.');
    console.error(e.message);
    process.exit(1);
  }

  console.log('Initializing parser (Node %s)...\n', process.version);
  await ParserService.init();

  const testCases = [
    //
    // ─── BASIC FORMATTING ───────────────────────────────────────
    //
    {
      name: 'formats a basic function definition',
      input: 'def foo(a,b):\n    print(a)\n    return b',
      expected: 'def foo(a, b):\n    print(a)\n    return b\n'
    },
    {
      name: 'formats binary operators with PEP-8 spacing',
      input: 'x=1+2*3',
      expected: 'x = 1 + 2 * 3\n'
    },
    {
      name: 'formats comparison operators',
      input: 'if x>5:\n    pass',
      expected: 'if x > 5:\n    pass\n'
    },
    {
      name: 'formats assignment with extra whitespace',
      input: 'x   =   42',
      expected: 'x = 42\n'
    },
    {
      name: 'formats function call with multiple args',
      input: 'print(a,b,c)',
      expected: 'print(a, b, c)\n'
    },
    {
      name: 'formats augmented assignment',
      input: 'x+=1',
      expected: 'x += 1\n'
    },
    //
    // ─── INDENTATION FIX (ERROR-TOLERANCE) ──────────────────────
    //
    {
      name: 'fixes badly indented code',
      input: 'for i in range(10):\n  print(i)\n   if i == 5:\n   break',
      expected: 'for i in range(10):\n    print(i)\n    if i == 5:\n        break\n'
    },
    //
    // ─── CONTROL FLOW ───────────────────────────────────────────
    //
    {
      name: 'formats if/elif/else',
      input: 'if x>0:\n    y=1\nelif x<0:\n    y=-1\nelse:\n    y=0',
      expected: 'if x > 0:\n    y = 1\nelif x < 0:\n    y = -1\nelse:\n    y = 0\n'
    },
    {
      name: 'formats while loop',
      input: 'while x>0:\n    x-=1',
      expected: 'while x > 0:\n    x -= 1\n'
    },
    {
      name: 'formats for loop with range',
      input: 'for i in range(10):\n    print(i)',
      expected: 'for i in range(10):\n    print(i)\n'
    },
    {
      name: 'formats try/except/finally',
      input: 'try:\n    x=1\nexcept ValueError:\n    x=0\nfinally:\n    print(x)',
      expected: 'try:\n    x = 1\nexcept ValueError:\n    x = 0\nfinally:\n    print(x)\n'
    },
    //
    // ─── CLASSES & FUNCTIONS ────────────────────────────────────
    //
    {
      name: 'formats a class definition',
      input: 'class Foo:\n    def bar(self):\n        pass',
      expected: 'class Foo:\n    def bar(self):\n        pass\n'
    },
    {
      name: 'formats nested functions with PEP-8 blank lines',
      input: 'def outer():\n    def inner():\n        pass\n    return inner',
      expected: 'def outer():\n    def inner():\n        pass\n\n    return inner\n'
    },
    {
      name: 'formats function with multiple arguments',
      input: 'result=func(a,b,c,d)',
      expected: 'result = func(a, b, c, d)\n'
    },
    //
    // ─── IMPORTS ────────────────────────────────────────────────
    //
    {
      name: 'formats import statement',
      input: 'import os',
      expected: 'import os\n'
    },
    {
      name: 'formats from-import statement',
      input: 'from os import path',
      expected: 'from os import path\n'
    },
    //
    // ─── EDGE CASES ─────────────────────────────────────────────
    //
    {
      name: 'handles empty input',
      input: '',
      expected: '\n'
    },
    {
      name: 'handles whitespace-only input',
      input: '   \n  \n',
      expected: '\n'
    },
    {
      name: 'formats a single pass statement',
      input: 'pass',
      expected: 'pass\n'
    },
    //
    // ─── EXPRESSIONS & LITERALS ─────────────────────────────────
    //
    {
      name: 'formats a list literal',
      input: 'x = [1,2,3]',
      expected: 'x = [1, 2, 3]\n'
    },
    {
      name: 'formats a dictionary literal',
      input: "x = {'a':1,'b':2}",
      expected: "x = {'a': 1, 'b': 2}\n"
    },
    {
      name: 'formats a tuple',
      input: 'x = (1,2,3)',
      expected: 'x = (1, 2, 3)\n'
    },
    {
      name: 'formats chained method calls',
      input: 'x = foo.bar.baz()',
      expected: 'x = foo.bar.baz()\n'
    },
    {
      name: 'formats subscript access',
      input: 'x = arr[0]',
      expected: 'x = arr[0]\n'
    },
    {
      name: 'formats boolean operators',
      input: 'if a and b or c:\n    pass',
      expected: 'if a and b or c:\n    pass\n'
    },
    {
      name: 'formats return with expression',
      input: 'def f():\n    return x+1',
      expected: 'def f():\n    return x + 1\n'
    },
    //
    // ─── MULTI-STATEMENT PROGRAMS ───────────────────────────────
    //
    {
      name: 'formats a complete multi-statement program',
      input: 'import os\nx=1\ndef foo():\n    return x+1',
      expected: 'import os\nx = 1\n\n\ndef foo():\n    return x + 1\n'
    },
    {
      name: 'formats two top-level functions with blank lines',
      input: 'def foo():\n    pass\ndef bar():\n    pass',
      expected: 'def foo():\n    pass\n\n\ndef bar():\n    pass\n'
    },
    {
      name: 'formats with statement',
      input: "with open('file') as f:\n    data=f.read()",
      expected: "with open('file') as f:\n    data = f.read()\n"
    },
    //
    // ─── COMMENTS ───────────────────────────────────────────────
    //
    {
      name: 'preserves comments',
      input: '# this is a comment\nx=1',
      expected: '# this is a comment\nx = 1\n'
    },
    //
    // ─── STRINGS ────────────────────────────────────────────────
    //
    {
      name: 'preserves string content',
      input: "x = 'hello world'",
      expected: "x = 'hello world'\n"
    },
    {
      name: 'preserves multi-word string in function call',
      input: "print('hello','world')",
      expected: "print('hello', 'world')\n"
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    try {
      const actual = Formatter.format(tc.input);
      assert.strictEqual(actual, tc.expected);
      console.log(`  ✅ ${tc.name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${tc.name}`);
      console.error(`     Expected: ${JSON.stringify(tc.expected)}`);
      console.error(`     Actual:   ${JSON.stringify(Formatter.format(tc.input))}`);
      failed++;
    }
  }

  console.log(`\n  ${passed} passed, ${failed} failed\n`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
