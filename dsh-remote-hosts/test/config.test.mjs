import test from 'node:test';
import assert from 'node:assert/strict';
import { configuredServers, toServer } from '../lib/config.js';

test('empty or missing config yields no servers', () => {
  assert.deepEqual(configuredServers(undefined), []);
  assert.deepEqual(configuredServers({}), []);
  assert.deepEqual(configuredServers({ servers: [] }), []);
});

test('a row needs a URL or an SSH host', () => {
  assert.equal(toServer({ id: 'x' }), null);
  assert.equal(toServer({ id: 'x', label: 'X' }), null);
  assert.equal(toServer({ id: 'bad id', url: 'http://127.0.0.1:1/' }), null);
  assert.equal(toServer({ id: 'x', url: 'ftp://example.com/' }), null);
});

test('an external row normalizes its URL and reports external', () => {
  const server = toServer({ id: 'x', url: 'http://127.0.0.1:27994' });
  assert.equal(server.url, 'http://127.0.0.1:27994/');
  assert.equal(server.sshHost, '');
  assert.equal(server.serviceKind, 'external');
  assert.equal(server.serviceUnit, '');
  assert.equal(server.remotePort, 27993);
  assert.equal(server.localPort, 0);
  assert.equal(server.profile, 'web');
});

test('a managed row derives the common service defaults', () => {
  const server = toServer({ id: 'gpu', sshHost: 'user@gpu-1' });
  assert.equal(server.managed, undefined);
  assert.equal(server.serviceKind, 'systemd-user');
  assert.equal(server.serviceUnit, 'dsh-web');
  assert.equal(server.profile, 'web');
  assert.equal(server.updateChannel, '');
});

test('custom service descriptor fields are preserved', () => {
  const server = toServer({
    id: 'gpu2',
    sshHost: 'user@gpu-1',
    remotePort: 28001,
    localPort: 18001,
    remoteLog: '~/logs/dsh.log',
    serviceKind: 'launchd-user',
    serviceUnit: 'com.example.dsh-web',
    profile: 'web-nightly',
    updateChannel: 'next',
  });
  assert.equal(server.serviceKind, 'launchd-user');
  assert.equal(server.serviceUnit, 'com.example.dsh-web');
  assert.equal(server.profile, 'web-nightly');
  assert.equal(server.updateChannel, 'next');
  assert.equal(server.remotePort, 28001);
  assert.equal(server.localPort, 18001);
  assert.equal(server.remoteLog, '~/logs/dsh.log');
});

test('malformed descriptor fields fall back instead of dropping the row', () => {
  const server = toServer({
    id: 'gpu3',
    sshHost: 'user@gpu-1',
    serviceKind: 'nonsense',
    serviceUnit: 'bad unit with spaces',
    profile: 'bad profile',
    updateChannel: 'bad channel',
  });
  assert.equal(server.serviceKind, 'systemd-user');
  assert.equal(server.serviceUnit, 'dsh-web');
  assert.equal(server.profile, 'web');
  assert.equal(server.updateChannel, '');
});

test('sidebar visibility defaults to true and persists false', () => {
  assert.equal(toServer({ id: 'x', url: 'http://127.0.0.1:1/' }).sidebar, true);
  assert.equal(toServer({ id: 'x', url: 'http://127.0.0.1:1/', sidebar: false }).sidebar, false);
  assert.equal(toServer({ id: 'y', sshHost: 'host', sidebar: true }).sidebar, true);
});

test('settings sync content is configurable per row', () => {
  const server = toServer({
    id: 'gpu', sshHost: 'user@gpu-1',
    syncSourceProfile: 'desktop',
    syncKeys: 'KEY_A, KEY_B',
    syncAgents: false,
    syncPatch: false,
  });
  assert.equal(server.syncSourceProfile, 'desktop');
  assert.equal(server.syncKeys, 'KEY_A, KEY_B');
  assert.equal(server.syncAgents, false);
  assert.equal(server.syncPatch, false);
});

test('settings sync defaults to desktop, all keys and both files', () => {
  const server = toServer({ id: 'gpu', sshHost: 'user@gpu-1' });
  assert.equal(server.syncSourceProfile, 'desktop');
  assert.equal(server.syncKeys, '');
  assert.equal(server.syncAgents, true);
  assert.equal(server.syncPatch, true);
  assert.equal(toServer({ id: 'gpu2', sshHost: 'user@gpu-1', syncSourceProfile: '..' }).syncSourceProfile, 'desktop');
  assert.equal(toServer({ id: 'gpu3', sshHost: 'user@gpu-1', profile: '..' }).profile, 'web');
});

test('the token pattern falls back when invalid', () => {
  assert.equal(toServer({ id: 'x', sshHost: 'host' }).tokenPattern, '');
  assert.equal(toServer({ id: 'x', sshHost: 'host', tokenPattern: 'auth=([a-z]+)' }).tokenPattern, 'auth=([a-z]+)');
  assert.equal(toServer({ id: 'x', sshHost: 'host', tokenPattern: '(' }).tokenPattern, '');
  assert.equal(toServer({ id: 'x', sshHost: 'host', tokenPattern: 'a\nb' }).tokenPattern, '');
});

test('ssh options are audited', () => {
  assert.deepEqual(toServer({
    id: 'x', sshHost: 'host', sshOptions: ['ProxyJump=user@jump', 'ProxyCommand=bad'],
  }).sshOptions, ['ProxyJump=user@jump']);
  assert.deepEqual(toServer({ id: 'x', sshHost: 'host' }).sshOptions, []);
});

test('provision bundles stay a trimmed string', () => {
  assert.equal(toServer({ id: 'x', sshHost: 'host', bundles: ' dsh-context@0.78.0 ' }).bundles, 'dsh-context@0.78.0');
  assert.equal(toServer({ id: 'y', sshHost: 'host' }).bundles, '');
});

test('duplicate ids keep the first row', () => {
  const servers = configuredServers({
    servers: [
      { id: 'dup', url: 'http://127.0.0.1:1/' },
      { id: 'dup', url: 'http://127.0.0.1:2/' },
      { id: 'keep', sshHost: 'host' },
    ],
  });
  assert.deepEqual(servers.map((server) => server.id), ['dup', 'keep']);
  assert.equal(servers[0].url, 'http://127.0.0.1:1/');
});

test('a volatile config reference is unwrapped', () => {
  const servers = configuredServers({ servers: { get: () => [{ id: 'x', url: 'http://127.0.0.1:1/' }] } });
  assert.equal(servers.length, 1);
  assert.equal(servers[0].id, 'x');
});
