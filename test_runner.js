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
    //
    // ─── REALISTIC PYTHON (mirrors the E2E suite) ───────────────
    //
    {
      name: 'keeps inline (trailing) comments on the same line',
      input: 'x = 1  # set x to one\ny = 2  # and y',
      expected: 'x = 1  # set x to one\ny = 2  # and y\n'
    },
    {
      name: 'formats a list comprehension without corrupting it',
      input: 'y = [a for a in items]',
      expected: 'y = [a for a in items]\n'
    },
    {
      name: 'formats a dict comprehension without corrupting it',
      input: 'x = {k: v for k, v in items}',
      expected: 'x = {k: v for k, v in items}\n'
    },
    {
      name: 'formats a generator expression in a call',
      input: 'total = sum(x for x in nums)',
      expected: 'total = sum(x for x in nums)\n'
    },
    {
      name: 'preserves the lambda keyword',
      input: 'f = lambda x: x + 1',
      expected: 'f = lambda x: x + 1\n'
    },
    {
      name: 'splits semicolon-separated statements',
      input: 'x = 1; y = 2; z = 3',
      expected: 'x = 1\ny = 2\nz = 3\n'
    },
    {
      name: 'formats a variable annotation',
      input: 'count: int = 0',
      expected: 'count: int = 0\n'
    },
    {
      name: 'formats annotated parameters and defaults',
      input: 'def f(x:int, y:str="a") -> bool:\n    return True',
      expected: 'def f(x: int, y: str = "a") -> bool:\n    return True\n'
    },
    {
      name: 'spaces commas in a bare tuple',
      input: 'a, b = b, a',
      expected: 'a, b = b, a\n'
    },
    {
      name: 'drops a redundant trailing comma',
      input: 'x = [1, 2, 3,]',
      expected: 'x = [1, 2, 3]\n'
    },
    {
      name: 'collapses multiple blank lines in a body to one',
      input: 'def f():\n    x = 1\n\n\n    y = 2\n    return x + y',
      expected: 'def f():\n    x = 1\n\n    y = 2\n    return x + y\n'
    },
    {
      name: 'collapses a short multi-line call',
      input: 'foo(\n    a,\n    b,\n    c\n)',
      expected: 'foo(a, b, c)\n'
    },
    {
      name: 'formats a realistic class with comprehension + comment',
      input: 'class Config:\n    def load(self,items):\n        result={k:v for k,v in items}  # build map\n        return result',
      expected: 'class Config:\n    def load(self, items):\n        result = {k: v for k, v in items}  # build map\n        return result\n'
    },
    //
    // ─── REINDENTATION (structural repair) ──────────────────────
    //
    {
      name: 'reindents tab-indented code to spaces',
      input: 'def f():\n\treturn 1',
      expected: 'def f():\n    return 1\n'
    },
    {
      name: 'reindents over-indented code (8 spaces -> 4)',
      input: 'def f():\n        return 1',
      expected: 'def f():\n    return 1\n'
    },
    {
      name: 'reindents under-indented code (2 spaces -> 4)',
      input: 'if x:\n  pass',
      expected: 'if x:\n    pass\n'
    },
    {
      name: 'reindents mixed tabs and spaces',
      input: 'def f():\n\tif x:\n\t\treturn 1',
      expected: 'def f():\n    if x:\n        return 1\n'
    },
    {
      name: 'reindents a tab-indented class body',
      input: 'class C:\n\tx = 1\n\ty = 2',
      expected: 'class C:\n    x = 1\n    y = 2\n'
    },
    {
      name: 'respects a custom indent size (2 spaces)',
      input: 'def f():\n    if x:\n        return 1',
      indentSize: 2,
      expected: 'def f():\n  if x:\n    return 1\n'
    },
    //
    // ─── SYNTAX REPAIR (missing colon, verify-or-revert) ────────
    //
    {
      name: 'repairs a missing colon after def',
      input: 'def f()\n    return 1',
      expected: 'def f():\n    return 1\n'
    },
    {
      name: 'repairs a missing colon after if',
      input: 'if x > 0\n    pass',
      expected: 'if x > 0:\n    pass\n'
    },
    {
      name: 'repairs a missing colon after for',
      input: 'for i in range(3)\n    print(i)',
      expected: 'for i in range(3):\n    print(i)\n'
    },
    {
      name: 'repairs a missing colon after while',
      input: 'while x\n    x -= 1',
      expected: 'while x:\n    x -= 1\n'
    },
    {
      name: 'repairs a missing colon after class',
      input: 'class C\n    pass',
      expected: 'class C:\n    pass\n'
    },
    {
      name: 'repairs a missing colon after else',
      input: 'if x:\n    a = 1\nelse\n    a = 2',
      expected: 'if x:\n    a = 1\nelse:\n    a = 2\n'
    },
    {
      name: 'repairs a missing colon after async def',
      input: 'async def f()\n    return 1',
      expected: 'async def f():\n    return 1\n'
    },
    {
      name: 'repairs one bad header amid otherwise good code',
      input: 'x = 1\ndef f()\n    return x\ny = 2',
      expected: 'x = 1\n\n\ndef f():\n    return x\n\n\ny = 2\n'
    },
    {
      name: 'does not invent a colon on a non-header line',
      input: 'match = re.search(p, s)',
      expected: 'match = re.search(p, s)\n'
    },
    {
      name: 'leaves missing colon alone when repair is disabled',
      input: 'def f()\n    return 1',
      repairSyntax: false,
      expected: 'def f()\n    return 1\n'
    },
    //
    // ─── LINE WRAPPING (max line length) ────────────────────────
    //
    {
      name: 'does not wrap by default (no max line length)',
      input: 'result = some_function(argument_one, argument_two, argument_three, argument_four, argument_five)',
      expected: 'result = some_function(argument_one, argument_two, argument_three, argument_four, argument_five)\n'
    },
    {
      name: 'wraps a call that exceeds the max line length',
      input: 'result = some_function(argument_one, argument_two, argument_three, argument_four, argument_five)',
      maxLineLength: 88,
      expected: 'result = some_function(\n    argument_one,\n    argument_two,\n    argument_three,\n    argument_four,\n    argument_five\n)\n'
    },
    {
      name: 'keeps a short call flat under the max line length',
      input: 'result = f(a, b, c)',
      maxLineLength: 88,
      expected: 'result = f(a, b, c)\n'
    },
    {
      name: 'wraps a long parameter list (accounts for trailing colon)',
      input: 'def process(first_argument, second_argument, third_argument, fourth_argument, fifth_arg):\n    pass',
      maxLineLength: 88,
      expected: 'def process(\n    first_argument,\n    second_argument,\n    third_argument,\n    fourth_argument,\n    fifth_arg\n):\n    pass\n'
    },
    {
      name: 'explodes the outer call but keeps fitting inner calls flat',
      input: 'result = outer_function(inner_function(a, b), another_inner(c, d), yet_more(e, f), final(g))',
      maxLineLength: 88,
      expected: 'result = outer_function(\n    inner_function(a, b),\n    another_inner(c, d),\n    yet_more(e, f),\n    final(g)\n)\n'
    },
    {
      name: 'wraps kwargs/splat without a trailing comma after **kwargs',
      input: 'configure(name=value, other=thing, *more_args, debug=True, verbose=False, **all_the_kwargs)',
      maxLineLength: 88,
      expected: 'configure(\n    name=value,\n    other=thing,\n    *more_args,\n    debug=True,\n    verbose=False,\n    **all_the_kwargs\n)\n'
    },
    //
    // ─── REDUNDANT PARENTHESES (dropped in neutral positions) ───
    //
    {
      name: 'removes redundant parens after return',
      input: 'return (value)',
      expected: 'return value\n'
    },
    {
      name: 'removes redundant parens on an assignment RHS',
      input: 'x = (a + b)',
      expected: 'x = a + b\n'
    },
    {
      name: 'removes redundant parens in an if condition',
      input: 'if (x):\n    pass',
      expected: 'if x:\n    pass\n'
    },
    {
      name: 'removes redundant parens around a bare expression',
      input: '(x)',
      expected: 'x\n'
    },
    {
      name: 'collapses doubled parens',
      input: '((x))',
      expected: 'x\n'
    },
    {
      name: 'keeps parens that carry precedence',
      input: 'r = (a + b) * c',
      expected: 'r = (a + b) * c\n'
    },
    {
      name: 'keeps parens around a walrus assignment',
      input: 'x = (y := 1)',
      expected: 'x = (y := 1)\n'
    },
    {
      name: 'keeps parens after a unary operator',
      input: 'r = -(a + b)',
      expected: 'r = -(a + b)\n'
    },
    //
    // ─── SLICE SPACING (complex operands) ───────────────────────
    //
    {
      name: 'spaces slice colons for complex operands',
      input: 'v = ham[lower + offset:upper + offset]',
      expected: 'v = ham[lower + offset : upper + offset]\n'
    },
    {
      name: 'keeps a simple slice tight',
      input: 'v = ham[1:9]',
      expected: 'v = ham[1:9]\n'
    },
    {
      name: 'keeps a step-only slice tight',
      input: 'v = ham[::2]',
      expected: 'v = ham[::2]\n'
    },
    {
      name: 'keeps a negative-index slice tight',
      input: 'v = ham[-1:]',
      expected: 'v = ham[-1:]\n'
    },
    {
      name: 'omits the space on an absent slice bound',
      input: 'v = ham[a + 1:]',
      expected: 'v = ham[a + 1 :]\n'
    },
    //
    // ─── NUMERIC LITERAL NORMALIZATION ──────────────────────────
    //
    {
      name: 'lowercases hex prefix and uppercases hex digits',
      input: 'x = 0Xff',
      expected: 'x = 0xFF\n'
    },
    {
      name: 'lowercases the exponent marker',
      input: 'x = 1E3',
      expected: 'x = 1e3\n'
    },
    {
      name: 'lowercases the imaginary suffix',
      input: 'x = 3J',
      expected: 'x = 3j\n'
    },
    {
      name: 'normalizes hex with underscores',
      input: 'x = 0xab_cd',
      expected: 'x = 0xAB_CD\n'
    },
    {
      name: 'keeps binary and octal prefixes lowercased',
      input: 'x = 0B101\ny = 0O17',
      expected: 'x = 0b101\ny = 0o17\n'
    },
    //
    // ─── STRING PREFIX NORMALIZATION ────────────────────────────
    //
    {
      name: 'lowercases an f-string prefix',
      input: 's = F"hi"',
      expected: 's = f"hi"\n'
    },
    {
      name: 'lowercases a bytes prefix',
      input: 's = B"x"',
      expected: 's = b"x"\n'
    },
    {
      name: 'lowercases a raw-bytes prefix',
      input: 's = RB"raw"',
      expected: 's = rb"raw"\n'
    },
    {
      name: 'lowercases the prefix but preserves f-string interpolations',
      input: 's = F"a {x + 1} b"',
      expected: 's = f"a {x + 1} b"\n'
    },
  ];

  let passed = 0;
  let failed = 0;

  for (const tc of testCases) {
    try {
      const actual = Formatter.format(tc.input, tc.indentSize, tc.repairSyntax, tc.maxLineLength);
      assert.strictEqual(actual, tc.expected);
      console.log(`  ✅ ${tc.name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${tc.name}`);
      console.error(`     Expected: ${JSON.stringify(tc.expected)}`);
      console.error(`     Actual:   ${JSON.stringify(Formatter.format(tc.input, tc.indentSize, tc.repairSyntax, tc.maxLineLength))}`);
      failed++;
    }
  }

  //
  // ─── PROPERTY TESTS (M0 safety invariants) ──────────────────
  //
  // Unlike the cases above, these don't assert an exact output. They assert
  // invariants that must hold for EVERY input — this is how we guarantee the
  // formatter never corrupts code, regardless of which constructs it supports.
  //
  console.log('\n  Property tests (safety invariants):');

  const errorCount = (code) => {
    const t = ParserService.parse(code);
    let c = 0;
    const isMissing = (n) => (typeof n.isMissing === 'function' ? n.isMissing() : !!n.isMissing);
    const walk = (n) => {
      if (n.type === 'ERROR' || isMissing(n)) c++;
      for (let i = 0; i < n.childCount; i++) walk(n.child(i));
    };
    walk(t.rootNode);
    return c;
  };

  const propertyCorpus = [
    'f = lambda x: x + 1',
    'y = [a for a in items]',
    'x = {k: v for k, v in items}',
    'total = sum(x for x in nums)',
    'z = {a for a in s}',
    'g = (i * i for i in range(10))',
    'x = 1; y = 2; z = 3',
    'a, b = b, a',
    'count: int = 0',
    'def f(x: int, y: str = "a") -> bool:\n    return True',
    'result = [x for x in data if x > 0]',
    'nested = [[y for y in row] for row in grid]',
    'd = {**a, **b}',
    'print(*args, **kwargs)',
    'x = a if cond else b',
    'with open("f") as fh, open("g") as gh:\n    pass',
    'async def f():\n    await g()',
    'x: List[int] = []',
    'def f():\n    """doc"""\n    return [i for i in range(3)]',
    'class C:\n    x = {k: v for k, v in pairs}',
    'import os',
    'from a.b.c import d',
    '@decorator\ndef f():\n    pass',
    'while True:\n    break',
    'try:\n    x = 1\nexcept (A, B) as e:\n    raise',
    'return (a + b)',
    'v = arr[i + 1:j - 1]',
    'x = 0XFF',
    's = F"hello {name}"',
    'x = (y := 10)',
    'data = obj.attr[start:stop:step]',
  ];

  // Property 1: formatting valid code never introduces parse errors (no corruption).
  const corrupted = propertyCorpus.filter(
    (src) => errorCount(Formatter.format(src)) > errorCount(src)
  );
  if (corrupted.length === 0) {
    console.log(`  ✅ never corrupts valid code (${propertyCorpus.length} snippets)`);
    passed++;
  } else {
    console.error(`  ❌ corrupted ${corrupted.length} snippet(s):`);
    corrupted.forEach((s) =>
      console.error(`     ${JSON.stringify(s)} -> ${JSON.stringify(Formatter.format(s))}`)
    );
    failed++;
  }

  // Property 2: idempotency — format(format(x)) === format(x).
  const nonIdempotent = propertyCorpus.filter((src) => {
    const once = Formatter.format(src);
    return Formatter.format(once) !== once;
  });
  if (nonIdempotent.length === 0) {
    console.log(`  ✅ idempotent (${propertyCorpus.length} snippets)`);
    passed++;
  } else {
    console.error(`  ❌ ${nonIdempotent.length} snippet(s) not idempotent:`);
    nonIdempotent.forEach((s) => console.error(`     ${JSON.stringify(s)}`));
    failed++;
  }

  // Property 3: repairing/formatting broken code never makes it parse worse.
  const brokenCorpus = [
    'def f()\n    return 1',
    'if x > 0\n    pass',
    'for i in range(3)\n    print(i)',
    'while x\n    x -= 1',
    'class C\n    pass',
    'if x:\n    a = 1\nelse\n    a = 2',
    'x = foo(1, 2',          // unclosed paren — unrepairable, must not worsen
    'def bad(\nx = 2',       // dangling — unrepairable
    'x = [1, 2,',            // unclosed bracket
    'try\n    pass\nexcept\n    pass',
  ];
  const worsened = brokenCorpus.filter((src) => errorCount(Formatter.format(src)) > errorCount(src));
  if (worsened.length === 0) {
    console.log(`  ✅ never worsens broken code (${brokenCorpus.length} snippets)`);
    passed++;
  } else {
    console.error(`  ❌ worsened ${worsened.length} snippet(s):`);
    worsened.forEach((s) =>
      console.error(`     ${JSON.stringify(s)} -> ${JSON.stringify(Formatter.format(s))}`)
    );
    failed++;
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
