import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

async function setup(config) {
  const routes = new Map();
  const disposals = [];
  const ctx = {
    effect(fn) {
      const disposal = fn();
      if (typeof disposal === 'function') disposals.push(disposal);
    },
    connection: { fetch: { register(options) { routes.set(options.path, options); return () => {}; } } },
  };
  const { apply } = await import('../index.js');
  apply(ctx, config);
  return {
    routes,
    async dispose() {
      for (const disposal of disposals.reverse()) await disposal();
    },
  };
}

const post = (route, body) => route.fetch(new Request('http://127.0.0.1/api/test', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
}));

test('an empty server list renders no rows', async () => {
  const host = await setup({ servers: [] });
  try {
    assert.deepEqual([...host.routes.keys()].sort(), [
      '/api/remote-hosts/activate',
      '/api/remote-hosts/logs',
      '/api/remote-hosts/probe',
      '/api/remote-hosts/provision',
      '/api/remote-hosts/reconnect',
      '/api/remote-hosts/service',
      '/api/remote-hosts/status',
      '/api/remote-hosts/sync',
      '/api/remote-hosts/update',
    ]);
    const payload = await (await host.routes.get('/api/remote-hosts/status').fetch(new Request('http://127.0.0.1/api/remote-hosts/status'))).json();
    assert.equal(payload.ok, true);
    assert.deepEqual(payload.servers, []);
    assert.equal(typeof payload.localVersion, 'string');
  } finally {
    await host.dispose();
  }
});

test('an external server is described without a managed link', async () => {
  const host = await setup({ servers: [{ id: 'demo', label: 'Demo', url: 'http://127.0.0.1:27994/' }] });
  try {
    const payload = await (await host.routes.get('/api/remote-hosts/status').fetch(new Request('http://127.0.0.1/api/remote-hosts/status'))).json();
    assert.equal(payload.servers.length, 1);
    assert.equal(payload.servers[0].id, 'demo');
    assert.equal(payload.servers[0].managed, false);
    assert.equal(payload.servers[0].sshHost, '');
    assert.equal(payload.servers[0].sidebar, true);
    assert.equal(payload.servers[0].state, 'external');
    assert.equal(payload.servers[0].proxyUrl, 'http://127.0.0.1:27994/');
    assert.equal(payload.servers[0].probe, null);
    assert.equal(payload.servers[0].update, null);
  } finally {
    await host.dispose();
  }
});

test('routes reject bad payloads and unmanaged hosts', async () => {
  const host = await setup({ servers: [{ id: 'demo', label: 'Demo', url: 'http://127.0.0.1:27994/' }] });
  try {
    const cases = [
      ['/api/remote-hosts/update', 'not json', 400],
      ['/api/remote-hosts/update', { host: 'nope' }, 400],
      ['/api/remote-hosts/update', { host: 'demo' }, 400],
      ['/api/remote-hosts/probe', { host: 'demo' }, 400],
      ['/api/remote-hosts/activate', { host: 'demo' }, 400],
      ['/api/remote-hosts/logs', { host: 'demo' }, 400],
      ['/api/remote-hosts/service', { host: 'demo', action: 'explode' }, 400],
      ['/api/remote-hosts/service', { host: 'demo', action: 'restart' }, 400],
      ['/api/remote-hosts/sync', 'not json', 400],
      ['/api/remote-hosts/provision', 'not json', 400],
      ['/api/remote-hosts/provision', { host: 'demo' }, 400],
    ];
    for (const [path, body, status] of cases) {
      const response = await post(host.routes.get(path), body);
      assert.equal(response.status, status, path + ' ' + JSON.stringify(body));
      const payload = await response.json();
      assert.equal(payload.ok, false);
    }
  } finally {
    await host.dispose();
  }
});

test('a managed host stays dormant until the browser activates it', async () => {
  const host = await setup({ servers: [{ id: 'remote', sshHost: 'user@example.invalid', remotePort: 27993 }] });
  try {
    const payload = await (await host.routes.get('/api/remote-hosts/status').fetch(new Request('http://127.0.0.1/api/remote-hosts/status'))).json();
    assert.equal(payload.servers.length, 1);
    assert.equal(payload.servers[0].managed, true);
    assert.equal(payload.servers[0].sshHost, 'user@example.invalid');
    assert.equal(payload.servers[0].state, 'dormant');
    assert.equal(payload.servers[0].error, '');
    assert.equal(payload.servers[0].proxyUrl, '');
    assert.equal(payload.servers[0].probe, null);
    assert.equal(payload.servers[0].update, null);
  } finally {
    await host.dispose();
  }
});

test('a second action on the same host is refused while one runs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-remote-hosts-'));
  const bin = join(dir, 'bin');
  const home = join(dir, 'home');
  mkdirSync(bin, { recursive: true });
  mkdirSync(home, { recursive: true });
  // The guard probe runs the real payload locally; the update itself blocks so
  // the second request arrives while the first action still owns the host.
  writeFileSync(join(bin, 'ssh'), '#!/bin/sh\nfor last; do :; done\ncase "$last" in\n  *probe*) exec sh -c "$last" ;;\n  *) exec sleep 4 ;;\nesac\n');
  chmodSync(join(bin, 'ssh'), 0o755);
  const oldPath = process.env.PATH;
  const oldHome = process.env.HOME;
  process.env.PATH = bin + ':' + oldPath;
  process.env.HOME = home;
  const host = await setup({ servers: [{ id: 'demo', label: 'Demo', sshHost: 'demo', remotePort: 27993 }] });
  try {
    const first = await post(host.routes.get('/api/remote-hosts/update'), { host: 'demo' });
    assert.equal(first.status, 200);
    assert.match(first.headers.get('content-type') || '', /x-ndjson/);
    const second = await post(host.routes.get('/api/remote-hosts/update'), { host: 'demo' });
    assert.equal(second.status, 409);
    const payload = await second.json();
    assert.equal(payload.code, 'action-in-progress');
    await first.body.cancel().catch(() => {});
  } finally {
    process.env.PATH = oldPath;
    process.env.HOME = oldHome;
    await host.dispose();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a duplicate fixed local port is reported as a managed offline row', async () => {
  const host = await setup({
    servers: [
      { id: 'a', sshHost: '127.0.0.1', localPort: 28001, remotePort: 27993 },
      { id: 'b', sshHost: '127.0.0.2', localPort: 28001, remotePort: 27993 },
    ],
  });
  try {
    const payload = await (await host.routes.get('/api/remote-hosts/status').fetch(new Request('http://127.0.0.1/api/remote-hosts/status'))).json();
    const byId = Object.fromEntries(payload.servers.map((row) => [row.id, row]));
    assert.equal(byId.a.managed, true);
    assert.equal(byId.b.managed, true);
    assert.equal(byId.b.state, 'offline');
    assert.match(byId.b.error, /local port 28001/);
  } finally {
    await host.dispose();
  }
});
