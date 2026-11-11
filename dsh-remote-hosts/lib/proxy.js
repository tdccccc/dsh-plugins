import http from 'node:http';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { freePort } from './tunnel.js';

// Local auth-injecting proxy in front of one remote dsh web instance. The
// browser talks to 127.0.0.1:<port>; the proxy logs in with the launch token
// read from the remote log over ssh and forwards every request with the cookie.
// Unlike the standalone script this replaces, it only serves this machine's own
// UI: a foreign Host, Origin, or a cross-site fetch is refused before any
// credential is attached.
const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const RETRY_DELAYS = [2000, 4000, 8000, 15000, 30000];
const LOGIN_TIMEOUT = 15000;
const TOKEN_TIMEOUT = 15000;
const LOOPBACK_NAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isLoopbackHost(value) {
  const host = String(value || '').trim().toLowerCase();
  return LOOPBACK_NAMES.has(host);
}

function hostnameOf(host) {
  try { return new URL('http://' + host).hostname.toLowerCase(); } catch { return ''; }
}

function formatHost(host) {
  const text = String(host);
  return text.includes(':') && !text.startsWith('[') ? '[' + text + ']' : text;
}

function authority(host, port) {
  return formatHost(host) + ':' + port;
}

function describe(error) {
  return error && error.message ? error.message : String(error);
}

function tail(text, count) {
  return String(text || '').trim().split('\n').map((line) => line.trim()).filter(Boolean).slice(-count).join(' / ');
}

function bodyless(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return true;
  return !req.headers['content-length'] && !req.headers['transfer-encoding'];
}

