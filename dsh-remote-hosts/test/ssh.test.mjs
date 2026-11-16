import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSshOptions, sshArgs, sshEnv } from '../lib/ssh.js';

test('only audited ssh options survive', () => {
  assert.deepEqual(normalizeSshOptions([
    'ProxyJump=user@jump',
    'Port=2222',
    'IdentityFile=~/.ssh/id_ed25519',
    'ProxyCommand=rm -rf /',
    'Port=22 22',
    'Port=2222',
  ]), ['ProxyJump=user@jump', 'Port=2222', 'IdentityFile=~/.ssh/id_ed25519']);
});

test('a newline separated string is accepted', () => {
  assert.deepEqual(normalizeSshOptions('ProxyJump=user@jump\n\nPort=2222'), ['ProxyJump=user@jump', 'Port=2222']);
  assert.deepEqual(normalizeSshOptions(''), []);
  assert.deepEqual(normalizeSshOptions(null), []);
});

test('args and env stay shell-safe', () => {
  assert.deepEqual(sshArgs(['Port=2222']), ['-o', 'Port=2222']);
  assert.equal(sshEnv(['Port=2222']).DSH_SSH_OPTIONS, '-o Port=2222');
  assert.equal(sshEnv([]), null);
  assert.equal(sshEnv(['ProxyCommand=rm -rf /']), null);
});
