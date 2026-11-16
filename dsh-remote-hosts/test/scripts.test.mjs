import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = (name) => fileURLToPath(new URL('../bin/' + name, import.meta.url));
const SCRIPTS = ['sync.sh', 'update.sh', 'remote.sh'];

const run = (args) => new Promise((resolve) => {
  execFile('/bin/sh', args, { timeout: 10000 }, (error, stdout, stderr) => {
    resolve({ code: error && typeof error.code === 'number' ? error.code : (error ? 1 : 0), stdout, stderr });
  });
});

test('every shell script parses', async () => {
  for (const name of SCRIPTS) {
    const result = await run(['-n', script(name)]);
    assert.equal(result.code, 0, name + ': ' + result.stderr);
  }
});

test('scripts reject bad arguments before touching ssh', async () => {
  const cases = [
    [[script('sync.sh')], /usage/],
    [[script('sync.sh'), 'host', '--kind', 'nope'], /bad kind/],
    [[script('update.sh'), 'host', '--port', 'abc'], /bad port/],
    [[script('update.sh'), 'host', '--kind', 'nope'], /bad kind/],
    [[script('remote.sh')], /usage/],
    [[script('remote.sh'), 'host', 'probe', '--kind', 'nope'], /bad service kind/],
    [[script('remote.sh'), 'host', 'logs', '--lines', 'x'], /bad lines/],
    [[script('remote.sh'), 'host', 'service', 'explode'], /bad service action/],
  ];
  for (const [args, pattern] of cases) {
    const result = await run(args);
    assert.notEqual(result.code, 0, args.join(' '));
    assert.match(result.stderr, pattern, args.join(' '));
  }
});
