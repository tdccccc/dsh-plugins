import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Schema from '@deepseek-ai/schemastery';
import { configuredServers } from './lib/config.js';
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
const UPDATE_SCRIPT = fileURLToPath(new URL('./bin/update.sh', import.meta.url));
const REMOTE_SCRIPT = fileURLToPath(new URL('./bin/remote.sh', import.meta.url));
const SYNC_TIMEOUT_MS = 300000;
// An update downloads the whole package tree and restarts the unit, so it gets
// a longer leash than a settings copy.
const UPDATE_TIMEOUT_MS = 900000;
const TAIL_LINES = 40;
const PROBE_TIMEOUT_MS = 30000;
const PROBE_TTL_MS = 60000;
const SERVICE_TIMEOUT_MS = 120000;
const LOG_TIMEOUT_MS = 30000;

// Nothing is built in: the plugin ships without assuming a particular host, so
// an empty server list simply renders no rows until one is configured.

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
    // How the remote service is managed; empty derives from sshHost.
    serviceKind: Schema.string().default(''),
    serviceUnit: Schema.string().default(''),
    profile: Schema.string().default(''),
    updateChannel: Schema.string().default(''),
  }))
    // A hand-edited row that fails the item schema is dropped instead of
    // failing the whole plugin entry; configuredServers() then skips it.
    .default([])
    .loose()
    .volatile(),
}).i18n({
  en: {
    $desc: 'Remote dsh servers shown in the sidebar; the same list authorizes the update and service routes.',
    servers: {
      $desc: 'Each server needs a unique id and a display label. With sshHost the plugin owns the tunnel and proxy; without it the url is opened as is.',
      id: 'Stable identifier used in panel ids and sync requests: letters, digits, and dashes, up to 63 characters.',
      label: 'Text shown on the sidebar row and the overlay button.',
      url: 'Local http(s) URL of the remote dsh web instance; optional for a managed host.',
      sshHost: 'SSH destination for the managed tunnel and for bin/sync.sh. Empty opens url directly.',
      remotePort: 'Port the remote dsh web listens on (default 27993).',
      localPort: 'Local tunnel port; 0 lets the plugin pick a free one.',
      remoteLog: 'Remote log the login token is read from; defaults to ~/.dsh/web-<remotePort>.log.',
      serviceKind: 'How the remote dsh-web is managed: systemd-user, launchd-user, command or external.',
      serviceUnit: 'systemd unit or launchd label that runs the remote dsh web (default dsh-web).',
      profile: 'Remote dsh profile directory under ~/.dsh/profiles (default web).',
      updateChannel: 'Update target: empty mirrors this app version, otherwise an npm dist-tag (latest, next) or an exact version.',
    },
  },
  zh: {
    $desc: '侧边栏中的远程 dsh 服务器；同一份列表也决定更新与服务接口允许的主机。',
    servers: {
      $desc: '每台服务器需要唯一的 id 和显示名称。填写 sshHost 后由插件管理隧道和代理；不填则直接打开 url。',
      id: '用于面板 id 和同步请求的稳定标识：字母、数字和连字符，最多 63 个字符。',
      label: '显示在侧边栏行和浮层按钮上的文字。',
      url: '远程 dsh web 实例的本地 http(s) 地址；由插件管理的主机可以不填。',
      sshHost: '插件管理的 SSH 隧道与 bin/sync.sh 使用的目标；留空则直接打开 url。',
      remotePort: '远端 dsh web 监听的端口（默认 27993）。',
      localPort: '本地隧道端口；0 表示自动选择空闲端口。',
      remoteLog: '读取登录 token 的远端日志；默认 ~/.dsh/web-<remotePort>.log。',
      serviceKind: '远端 dsh-web 的管理方式：systemd-user、launchd-user、command 或 external。',
      serviceUnit: '运行远端 dsh web 的 systemd unit 或 launchd label（默认 dsh-web）。',
      profile: '远端 dsh profile 目录名，位于 ~/.dsh/profiles 下（默认 web）。',
      updateChannel: '更新目标：留空跟随本机应用版本，否则填 npm dist-tag（latest、next）或精确版本号。',
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

// The Host half runs inside the dsh process that owns this machine's profile,
// so the package next to argv[1] names the version this app runs: the desktop
// host publishes the app version and the CLI publishes the dsh version. An
// unknown process shape only loses the "same version" default for updates.
function localDshVersion() {
  const entry = process.argv[1];
  if (!entry) return '';
  const folder = dirname(entry);
  for (const file of [join(folder, '..', 'package.json'), join(folder, 'package.json')]) {
    try {
      const meta = JSON.parse(readFileSync(file, 'utf8'));
      if (/^@deepseek-ai\/dsh\b/.test(String(meta.name)) && typeof meta.version === 'string') return meta.version;
    } catch {}
  }
  return '';
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
function streamCommand(request, args, timeoutMs = SYNC_TIMEOUT_MS) {
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

  const timeout = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
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

// One-shot remote commands (probe, log tail) answer with JSON instead of a
// stream, so the route can hand the result straight to the browser.
function runScript(args, timeoutMs = PROBE_TIMEOUT_MS) {
  return new Promise((resolve) => {
    execFile('sh', args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ error: error || null, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// The helper prints one JSON document as its last stdout line; anything before
// it is progress noise from the remote payload.
function parseJsonLine(stdout) {
  const lines = String(stdout || '').split('\n').map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const value = JSON.parse(lines[index]);
      if (value && typeof value === 'object') return value;
    } catch {}
  }
  return null;
}

// One configured host: its tunnel is the only upstream the proxy ever sees, so
// the connection state is the worse of the two halves.
class ServerLink {
  constructor(server) {
    this.server = server;
    this.startError = '';
    // Last probe result (service/version/log health) is cached by time, not by
    // connection state: it only needs a fresh SSH read to refresh.
    this.probe = { at: 0, info: null, error: '', pending: null };
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

  // Probe the remote service over SSH. Cached for PROBE_TTL_MS; force skips the
  // cache and a concurrent call joins the in-flight probe instead of adding a
  // second SSH session.
  probeInfo(force = false) {
    const current = this.probe;
    if (current.pending) return current.pending;
    if (!force && current.at && Date.now() - current.at < PROBE_TTL_MS) return Promise.resolve(current);
    const server = this.server;
    const args = [REMOTE_SCRIPT, server.sshHost, 'probe', '--port', String(server.remotePort), '--kind', server.serviceKind];
    if (server.serviceUnit) args.push('--unit', server.serviceUnit);
    if (server.remoteLog) args.push('--log', server.remoteLog);
    const pending = runScript(args, PROBE_TIMEOUT_MS).then(
      ({ error, stdout, stderr }) => {
        const payload = parseJsonLine(stdout);
        const result = payload && payload.ok && payload.info
          ? { at: Date.now(), info: payload.info, error: '' }
          : { at: Date.now(), info: null, error: describeFailure(error, stdout, stderr) || 'the probe returned no data' };
        this.probe = { ...result, pending: null };
        return result;
      },
      (error) => {
        const result = { at: Date.now(), info: null, error: error && error.message ? error.message : String(error) };
        this.probe = { ...result, pending: null };
        return result;
      },
    );
    this.probe = { ...current, pending };
    return pending;
  }

  clearProbe() {
    this.probe = { at: 0, info: null, error: '', pending: null };
  }

  probeSnapshot() {
    const current = this.probe;
    if (!current.at && !current.error) return null;
    return { at: current.at, info: current.info, error: current.error };
  }

  async stop() {
    const proxy = this.proxy;
    const tunnel = this.tunnel;
    this.proxy = null;
    this.tunnel = null;
    this.clearProbe();
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
      probe: this.probeSnapshot(),
      updatedAt: Math.max(tunnel.updatedAt || 0, proxy.updatedAt || 0),
    };
  }
}

export function apply(ctx, config) {
  const links = new Map();
  let listed = [];
  // id -> reason a fixed local port is unusable; rebuilt by reconcile.
  let portErrors = new Map();
  let disposed = false;

  const sameTarget = (link, server) => link.server.sshHost === server.sshHost
    && link.server.remotePort === server.remotePort
    && link.server.localPort === server.localPort
    && link.server.remoteLog === server.remoteLog
    && link.server.serviceKind === server.serviceKind
    && link.server.serviceUnit === server.serviceUnit
    && link.server.profile === server.profile
    && link.server.updateChannel === server.updateChannel;

  // The server list lives in volatile settings, so it can change without this
  // plugin being remounted. Reconcile creates, replaces, and stops links to
  // match; it is synchronous, which also makes it cheap before every read.
  const reconcile = () => {
    if (disposed) return;
    listed = configuredServers(config);
    // A fixed local port can only feed one tunnel; report the duplicate instead
    // of letting the second ssh fail with a bind error.
    portErrors = new Map();
    const owners = new Map();
    for (const server of listed) {
      if (!server.sshHost || !server.localPort) continue;
      const owner = owners.get(server.localPort);
      if (owner) {
        portErrors.set(server.id, 'local port ' + server.localPort + ' is already used by ' + owner);
        continue;
      }
      owners.set(server.localPort, server.id);
    }
    const keep = new Set();
    for (const server of listed) {
      if (!server.sshHost || portErrors.has(server.id)) continue;
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
        const misconfigured = portErrors.get(server.id);
        if (misconfigured) {
          return {
            id: server.id,
            label: server.label,
            url: server.url,
            managed: true,
            state: 'offline',
            error: misconfigured,
            proxyUrl: '',
            probe: null,
            updatedAt: 0,
          };
        }
        return {
          id: server.id,
          label: server.label,
          url: server.url,
          managed: false,
          state: 'external',
          error: '',
          proxyUrl: server.url,
          probe: null,
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
    fetch: () => Promise.resolve(jsonResponse({ ok: true, localVersion: localDshVersion(), servers: describe() })),
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
      // A managed host carries its own service descriptor so the same script
      // works for another unit or profile; an unmanaged row has no target.
      if (server.sshHost) {
        args.push('--port', String(server.remotePort), '--profile', server.profile, '--kind', server.serviceKind);
        if (server.serviceUnit) args.push('--unit', server.serviceUnit);
      }
      // --dry-run stops before any copy or restart, so it wins over --restart.
      if (dryRun) args.push('--dry-run');
      else if (restart) args.push('--restart');
      return streamCommand(request, args);
    },
  }), 'remote-hosts: sync route');

  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/remote-hosts/update',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const payload = await readJson(request);
      if (!payload) return jsonResponse({ ok: false, error: 'bad json' }, 400);
      const host = String(payload.host || '');
      const server = configuredServers(config).find((entry) => entry.id === host);
      if (!server) return jsonResponse({ ok: false, error: 'unknown host: ' + host }, 400);
      // Updating needs ssh; a URL-only host is somebody else's install.
      if (!server.sshHost) return jsonResponse({ ok: false, error: 'host is not managed by this plugin: ' + host }, 400);

      const args = [UPDATE_SCRIPT, server.sshHost, '--port', String(server.remotePort), '--kind', server.serviceKind];
      if (server.serviceUnit) args.push('--unit', server.serviceUnit);
      // A per-host channel wins; otherwise mirror the version this desktop app
      // runs, and only fall back to the published latest when unknown.
      const channel = server.updateChannel;
      if (channel) args.push(/^[0-9]/.test(channel) ? '--version' : '--tag', channel);
      else {
        const version = localDshVersion();
        if (version) args.push('--version', version);
        else args.push('--tag', 'latest');
      }
      if (payload.dryRun === true) args.push('--dry-run');
      else if (payload.restart === false) args.push('--no-restart');
      const link = links.get(host);
      if (link) link.clearProbe();
      return streamCommand(request, args, UPDATE_TIMEOUT_MS);
    },
  }), 'remote-hosts: update route');

  // Probe is read-only and cached; it feeds the version/service summary in the
  // overlay and never starts a tunnel by itself.
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/remote-hosts/probe',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const payload = await readJson(request);
      if (!payload) return jsonResponse({ ok: false, error: 'bad json' }, 400);
      const host = String(payload.host || '');
      reconcile();
      const link = links.get(host);
      if (!link) return jsonResponse({ ok: false, error: 'host is not managed by this plugin: ' + host }, 400);
      const result = await link.probeInfo(payload.force === true);
      return jsonResponse({ ok: !result.error, at: result.at, info: result.info, error: result.error });
    },
  }), 'remote-hosts: probe route');

  // Lifecycle actions run through the same NDJSON channel as sync/update so the
  // overlay can show progress and the same readable failure summary.
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/remote-hosts/service',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const payload = await readJson(request);
      if (!payload) return jsonResponse({ ok: false, error: 'bad json' }, 400);
      const host = String(payload.host || '');
      const action = String(payload.action || '');
      if (!['start', 'stop', 'restart'].includes(action)) {
        return jsonResponse({ ok: false, error: 'unsupported service action: ' + action }, 400);
      }
      const server = configuredServers(config).find((entry) => entry.id === host);
      if (!server) return jsonResponse({ ok: false, error: 'unknown host: ' + host }, 400);
      if (!server.sshHost) return jsonResponse({ ok: false, error: 'host is not managed by this plugin: ' + host }, 400);
      if (server.serviceKind === 'external') {
        return jsonResponse({ ok: false, error: 'host has no managed dsh service: ' + host }, 400);
      }
      const args = [REMOTE_SCRIPT, server.sshHost, 'service', action, '--port', String(server.remotePort), '--kind', server.serviceKind];
      if (server.serviceUnit) args.push('--unit', server.serviceUnit);
      const link = links.get(host);
      if (link) link.clearProbe();
      return streamCommand(request, args, SERVICE_TIMEOUT_MS);
    },
  }), 'remote-hosts: service route');

  // Log tail is a one-shot JSON answer: the browser shows it in the same log
  // panel the streaming actions use.
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/remote-hosts/logs',
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const payload = await readJson(request);
      if (!payload) return jsonResponse({ ok: false, error: 'bad json' }, 400);
      const host = String(payload.host || '');
      const server = configuredServers(config).find((entry) => entry.id === host);
      if (!server) return jsonResponse({ ok: false, error: 'unknown host: ' + host }, 400);
      if (!server.sshHost) return jsonResponse({ ok: false, error: 'host is not managed by this plugin: ' + host }, 400);
      const lines = Math.min(Math.max(Math.trunc(Number(payload.lines)) || 200, 1), 1000);
      const args = [REMOTE_SCRIPT, server.sshHost, 'logs', '--lines', String(lines), '--port', String(server.remotePort)];
      if (server.remoteLog) args.push('--log', server.remoteLog);
      const { error, stdout, stderr } = await runScript(args, LOG_TIMEOUT_MS);
      if (error) return jsonResponse({ ok: false, error: describeFailure(error, stdout, stderr) });
      return jsonResponse({ ok: true, text: stdout });
    },
  }), 'remote-hosts: logs route');
}
