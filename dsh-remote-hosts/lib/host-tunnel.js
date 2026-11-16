import net from 'node:net';
import { spawn } from 'node:child_process';
import { freePort } from './tunnel.js';
import { sshArgs } from './ssh.js';

// One ssh process per sshHost. Every endpoint on that machine contributes a
// -L forward, so three dsh instances share one connection and one ssh process
// instead of growing the process count per endpoint. Local ports are allocated
// once per forward and kept across restarts, so a proxy keeps its origin.
const RETRY_DELAYS = [500, 1000, 2000, 4000, 8000, 15000, 30000];
const READY_INTERVAL = 500;
const STOP_GRACE = 3000;
const STABLE_ONLINE = 10000;

function delay(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

function tail(text, count) {
  return String(text || '').trim().split('\n').map((line) => line.trim()).filter(Boolean).slice(-count).join(' / ');
}

export class HostTunnel {
  constructor(options = {}) {
    this.sshHost = String(options.sshHost || '');
    // Endpoints on the same host share one connection, so the first endpoint's
    // options are used; keep sshOptions consistent per sshHost.
    this.sshOptions = Array.isArray(options.sshOptions) ? options.sshOptions : [];
    // link id -> { remotePort, localPort }; localPort 0 means "allocate once".
    this.forwards = new Map();
    this.listeners = new Set();
    // True while at least one endpoint wants this connection. A release can
    // race a restart; without this flag the restart could respawn ssh after the
    // last endpoint closed.
    this.needed = false;
    this.state = 'offline';
    this.error = '';
    this.updatedAt = Date.now();
    this.since = this.updatedAt;
    this.attempts = 0;
    this.onlineAt = 0;
    this.child = null;
    this.starting = null;
    this.stopping = null;
    this.retryTimer = null;
    this.probeTimer = null;
    this.stderr = '';
  }

  get info() {
    return {
      state: this.state,
      error: this.error,
      updatedAt: this.updatedAt,
      since: this.since,
      forwards: this.forwards.size,
    };
  }

  get active() {
    return Boolean(this.child || this.starting);
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  localPortFor(id) {
    const forward = this.forwards.get(id);
    return forward ? forward.localPort : 0;
  }

  setNeeded(value) {
    this.needed = Boolean(value);
  }

  // Register the complete forward set for this host. Returns true when the
  // running ssh must be restarted to pick up a new port, a removed endpoint or
  // different ssh options.
  setForwards(entries, sshOptions) {
    let changed = false;
    if (Array.isArray(sshOptions) && sshOptions.join('\n') !== this.sshOptions.join('\n')) {
      this.sshOptions = sshOptions.slice();
      changed = true;
    }
    const seen = new Set();
    for (const entry of Array.isArray(entries) ? entries : []) {
      const id = String(entry && entry.id || '');
      if (!id) continue;
      const remotePort = Number(entry.remotePort) || 0;
      const wantedLocal = Number(entry.localPort) || 0;
      const current = this.forwards.get(id);
      seen.add(id);
      if (!current) {
        this.forwards.set(id, { remotePort, localPort: wantedLocal, fixed: wantedLocal > 0 });
        changed = true;
        continue;
      }
      if (current.remotePort !== remotePort) {
        current.remotePort = remotePort;
        changed = true;
      }
      if (wantedLocal) {
        if (current.localPort !== wantedLocal) {
          current.localPort = wantedLocal;
          changed = true;
        }
        if (!current.fixed) {
          current.fixed = true;
          changed = true;
        }
      } else if (current.fixed) {
        // Clearing a fixed port means auto again; allocate a fresh one so the
        // old port is no longer held.
        current.localPort = 0;
        current.fixed = false;
        changed = true;
      }
    }
    for (const id of [...this.forwards.keys()]) {
      if (seen.has(id)) continue;
      this.forwards.delete(id);
      changed = true;
    }
    return changed;
  }

  async ensurePorts() {
    const used = new Set();
    for (const forward of this.forwards.values()) {
      if (forward.localPort) used.add(forward.localPort);
    }
    for (const forward of this.forwards.values()) {
      if (forward.localPort) continue;
      let port = await freePort();
      while (used.has(port)) port = await freePort();
      forward.localPort = port;
      used.add(port);
    }
  }

  setState(state, error = '') {
    if (this.state === state && this.error === error) return;
    this.state = state;
    this.error = error;
    this.updatedAt = Date.now();
    this.since = this.updatedAt;
    for (const listener of this.listeners) {
      try { listener(this); } catch {}
    }
  }

  start() {
    if (!this.needed) return Promise.resolve();
    if (this.stopping) return this.stopping.then(() => this.start());
    // Never spawn twice: a second acquire joins the attempt in flight. If the
    // joined attempt aborted because the last endpoint released mid-spawn, a
    // later acquire must be able to spawn again.
    if (this.child || this.starting) {
      return (this.starting || Promise.resolve()).then(() => {
        if (this.needed && !this.child && !this.starting) return this.start();
      });
    }
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
    if (!this.needed) return;
    if (!this.sshHost || this.forwards.size === 0) {
      this.setState('offline', 'sshHost and a forward are required');
      return;
    }
    this.setState('connecting');
    await this.ensurePorts();
    // A release during port allocation must not leave a new ssh behind.
    if (this.stopping || !this.needed) { this.setState('offline'); return; }
    if (this.forwards.size === 0) { this.setState('offline', 'no forwards'); return; }
    const args = [
      ...sshArgs(this.sshOptions),
      '-o', 'BatchMode=yes',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=3',
      '-o', 'ExitOnForwardFailure=yes',
      '-N',
    ];
    for (const forward of this.forwards.values()) {
      args.push('-L', '127.0.0.1:' + forward.localPort + ':127.0.0.1:' + forward.remotePort);
    }
    args.push(this.sshHost);
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
    const first = [...this.forwards.values()][0];
    if (!first || !first.localPort) return;
    const port = first.localPort;
    const tick = () => {
      this.probeTimer = null;
      if (this.child !== child || this.state === 'online') return;
      const socket = net.connect({ host: '127.0.0.1', port });
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
    await this.start();
  }

  stop() {
    if (this.stopping) return this.stopping;
    this.clearRetry();
    this.clearProbe();
    const child = this.child;
    if (!child) {
      this.setState('offline');
      return Promise.resolve();
    }
    const exited = new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return; }
      child.once('exit', resolve);
    });
    this.stopping = (async () => {
      child.kill('SIGTERM');
      const done = await Promise.race([exited.then(() => true), delay(STOP_GRACE).then(() => false)]);
      if (!done) {
        child.kill('SIGKILL');
        await Promise.race([exited, delay(1000)]);
      }
      if (this.child === child) this.child = null;
      this.setState('offline');
      this.stopping = null;
    })();
    return this.stopping;
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
