import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Schema from '@deepseek-ai/schemastery';
import { Tunnel } from './lib/tunnel.js';
import { Proxy } from './lib/proxy.js';

// Host half: one ssh tunnel and auth-injecting proxy per configured remote host,
// a status route for the browser half, and the sync route that runs
// bin/sync.sh. Every route lives under /api/, where the platform requires a live
// browser session: the plain web server does no authentication or origin policy
// of its own, so anything registered there is reachable from any local process.
export const name = 'dsh-remote-hosts';
export const inject = ['connection'];

const SCRIPT = fileURLToPath(new URL('./bin/sync.sh', import.meta.url));
const SYNC_TIMEOUT_MS = 300000;
const TAIL_LINES = 40;
const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/i;

// One entry per remote host. A server with sshHost gets a managed tunnel and
// proxy on ports the plugin picks; without it its url is opened directly.
const DEFAULT_SERVERS = [
  { id: 'a100-146', label: 'A100-146', url: 'http://127.0.0.1:27994/', sshHost: 'a100-146', remotePort: 27993, localPort: 0, remoteLog: '' },
];

// Keep the schema permissive: a half-filled row in the settings form has to
// reach configuredServers(), which drops it, instead of failing activation.
export const Config = Schema.object({
  servers: Schema.array(Schema.object({
    id: Schema.string().default(''),
    label: Schema.string().default(''),
    url: Schema.string().default(''),
    sshHost: Schema.string().default(''),
    remotePort: Schema.natural().min(1).max(65535).default(27993),
    localPort: Schema.natural().max(65535).default(0),
    remoteLog: Schema.string().default(''),
  }))
    // A hand-edited row that fails the item schema is dropped instead of
    // failing the whole plugin entry; configuredServers() then falls back.
    .default(DEFAULT_SERVERS.map((server) => ({ ...server })))
    .loose()
    .volatile(),
}).i18n({
  en: {
    $desc: 'Remote dsh servers shown in the sidebar; the same list authorizes the sync route.',
    servers: {
      $desc: 'Each server needs a unique id and a display label. With sshHost the plugin owns the tunnel and proxy; without it the url is opened as is.',
      id: 'Stable identifier used in panel ids and sync requests: letters, digits, and dashes, up to 63 characters.',
      label: 'Text shown on the sidebar row and the overlay button.',
      url: 'Local http(s) URL of the remote dsh web instance; optional for a managed host.',
      sshHost: 'SSH destination for the managed tunnel and for bin/sync.sh. Empty opens url directly.',
      remotePort: 'Port the remote dsh web listens on (default 27993).',
      localPort: 'Local tunnel port; 0 lets the plugin pick a free one.',
      remoteLog: 'Remote log the login token is read from; defaults to ~/.dsh/web-<remotePort>.log.',
    },
  },
  zh: {
    $desc: '侧边栏中的远程 dsh 服务器；同一份列表也决定同步接口允许的主机。',
    servers: {
      $desc: '每台服务器需要唯一的 id 和显示名称。填写 sshHost 后由插件管理隧道和代理；不填则直接打开 url。',
      id: '用于面板 id 和同步请求的稳定标识：字母、数字和连字符，最多 63 个字符。',
      label: '显示在侧边栏行和浮层按钮上的文字。',
      url: '远程 dsh web 实例的本地 http(s) 地址；由插件管理的主机可以不填。',
      sshHost: '插件管理的 SSH 隧道与 bin/sync.sh 使用的目标；留空则直接打开 url。',
      remotePort: '远端 dsh web 监听的端口（默认 27993）。',
      localPort: '本地隧道端口；0 表示自动选择空闲端口。',
      remoteLog: '读取登录 token 的远端日志；默认 ~/.dsh/web-<remotePort>.log。',
    },
  },
});

function jsonResponse(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'cache-control': 'no-store' } });
}

