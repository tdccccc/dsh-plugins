import net from 'node:net';
import { spawn } from 'node:child_process';

// One ssh process per server. The OS picks the local port once and it is reused
// across restarts, so a browser tab pointed at the proxy keeps its origin when
// ssh reconnects. A crashed process is restarted with a capped backoff; a
// deliberate stop never restarts.
const RETRY_DELAYS = [500, 1000, 2000, 4000, 8000, 15000, 30000];
const READY_INTERVAL = 500;
const STOP_GRACE = 3000;
const STABLE_ONLINE = 10000;

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function tail(text, count) {
  return String(text || '').trim().split('\n').map((line) => line.trim()).filter(Boolean).slice(-count).join(' / ');
}

export class Tunnel {
  constructor(options) {
    this.id = options.id || '';
    this.sshHost = String(options.sshHost || '');
    this.remotePort = Number(options.remotePort) || 0;
    this.localPort = Number(options.localPort) || 0;
    this.onState = options.onState || (() => {});
    this.state = 'offline';
    this.error = '';
    this.updatedAt = Date.now();
    this.since = this.updatedAt;
    this.attempts = 0;
    this.onlineAt = 0;
    this.child = null;
    this.starting = null;
    this.stopping = false;
    this.retryTimer = null;
    this.probeTimer = null;
    this.stderr = '';
  }

  get info() {
    return {
      state: this.state,
      error: this.error,
      localPort: this.localPort,
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

  start() {
    this.stopping = false;
    // Never spawn twice: a second start while a child or a spawn is in flight
    // joins the existing attempt instead of adding a second tunnel.
    if (this.child || this.starting) return this.starting || Promise.resolve();
    this.starting = (async () => {
      try {
        await this.spawn();
      } catch (error) {
        this.setState('offline', 'tunnel setup failed: ' + (error && error.message ? error.message : String(error)));
        this.scheduleRetry();
      }
    })().finally(() => { this.starting = null; });
    return this.starting;
  }

  async spawn() {
    this.clearRetry();
    this.clearProbe();
    if (!this.sshHost || !this.remotePort) {
      this.setState('offline', 'sshHost and remotePort are required');
      return;
    }
    this.setState('connecting');
    if (!this.localPort) this.localPort = await freePort();
    // stop() may have run while the port probe was pending.
    if (this.stopping) { this.setState('offline'); return; }
    const args = [
      '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      '-N',
      '-L', '127.0.0.1:' + this.localPort + ':127.0.0.1:' + this.remotePort,
      this.sshHost,
    ];
    let child;
    try {
      child = spawn('ssh', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      this.setState('offline', 'could not start ssh: ' + error.message);
      this.scheduleRetry();
      return;
    }
    this.child = child;
    this.stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { this.stderr = (this.stderr + chunk).slice(-4000); });

    const settle = (reason) => {
      if (this.child !== child) return;
      this.child = null;
      this.clearProbe();
      if (this.stopping) {
        this.setState('offline');
        return;
      }
      if (this.onlineAt && Date.now() - this.onlineAt >= STABLE_ONLINE) this.attempts = 0;
      const hint = tail(this.stderr, 2);
      this.setState('offline', hint ? reason + ': ' + hint : reason);
      this.scheduleRetry();
    };
    child.on('error', (error) => settle('could not start ssh: ' + error.message));
    child.on('exit', (code, signal) => {
      settle(signal ? 'ssh terminated (' + signal + ')' : 'ssh exited with code ' + code);
    });
    this.probe(child);
  }

  probe(child) {
    const tick = () => {
      this.probeTimer = null;
      if (this.child !== child || this.state === 'online') return;
      const socket = net.connect({ host: '127.0.0.1', port: this.localPort });
      let settled = false;
      const finish = (online) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (this.child !== child) return;
        if (online) {
          this.onlineAt = Date.now();
          this.setState('online');
          return;
        }
        this.probeTimer = setTimeout(tick, READY_INTERVAL);
        this.probeTimer.unref?.();
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(2000, () => finish(false));
    };
    tick();
  }

  scheduleRetry() {
    if (this.stopping || this.retryTimer) return;
    const wait = RETRY_DELAYS[Math.min(this.attempts, RETRY_DELAYS.length - 1)];
    this.attempts += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.stopping) return;
      this.start().catch(() => {});
    }, wait);
    this.retryTimer.unref?.();
  }

  async restart() {
    this.attempts = 0;
    await this.stop();
    this.stopping = false;
    await this.start();
  }

  async stop() {
    this.stopping = true;
    this.clearRetry();
    this.clearProbe();
    const child = this.child;
    if (!child) {
      this.setState('offline');
      return;
    }
    const exited = new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      child.once('exit', resolve);
    });
    child.kill('SIGTERM');
    const done = await Promise.race([exited.then(() => true), delay(STOP_GRACE).then(() => false)]);
    if (!done) {
      child.kill('SIGKILL');
      await Promise.race([exited, delay(1000)]);
    }
    if (this.child === child) this.child = null;
    this.setState('offline');
  }

  dispose() {
    return this.stop();
  }

  clearProbe() {
    if (this.probeTimer) { clearTimeout(this.probeTimer); this.probeTimer = null; }
  }

  clearRetry() {
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }
}
