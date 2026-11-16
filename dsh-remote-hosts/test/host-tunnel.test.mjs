import test from 'node:test';
import assert from 'node:assert/strict';
import { HostTunnel } from '../lib/host-tunnel.js';

test('forwards update in place and keep an auto port stable', () => {
  const tunnel = new HostTunnel({ sshHost: 'demo' });
  assert.equal(tunnel.setForwards([{ id: 'a', remotePort: 1, localPort: 0 }], []), true);
  assert.equal(tunnel.setForwards([{ id: 'a', remotePort: 1, localPort: 0 }], []), false);
  tunnel.forwards.get('a').localPort = 40000;
  assert.equal(tunnel.setForwards([{ id: 'a', remotePort: 1, localPort: 0 }], []), false);
  assert.equal(tunnel.localPortFor('a'), 40000);
  assert.equal(tunnel.setForwards([{ id: 'a', remotePort: 1, localPort: 41000 }], []), true);
  assert.equal(tunnel.localPortFor('a'), 41000);
  assert.equal(tunnel.setForwards([{ id: 'a', remotePort: 1, localPort: 0 }], []), true);
  assert.equal(tunnel.localPortFor('a'), 0);
  assert.equal(tunnel.setForwards([{ id: 'a', remotePort: 2, localPort: 0 }], []), true);
  assert.equal(tunnel.setForwards([{ id: 'a', remotePort: 2, localPort: 0 }], []), false);
  assert.equal(tunnel.setForwards([{ id: 'a', remotePort: 2, localPort: 0 }], ['Port=2222']), true);
  assert.equal(tunnel.setForwards([{ id: 'a', remotePort: 2, localPort: 0 }], ['Port=2222']), false);
  assert.equal(tunnel.setForwards([], ['Port=2222']), true);
  assert.equal(tunnel.localPortFor('a'), 0);
});
