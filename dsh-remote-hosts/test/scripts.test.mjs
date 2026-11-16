import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = (name) => fileURLToPath(new URL('../bin/' + name, import.meta.url));
const SCRIPTS = ['sync.sh', 'update.sh', 'remote.sh', 'provision.sh'];

const run = (args, options = {}) => new Promise((resolve) => {
  execFile('/bin/sh', args, { timeout: 10000, ...options }, (error, stdout, stderr) => {
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
    [[script('remote.sh'), 'host', 'logs', '--sessions-window', '30'], /not valid for logs/],
    [[script('remote.sh'), 'host', 'probe', '--sessions-window', 'zero'], /bad session window/],
    [[script('provision.sh')], /usage/],
    [[script('provision.sh'), 'host', '--port', 'abc'], /bad port/],
    [[script('provision.sh'), 'host', '--kind', 'systemd-user'], /unknown option/],
    [[script('provision.sh'), 'host', '--profile', '../x'], /bad profile/],
    [[script('provision.sh'), 'host', '--node-version', 'x'], /bad node version/],
    [[script('provision.sh'), 'host', '--bundles', 'pkg;rm'], /bad bundle spec/],
  ];
  for (const [args, pattern] of cases) {
    const result = await run(args);
    assert.notEqual(result.code, 0, args.join(' '));
    assert.match(result.stderr, pattern, args.join(' '));
  }
});

test('probe reports session writes inside the window', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-remote-hosts-'));
  try {
    const bin = join(dir, 'bin');
    const home = join(dir, 'home');
    const session = join(home, '.dsh', 'sessions', '--workspace--', 'session-a');
    mkdirSync(bin, { recursive: true });
    mkdirSync(session, { recursive: true });
    writeFileSync(join(session, 'session.v4.jsonl.zstd'), 'x');
    // Fake ssh runs the command string it is handed with the payload on stdin,
    // so the probe's discovery and session scan run without a remote host.
    writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nfor last; do :; done\nexec sh -c "$last"\n');
    chmodSync(join(bin, 'ssh'), 0o755);
    const result = await run([script('remote.sh'), 'demo', 'probe', '--sessions-window', '10'], {
      env: { ...process.env, HOME: home, PATH: bin + ':' + process.env.PATH },
    });
    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.equal(payload.ok, true);
    assert.equal(payload.info.sessions.window, 10);
    assert.equal(payload.info.sessions.active, 1);
    assert.ok(payload.info.sessions.files >= 1);
    assert.deepEqual(payload.info.sessions.ids, ['session-a']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
