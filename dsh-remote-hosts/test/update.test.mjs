import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, parseVersion, updateState } from '../lib/update.js';

test('versions compare with semver prerelease rules', () => {
  assert.equal(compareVersions('0.2.2-rc.1', '0.2.2-rc.3'), -1);
  assert.equal(compareVersions('0.2.2', '0.2.2-rc.3'), 1);
  assert.equal(compareVersions('0.2.10', '0.2.9'), 1);
  assert.equal(compareVersions('v0.2.2', '0.2.2'), 0);
  assert.equal(compareVersions('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(compareVersions('1.0.0-alpha.1', '1.0.0-alpha.beta'), -1);
  assert.equal(compareVersions('nope', '0.2.2'), null);
  assert.equal(parseVersion('nope'), null);
});

test('an older remote advertises the target version', () => {
  const info = { dsh: { version: '0.2.2-rc.1' } };
  assert.deepEqual(updateState(info, '', '0.2.2-rc.3'), {
    current: '0.2.2-rc.1', target: '0.2.2-rc.3', available: true,
  });
  assert.deepEqual(updateState(info, '0.2.2-rc.4', '0.2.2-rc.3'), {
    current: '0.2.2-rc.1', target: '0.2.2-rc.4', available: true,
  });
});

test('equal, newer, tagged and unknown hosts stay quiet', () => {
  assert.equal(updateState({ dsh: { version: '0.2.2-rc.3' } }, '', '0.2.2-rc.3').available, false);
  assert.equal(updateState({ dsh: { version: '0.3.0' } }, '', '0.2.2-rc.3').available, false);
  assert.equal(updateState({ dsh: { version: '0.2.2-rc.1' } }, 'next', '0.2.2-rc.3'), null);
  assert.equal(updateState({ dsh: { version: '0.2.2-rc.1' } }, '', ''), null);
  assert.equal(updateState(null, '', '0.2.2-rc.3'), null);
});