// The same fence the remote dsh applies to its own API: loopback Host only, no
// foreign Origin, no cross-site fetch. A missing Origin is a non-browser client
// (curl, the proxy's own login), which still has to pass Host.
export function checkRequest(headers) {
  const host = headers && headers.host;
  if (!host || !isLoopbackHost(hostnameOf(host))) return 'loopback host required';
  const self = new URL('http://' + host);
  const site = String((headers && headers['sec-fetch-site']) || '').toLowerCase();
  if (site === 'cross-site') return 'cross-site request refused';
  const origin = headers && headers.origin;
  if (typeof origin === 'string' && origin) {
    let url;
    try { url = new URL(origin); } catch { return 'origin refused'; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'origin refused';
    if (url.host !== self.host && !isLoopbackHost(url.hostname)) return 'origin refused';
  }
  return null;
}

function rewriteReferer(referer, upstreamAuthority) {
  try {
    const url = new URL(String(referer));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    if (!isLoopbackHost(url.hostname)) return '';
    return 'http://' + upstreamAuthority + url.pathname + url.search + url.hash;
  } catch {
    return '';
  }
}

export function forwardHeaders(source, options) {
  const upstream = options.upstream || '';
  const headers = {};
  for (const [rawName, rawValue] of Object.entries(source || {})) {
    if (rawValue === undefined) continue;
    const name = String(rawName).toLowerCase();
    if (HOP_BY_HOP.has(name) || name === 'host' || name === 'cookie' || name === 'origin' || name === 'referer') continue;
    headers[name] = rawValue;
  }
  headers.host = upstream;
  if (typeof source.origin === 'string' && source.origin) headers.origin = 'http://' + upstream;
  if (typeof source.referer === 'string' && source.referer) {
    const referer = rewriteReferer(source.referer, upstream);
    if (referer) headers.referer = referer;
  }
  // Credentials only ever travel to a loopback upstream: the tunnel's local
  // end. A non-loopback target never receives the login cookie.
  if (options.cookie && isLoopbackHost(options.upstreamHost)) headers.cookie = options.cookie;
  if (options.upgrade) {
    headers.connection = 'Upgrade';
    headers.upgrade = typeof source.upgrade === 'string' ? source.upgrade : 'websocket';
  }
  return headers;
}

function responseHeaders(source, upstreamAuthority, proxyAuthority) {
  const headers = {};
  for (const [rawName, rawValue] of Object.entries(source || {})) {
    const name = String(rawName).toLowerCase();
    if (HOP_BY_HOP.has(name)) continue;
    // The login cookie belongs to the proxy, never to the embedded page.
    if (name === 'set-cookie') continue;
    if (name === 'location' && typeof rawValue === 'string') {
      headers[name] = rewriteLocation(rawValue, upstreamAuthority, proxyAuthority);
      continue;
    }
    headers[name] = rawValue;
  }
  return headers;
}

function rewriteLocation(location, upstreamAuthority, proxyAuthority) {
  try {
    const url = new URL(location);
    if (url.host !== upstreamAuthority) return location;
    return 'http://' + proxyAuthority + url.pathname + url.search + url.hash;
  } catch {
    return location;
  }
}

function send(res, status, text) {
  if (res.destroyed) return;
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function rejectSocket(socket, status, text) {
  if (!socket || socket.destroyed) return;
  const reason = status === 403 ? 'Forbidden' : status === 503 ? 'Service Unavailable' : 'Bad Gateway';
  socket.end('HTTP/1.1 ' + status + ' ' + reason + '\r\ncontent-type: text/plain; charset=utf-8\r\ncontent-length: '
    + Buffer.byteLength(text) + '\r\nconnection: close\r\n\r\n' + text);
}

function shellQuote(value) {
  return "'" + String(value).replace(/'/g, "'\\''") + "'";
}

// A configured remote path may start with ~; keep the shell's home expansion and
// quote everything else so a path cannot turn into a remote command.
function remotePath(path) {
  const text = String(path || '');
  if (text === '~') return '"$HOME"';
  if (text.startsWith('~/')) return '"$HOME"' + shellQuote(text.slice(1));
  return shellQuote(text);
}

export class Proxy {
  constructor(options) {
    this.sshHost = String(options.sshHost || '');
    this.remotePort = Number(options.remotePort) || 27993;
    this.remoteLog = String(options.remoteLog || '');
    this.upstreamHost = String(options.upstreamHost || '127.0.0.1');
    this.upstreamPortOption = options.upstreamPort || 0;
    this.readTokenOverride = typeof options.readToken === 'function' ? options.readToken : null;
    this.cookie = String(options.cookie || '');
    this.onState = options.onState || (() => {});
    this.listenPort = Number(options.localPort) || 0;
    this.state = 'connecting';
    this.error = '';
    this.updatedAt = Date.now();
    this.since = this.updatedAt;
    this.attempts = 0;
    this.server = null;
    this.port = 0;
    this.stopped = false;
    this.loggingIn = null;
    this.retryTimer = null;
    this.sockets = new Set();
  }

  get url() {
    return this.port ? 'http://127.0.0.1:' + this.port + '/' : '';
  }

  get info() {
    return {
      state: this.state,
      error: this.error,
      port: this.port,
      proxyUrl: this.url,
      updatedAt: this.updatedAt,
      since: this.since,
    };
  }

  setState(state, error = '') {
    if (this.state === state && this.error === error) return;
    this.state = state;
    this.error = error;
    this.updatedAt = Date.now();
    this.since = this.updatedAt;
    this.onState(this);
  }

  upstreamPort() {
    const value = typeof this.upstreamPortOption === 'function' ? this.upstreamPortOption() : this.upstreamPortOption;
    return Number(value) || 0;
  }

  upstreamAuthority() {
    return authority(this.upstreamHost, this.upstreamPort());
  }

  async start() {
    this.stopped = false;
    if (this.server) return;
    const port = this.listenPort || await freePort();
    if (this.stopped) return;
    this.listenPort = port;
    const server = http.createServer((req, res) => this.handle(req, res));
    server.on('upgrade', (req, socket, head) => { this.upgrade(req, socket, head); });
    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    server.on('clientError', (error, socket) => {
      if (socket && socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nconnection: close\r\n\r\n');
      else if (socket) socket.destroy();
    });
    server.on('error', (error) => this.setState('offline', 'proxy error: ' + error.message));
    await new Promise((resolve, reject) => {
      const onError = (error) => { server.off('listening', onListening); reject(error); };
      const onListening = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
    if (this.stopped) {
      await new Promise((resolve) => server.close(resolve));
      return;
    }
    this.port = port;
    this.server = server;
    this.setState('connecting');
    this.retry().catch(() => {});
  }

  async stop() {
    this.stopped = true;
    this.clearRetry();
    this.cookie = '';
    const server = this.server;
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    if (!server) return;
    await new Promise((resolve) => server.close(resolve));
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
  }

  reset() {
    this.clearRetry();
    this.attempts = 0;
    this.cookie = '';
    this.setState('connecting');
  }

  retry() {
    this.clearRetry();
    if (!this.server) return Promise.resolve();
    this.setState('connecting');
    return this.login().catch(() => {});
  }

  login() {
    if (this.loggingIn) return this.loggingIn;
    this.loggingIn = (async () => {
      if (!this.upstreamPort()) throw new Error('tunnel is not ready');
      const token = await this.readToken();
      const cookie = await this.loginRequest(token);
      this.cookie = cookie;
      this.attempts = 0;
      this.setState('online', '');
      return cookie;
    })().catch((error) => {
      this.setState('offline', 'login failed: ' + describe(error));
      this.scheduleRetry();
      throw error;
    }).finally(() => { this.loggingIn = null; });
    return this.loggingIn;
  }

  readToken() {
    if (this.readTokenOverride) return Promise.resolve().then(() => this.readTokenOverride());
    const log = this.remoteLog || '~/.dsh/web-' + this.remotePort + '.log';
    const command = "grep -oE 'token=[A-Za-z0-9_-]+' " + remotePath(log) + ' | tail -1';
    return new Promise((resolve, reject) => {
      execFile('ssh', ['-o', 'BatchMode=yes', this.sshHost, command], { timeout: TOKEN_TIMEOUT, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const detail = tail(stderr || '') || tail(stdout || '') || error.message;
          reject(new Error('could not read the launch token: ' + detail));
          return;
        }
        const text = String(stdout || '').trim();
        const at = text.lastIndexOf('token=');
        const value = at === -1 ? '' : text.slice(at + 6).trim();
        if (!value) {
          reject(new Error('no launch token in ' + log));
          return;
        }
        resolve(value);
      });
    });
  }

  loginRequest(token) {
    const upstream = this.upstreamAuthority();
    return new Promise((resolve, reject) => {
      const request = http.request({
        host: this.upstreamHost,
        port: this.upstreamPort(),
        method: 'GET',
        path: '/?token=' + encodeURIComponent(token),
        headers: { host: upstream, connection: 'close' },
      }, (response) => {
        response.resume();
        const raw = response.headers['set-cookie'] || [];
        const jar = (Array.isArray(raw) ? raw : [raw])
          .map((cookie) => String(cookie).split(';')[0].trim())
          .filter(Boolean)
          .join('; ');
        if (!jar) {
          reject(new Error('login returned no cookie (HTTP ' + response.statusCode + ')'));
          return;
        }
        resolve(jar);
      });
      request.setTimeout(LOGIN_TIMEOUT, () => request.destroy(new Error('login timed out')));
      request.on('error', reject);
      request.end();
    });
  }

  handle(req, res) {
    const refused = checkRequest(req.headers);
    if (refused) return send(res, 403, 'forbidden: ' + refused + '\n');
    if (!this.upstreamPort()) return send(res, 503, 'tunnel is not ready\n');
    if (this.cookie) return this.forward(req, res, false);
    this.login().then(
      () => this.forward(req, res, false),
      (error) => send(res, 502, 'login failed: ' + describe(error) + '\n'),
    );
  }

  forward(req, res, retried) {
    if (res.destroyed) { req.resume(); return; }
    const port = this.upstreamPort();
    if (!port) return send(res, 503, 'tunnel is not ready\n');
    const upstream = authority(this.upstreamHost, port);
    const request = http.request({
      host: this.upstreamHost,
      port,
      method: req.method,
      path: req.url,
      headers: forwardHeaders(req.headers, {
        upstream,
        cookie: this.cookie,
        upstreamHost: this.upstreamHost,
      }),
    }, (response) => {
      if (response.statusCode === 401 && !retried && this.cookie && bodyless(req)) {
        response.resume();
        this.login().catch(() => {}).finally(() => this.forward(req, res, true));
        return;
      }
      if (response.statusCode === 401) {
        this.setState('offline', 'the remote rejected the login cookie');
        this.scheduleRetry();
      } else {
        this.setState('online');
      }
      res.writeHead(response.statusCode, responseHeaders(response.headers, upstream, '127.0.0.1:' + this.port));
      response.pipe(res);
    });
    request.on('error', (error) => {
      this.setState('offline', 'upstream error: ' + error.message);
      this.scheduleRetry();
      if (res.headersSent) res.destroy();
      else send(res, 502, 'upstream error: ' + error.message + '\n');
    });
    res.on('close', () => { if (!res.writableEnded) request.destroy(); });
    req.on('aborted', () => request.destroy());
    req.pipe(request);
  }

  async upgrade(req, socket, head) {
    socket.on('error', () => socket.destroy());
    const refused = checkRequest(req.headers);
    if (refused) return rejectSocket(socket, 403, 'forbidden: ' + refused + '\n');
    const port = this.upstreamPort();
    if (!port) return rejectSocket(socket, 503, 'tunnel is not ready\n');
    if (!this.cookie) {
      try {
        await this.login();
      } catch (error) {
        return rejectSocket(socket, 502, 'login failed: ' + describe(error) + '\n');
      }
      if (socket.destroyed) return;
    }
    const upstream = authority(this.upstreamHost, port);
    const headers = forwardHeaders(req.headers, {
      upstream,
      cookie: this.cookie,
      upstreamHost: this.upstreamHost,
      upgrade: true,
    });
    const lines = [req.method + ' ' + req.url + ' HTTP/1.1'];
    for (const [name, value] of Object.entries(headers)) {
      if (Array.isArray(value)) for (const item of value) lines.push(name + ': ' + item);
      else if (value !== undefined) lines.push(name + ': ' + value);
    }
    lines.push('', '');
    let connected = false;
    const remote = net.connect(port, this.upstreamHost, () => {
      connected = true;
      remote.write(lines.join('\r\n'));
      if (head && head.length) remote.write(head);
      remote.pipe(socket);
      socket.pipe(remote);
      this.setState('online');
    });
    remote.on('error', (error) => {
      this.setState('offline', 'upstream error: ' + error.message);
      this.scheduleRetry();
      if (!connected) rejectSocket(socket, 502, 'upstream error: ' + error.message + '\n');
      else socket.destroy();
    });
    remote.on('close', () => socket.destroy());
    socket.on('close', () => remote.destroy());
  }

  scheduleRetry() {
    if (!this.server || this.retryTimer) return;
    const wait = RETRY_DELAYS[Math.min(this.attempts, RETRY_DELAYS.length - 1)];
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.server) return;
      this.login().catch(() => {});
    }, wait);
    this.retryTimer.unref?.();
  }

  clearRetry() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }
}
