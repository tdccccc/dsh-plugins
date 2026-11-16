import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_TOKEN_PATTERN, extractToken } from '../lib/proxy.js';

test('the default token pattern extracts the token', () => {
  assert.equal(extractToken('boot token=abc123\n', DEFAULT_TOKEN_PATTERN), 'abc123');
  assert.equal(extractToken('token=a-b_c', DEFAULT_TOKEN_PATTERN), 'a-b_c');
});

test('a custom pattern uses its first capture group', () => {
  assert.equal(extractToken('auth=xyz', 'auth=([A-Za-z0-9_-]+)'), 'xyz');
  assert.equal(extractToken('PASSWORD: secret', 'PASSWORD: (.+)'), 'secret');
});

test('a pattern without a group returns the whole match', () => {
  assert.equal(extractToken('rawtoken', 'rawtoken'), 'rawtoken');
  assert.equal(extractToken('nothing', 'rawtoken'), '');
});

test('an empty or invalid pattern yields no token', () => {
  assert.equal(extractToken('', DEFAULT_TOKEN_PATTERN), '');
  assert.equal(extractToken('token=abc', '('), '');
});
