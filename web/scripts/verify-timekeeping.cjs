'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const options = process.argv.slice(2);
if (options.some((argument) => argument !== '--unit-only')) {
  console.error('Usage: node web/scripts/verify-timekeeping.cjs [--unit-only]');
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status || 1);
}

run('pnpm', ['--dir', 'extension', 'test:timekeeping']);
run('npm', ['--prefix', 'web/functions', 'run', 'test:usage']);
if (!options.includes('--unit-only')) {
  run(process.execPath, [path.join(__dirname, 'run-counter-emulator.cjs')]);
}
