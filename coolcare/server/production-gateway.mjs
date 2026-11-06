import { createServer, request } from 'node:http';

// Both portals and /api share one public origin. Internal ports never reach the browser.
export function createProductionGateway({ origin, apiPort, webPort }) {
  const publicUrl = new URL(origin);
  return createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end('{"running":true}');
    }
    if (req.headers.host?.toLowerCase() !== publicUrl.host.toLowerCase()) {
      res.writeHead(403);
      return res.end('Untrusted request host.');
    }
    const pathname = req.url.split('?')[0];
    const isApi = pathname === '/api' || pathname.startsWith('/api/');
    const headers = { ...req.headers,
      host: publicUrl.host,
      'x-forwarded-host': publicUrl.host,
      'x-forwarded-proto': publicUrl.protocol.slice(0, -1),
      // Replace client-supplied forwarding headers at this local proxy boundary.
      'x-forwarded-for': req.socket.remoteAddress,
    };
    delete headers.forwarded;
    delete headers['x-real-ip'];
    const upstream = request({ hostname: '127.0.0.1', port: isApi ? apiPort : webPort,
      path: req.url, method: req.method, headers }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.on('error', () => res.destroy());
      response.pipe(res);
    });
    upstream.on('error', () => {
      if (res.headersSent) return res.destroy();
      res.writeHead(503, { 'Content-Type': 'text/plain', 'Retry-After': '5' });
      res.end('Service is starting. Please retry shortly.');
    });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => { if (!res.writableFinished) upstream.destroy(); });
    req.pipe(upstream);
  });
}
