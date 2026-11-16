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
