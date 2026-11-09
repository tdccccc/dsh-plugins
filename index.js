import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Host half: exposes one authenticated-browser-reachable route that runs the
// sync script for a configured server, so the remote view can offer a button.
export const name = 'dsh-remote-hosts';
export const inject = ['webServer'];

// The servers this harness may provision; anything else is refused.
const HOSTS = new Set(['a100-146']);

const SCRIPT = fileURLToPath(new URL('./bin/sync.sh', import.meta.url));

function json(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: '/remote-hosts/sync',
    handler: (req, res) => {
      if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'POST only' });

      let body = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => { body += chunk; if (body.length > 4096) req.destroy(); });
      req.on('end', () => {
        let host = '';
        try { host = String(JSON.parse(body || '{}').host || ''); } catch { return json(res, 400, { ok: false, error: 'bad json' }); }
        if (!HOSTS.has(host)) return json(res, 400, { ok: false, error: 'unknown host: ' + host });

        execFile('sh', [SCRIPT, host, '--restart'], { timeout: 300000, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
          json(res, 200, {
            ok: !error,
            code: error && typeof error.code === 'number' ? error.code : 0,
            stdout: String(stdout || '').slice(-4000),
            stderr: String(stderr || '').slice(-2000),
          });
        });
      });
    },
  }));
}
