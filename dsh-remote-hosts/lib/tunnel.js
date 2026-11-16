import net from 'node:net';

// Ask the OS for a free loopback port. Tunnel forwards and proxies both bind
// local ports; the caller keeps the returned port for its lifetime.
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