async function readJson(request) {
  try {
    const value = await request.json();
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

// A .volatile() Config field is a stable reference read with get(); an absent or
// plain value still works so the plugin runs before the settings service mounts.
function configList(config) {
  const value = config && config.servers;
  const unwrapped = value && typeof value.get === 'function' ? value.get() : value;
  return Array.isArray(unwrapped) ? unwrapped : [];
}

function toServer(row) {
  if (!row || typeof row !== 'object') return null;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  if (!ID_PATTERN.test(id)) return null;
  const sshHost = typeof row.sshHost === 'string' ? row.sshHost.trim() : '';
  const raw = typeof row.url === 'string' ? row.url.trim() : '';
  let url = '';
  if (raw) {
    try {
      const parsed = new URL(raw);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') url = parsed.href;
    } catch {}
  }
  // A managed host has no fixed address: its proxy port is picked at runtime.
  if (!url && !sshHost) return null;
  return {
    id,
    label: typeof row.label === 'string' && row.label.trim() ? row.label.trim() : id,
    url,
    sshHost,
    remotePort: Number(row.remotePort) || 27993,
    localPort: Number(row.localPort) || 0,
    remoteLog: typeof row.remoteLog === 'string' ? row.remoteLog.trim() : '',
  };
}

// The single source of truth: invalid rows are dropped, the first duplicate id
// wins, and an empty result falls back to the built-in default server.
function configuredServers(config) {
  const servers = [];
  const seen = new Set();
  for (const row of configList(config)) {
    const server = toServer(row);
    if (!server || seen.has(server.id)) continue;
    seen.add(server.id);
    servers.push(server);
  }
  return servers.length ? servers : DEFAULT_SERVERS.map((server) => ({ ...server }));
}

function tail(text, count) {
  return String(text || '').trim().split('\n').filter((line) => line.trim()).slice(-count).join('\n');
}

// One readable sentence for the UI: what failed, then the last useful lines.
// The script writes its progress to stdout, so a stdout tail matters as much as
// stderr (a killed process reports neither).
function describeFailure(error, stdout, stderr) {
  const parts = [];
  if (error) {
    if (error.killed || error.signal) parts.push('timed out or killed (' + (error.signal || 'timeout') + ')');
    else if (typeof error.code === 'number' && error.code !== 0) parts.push('exit code ' + error.code);
    else if (typeof error.code === 'string') parts.push('could not run the sync script: ' + error.code);
    else if (error.message) parts.push(error.message);
  }
  const detail = tail(stderr, 3) || tail(stdout, 3);
  if (detail) parts.push(detail);
  return parts.length ? parts.join('\n') : 'sync failed without output';
}

function pushLine(lines, text) {
  lines.push(text);
  if (lines.length > TAIL_LINES) lines.shift();
}

function readLines(stream, onLine) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      onLine(buffer.slice(0, index).replace(/\r$/, ''));
      buffer = buffer.slice(index + 1);
    }
  });
  stream.on('end', () => {
    if (!buffer) return;
    onLine(buffer.replace(/\r$/, ''));
    buffer = '';
  });
}

// Answer with newline-delimited JSON so the browser can show progress while the
// copy runs: one line event per line of output, then one done event carrying
// the same readable summary a single-shot answer used to carry.
function streamSync(request, args) {
  let child;
  try {
    child = spawn('sh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    return jsonResponse({ ok: false, error: 'could not run the sync script: ' + (error && error.message ? error.message : String(error)) }, 500);
  }

  const encoder = new TextEncoder();
  const stdoutTail = [];
  const stderrTail = [];
  let finished = false;
  let timedOut = false;
  let spawnError = null;
  let controller = null;

  const send = (event) => {
    if (!controller) return;
    try { controller.enqueue(encoder.encode(JSON.stringify(event) + '\n')); } catch {}
  };
  const line = (name, lines, text) => {
    pushLine(lines, text);
    send({ type: 'line', stream: name, text });
  };
  readLines(child.stdout, (text) => line('stdout', stdoutTail, text));
  readLines(child.stderr, (text) => line('stderr', stderrTail, text));

  const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, SYNC_TIMEOUT_MS);
  timeout.unref?.();
  const stop = () => { try { child.kill('SIGKILL'); } catch {} };
  if (request.signal) {
    if (request.signal.aborted) stop();
    else request.signal.addEventListener('abort', stop, { once: true });
  }

  child.on('error', (error) => { spawnError = error; });
  child.on('close', (code, signal) => {
    if (finished) return;
    finished = true;
    clearTimeout(timeout);
    const ok = !spawnError && !timedOut && !signal && code === 0;
    const failure = spawnError || (timedOut ? { killed: true, signal: 'SIGKILL' } : { signal, code });
    send({
      type: 'done',
      ok,
      code: spawnError || typeof code !== 'number' ? null : code,
      error: ok ? '' : describeFailure(failure, stdoutTail.join('\n'), stderrTail.join('\n')),
    });
    try { if (controller) controller.close(); } catch {}
  });

  return new Response(new ReadableStream({
    start(value) { controller = value; },
    cancel() { finished = true; clearTimeout(timeout); stop(); },
  }), {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    },
  });
}

// One configured host: its tunnel is the only upstream the proxy ever sees, so
// the connection state is the worse of the two halves.
class ServerLink {
  constructor(server) {
    this.server = server;
    this.startError = '';
    this.tunnel = new Tunnel({
      id: server.id,
      sshHost: server.sshHost,
      remotePort: server.remotePort,
      localPort: server.localPort,
      onState: () => this.wakeProxy(),
    });
    this.proxy = new Proxy({
      sshHost: server.sshHost,
      remotePort: server.remotePort,
      remoteLog: server.remoteLog,
      upstreamPort: () => (this.tunnel ? this.tunnel.localPort : 0),
    });
  }

  // A fresh tunnel is useless until the proxy logs in again; warming the cookie
  // here is what makes the iframe recover without another manual retry.
  wakeProxy() {
    const tunnel = this.tunnel;
    const proxy = this.proxy;
    if (tunnel && proxy && tunnel.state === 'online') proxy.retry().catch(() => {});
  }

  async start() {
    const tunnel = this.tunnel;
    const proxy = this.proxy;
    if (!tunnel || !proxy) return;
    try {
      await tunnel.start();
      if (this.proxy !== proxy) return;
      await proxy.start();
    } catch (error) {
      this.startError = 'could not start the tunnel or proxy: ' + (error && error.message ? error.message : String(error));
    }
  }

