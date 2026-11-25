'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const copiedFiles = ['usage.js', 'usageCounters.js', 'test-counter-invariants.cjs'];

function withIsolatedCopy(run) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'counter-test-sensitivity-'));
  try {
    for (const filename of copiedFiles) fs.copyFileSync(path.join(__dirname, filename), path.join(directory, filename));
    return run(directory);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function execute(directory, args) {
  const environment = { ...process.env };
  // The child is an independent test runner, not a nested node:test worker.
  delete environment.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, args, {
    cwd: directory, env: environment, encoding: 'utf8', timeout: 10_000, maxBuffer: 2 * 1024 * 1024,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, 'The test process must finish normally');
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

test('an unchanged isolated copy passes the invariant suite', () => {
  withIsolatedCopy((directory) => {
    const result = execute(directory, ['--test', '--test-reporter=tap', 'test-counter-invariants.cjs']);
    assert.equal(result.status, 0, result.output);
    assert.match(result.output, /# pass 5\b/);
    assert.match(result.output, /# fail 0\b/);
  });
});

const mutations = [
  {
    label: 'turning a failed authority read into an empty baseline',
    filename: 'usage.js',
    before: 'const authority = await counters.read();',
    after: 'const authority = await counters.read().catch(() => undefined);',
    testName: 'interrupted syncs retry exactly once at every read and persistence boundary',
    diagnostic: /Missing expected rejection: counter-read #1/,
  },
  {
    label: 'adding an absolute contribution again',
    filename: 'usage.js',
    before: 'contributionTotals[site] = Math.max(',
    after: 'contributionTotals[site] = (contributionTotals[site] || 0) + Math.max(',
    testName: 'seeded duplicate and reordered deliveries preserve exact totals across installations, sites, and days',
    diagnostic: /seed=c0ffee, delivery=\d+/,
  },
  {
    label: 'replacing native maximum with increment',
    filename: 'usageCounters.js',
    before: 'maximum: { integerValue: String(seconds) }',
    after: 'increment: { integerValue: String(seconds) }',
    testName: 'seeded duplicate and reordered deliveries preserve exact totals across installations, sites, and days',
    diagnostic: /Counter writes must use native maximum/,
  },
];

for (const mutation of mutations) {
  test(`the suite detects ${mutation.label}`, () => {
    withIsolatedCopy((directory) => {
      const filename = path.join(directory, mutation.filename);
      const source = fs.readFileSync(filename, 'utf8');
      assert.equal(source.split(mutation.before).length - 1, 1, 'The targeted production operation must be unambiguous');
      fs.writeFileSync(filename, source.replace(mutation.before, mutation.after));
      assert.equal(execute(directory, ['--check', mutation.filename]).status, 0, 'The mutation must remain valid JavaScript');
      const result = execute(directory, [
        '--test', '--test-reporter=tap', `--test-name-pattern=${mutation.testName}`, 'test-counter-invariants.cjs',
      ]);
      assert.equal(result.status, 1, `The invariant suite missed ${mutation.label}\n${result.output}`);
      assert.match(result.output, /ERR_ASSERTION/, result.output);
      assert.match(result.output, mutation.diagnostic, result.output);
      assert.doesNotMatch(result.output, /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError/);
    });
  });
}
