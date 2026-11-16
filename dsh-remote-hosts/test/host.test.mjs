import test from 'node:test';
import assert from 'node:assert/strict';

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
      '/api/remote-hosts/logs',
      '/api/remote-hosts/probe',
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
    assert.equal(payload.servers[0].sidebar, true);
    assert.equal(payload.servers[0].state, 'external');
    assert.equal(payload.servers[0].proxyUrl, 'http://127.0.0.1:27994/');
    assert.equal(payload.servers[0].probe, null);
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
      ['/api/remote-hosts/logs', { host: 'demo' }, 400],
      ['/api/remote-hosts/service', { host: 'demo', action: 'explode' }, 400],
      ['/api/remote-hosts/service', { host: 'demo', action: 'restart' }, 400],
      ['/api/remote-hosts/sync', 'not json', 400],
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