  async reconnect() {
    if (this.proxy) this.proxy.reset();
    if (this.tunnel) await this.tunnel.restart();
  }

  async stop() {
    const proxy = this.proxy;
    const tunnel = this.tunnel;
    this.proxy = null;
    this.tunnel = null;
    if (proxy) await proxy.stop();
    if (tunnel) await tunnel.stop();
  }

  status() {
    const tunnel = this.tunnel ? this.tunnel.info : { state: 'offline', error: this.startError, updatedAt: 0 };
    const proxy = this.proxy ? this.proxy.info : { state: 'offline', error: '', proxyUrl: '', updatedAt: 0 };
    let state = 'offline';
    let error = this.startError;
    if (tunnel.state === 'offline') {
      state = 'offline';
      error = tunnel.error || error;
    } else if (tunnel.state === 'connecting') {
      state = 'connecting';
    } else if (proxy.state === 'offline') {
      state = 'offline';
      error = proxy.error || error;
    } else if (proxy.state === 'connecting') {
      state = 'connecting';
    } else {
      state = 'online';
    }
    return {
      state,
      error: state === 'online' ? '' : error,
      proxyUrl: proxy.proxyUrl || '',
      updatedAt: Math.max(tunnel.updatedAt || 0, proxy.updatedAt || 0),
    };
  }
}

export function apply(ctx, config) {
  const links = new Map();
  let listed = [];
  let disposed = false;

  const sameTarget = (link, server) => link.server.sshHost === server.sshHost
    && link.server.remotePort === server.remotePort
    && link.server.localPort === server.localPort
    && link.server.remoteLog === server.remoteLog;

  // The server list lives in volatile settings, so it can change without this
  // plugin being remounted. Reconcile creates, replaces, and stops links to
  // match; it is synchronous, which also makes it cheap before every read.
  const reconcile = () => {
    if (disposed) return;
    listed = configuredServers(config);
    const keep = new Set();
    for (const server of listed) {
      if (!server.sshHost) continue;
      keep.add(server.id);
      const existing = links.get(server.id);
      if (existing && sameTarget(existing, server)) { existing.server = server; continue; }
      if (existing) {
        links.delete(server.id);
        existing.stop().catch(() => {});
      }
      const link = new ServerLink(server);
      links.set(server.id, link);
      link.start().catch(() => {});
    }
    for (const [id, link] of links) {
      if (keep.has(id)) continue;
      links.delete(id);
      link.stop().catch(() => {});
    }
  };

  // The browser half renders the list, the state and the frame address from one
  // shape: proxyUrl is where the iframe goes, or empty while it cannot open.
  const describe = () => {
    reconcile();
    return listed.map((server) => {
      const link = links.get(server.id);
      // url is the configured address (empty for a managed host until its proxy
      // is up); proxyUrl is where the browser frame goes right now.
      if (!link) {
        return {
          id: server.id,
          label: server.label,
          url: server.url,
          managed: false,
          state: 'external',
          error: '',
          proxyUrl: server.url,
          updatedAt: 0,
        };
      }
      return { id: server.id, label: server.label, url: server.url, managed: true, ...link.status() };
    });
  };

  // Tunnels and proxies are effects of this fiber: an unload disposes them, and
  // nothing survives as an orphan process or a bound port.
  ctx.effect(() => {
    reconcile();
    return async () => {
      disposed = true;
      const current = [...links.values()];
      links.clear();
      await Promise.all(current.map((link) => link.stop()));
    };
  }, 'remote-hosts: ssh tunnels and proxies');

  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/remote-hosts/status',
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: () => Promise.resolve(jsonResponse({ ok: true, servers: describe() })),
  }), 'remote-hosts: status route');

  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/remote-hosts/reconnect',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const payload = await readJson(request);
      if (!payload) return jsonResponse({ ok: false, error: 'bad json' }, 400);
      const id = String(payload.host || '');
      reconcile();
      const link = links.get(id);
      if (!link) return jsonResponse({ ok: false, error: 'host is not managed by this plugin: ' + id }, 400);
      link.reconnect().catch(() => {});
      return jsonResponse({ ok: true, server: { id, ...link.status() } });
    },
  }), 'remote-hosts: reconnect route');

  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/remote-hosts/sync',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const payload = await readJson(request);
      if (!payload) return jsonResponse({ ok: false, error: 'bad json' }, 400);
      const host = String(payload.host || '');
      const server = configuredServers(config).find((entry) => entry.id === host);
      if (!server) return jsonResponse({ ok: false, error: 'unknown host: ' + host }, 400);

      const restart = payload.restart !== false;
      const dryRun = payload.dryRun === true;
      const args = [SCRIPT, server.sshHost || server.id];
      // --dry-run stops before any copy or restart, so it wins over --restart.
      if (dryRun) args.push('--dry-run');
      else if (restart) args.push('--restart');
      return streamSync(request, args);
    },
  }), 'remote-hosts: sync route');
}
