import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE_HOST = '127.0.0.1';
export const DEFAULT_FIXTURE_PORT = 4173;

const fixtureDirectory = dirname(fileURLToPath(import.meta.url));
const siteDirectory = join(fixtureDirectory, 'site');
const fileCache = new Map();

const rasterBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

const emptyZipBytes = Buffer.from([
  0x50, 0x4b, 0x05, 0x06, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

const pdfBytes = Buffer.from(`%PDF-1.4
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj
2 0 obj
<< /Type /Pages /Kids [] /Count 0 >>
endobj
xref
0 3
0000000000 65535 f\x20
0000000009 00000 n\x20
0000000058 00000 n\x20
trailer
<< /Root 1 0 R /Size 3 >>
startxref
110
%%EOF
`);

const spaRoutes = new Set(['/', '/about', '/contact', '/search', '/work', '/work/case-study']);

const staticResources = new Map([
  ['/assets/app.js', ['assets/app.js', 'text/javascript; charset=utf-8']],
  ['/assets/app.js.map', ['assets/app.js.map', 'application/json; charset=utf-8']],
  ['/assets/favicon.svg', ['assets/favicon.svg', 'image/svg+xml; charset=utf-8']],
  ['/assets/illustration.svg', ['assets/illustration.svg', 'image/svg+xml; charset=utf-8']],
  ['/assets/styles.css', ['assets/styles.css', 'text/css; charset=utf-8']],
  ['/content/routes.json', ['pages/routes.json', 'application/json; charset=utf-8']],
  ['/site.webmanifest', ['site.webmanifest', 'application/manifest+json; charset=utf-8']],
]);

const lazyPayload = Object.freeze({
  eyebrow: 'Loaded at the boundary',
  title: 'The bottom of the page arrived only after scrolling.',
  copy: 'This section is fetched through a same-origin JSON endpoint when its IntersectionObserver becomes visible. It should appear exactly once and expand the rendered document height.',
});

function normalizeRoutePath(pathname) {
  if (pathname === '/') return pathname;
  return pathname.replace(/\/+$/, '') || '/';
}

function parsePort(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_FIXTURE_PORT;

  const port = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new RangeError(
      `SITEPULL_FIXTURE_PORT must be an integer from 0 to 65535; received ${String(value)}`,
    );
  }
  return port;
}

function cachedFile(relativePath) {
  let pending = fileCache.get(relativePath);
  if (!pending) {
    pending = readFile(join(siteDirectory, relativePath));
    fileCache.set(relativePath, pending);
  }
  return pending;
}

async function fontBytes() {
  const encoded = (await cachedFile('assets/fixture.woff2.base64'))
    .toString('ascii')
    .replace(/\s+/g, '');
  return Buffer.from(encoded, 'base64');
}

function bodyBuffer(body) {
  if (Buffer.isBuffer(body)) return body;
  return Buffer.from(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
}

function send(request, response, statusCode, body, contentType, extraHeaders = {}) {
  const bytes = bodyBuffer(body);
  const digest = createHash('sha256').update(bytes).digest('hex');

  response.sendDate = false;
  response.statusCode = statusCode;
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Length', String(bytes.byteLength));
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; connect-src 'self'; font-src 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  );
  response.setHeader('Content-Type', contentType);
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  response.setHeader('ETag', `"sha256-${digest}"`);
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Sitepull-Fixture', 'deterministic-loopback');

  for (const [name, value] of Object.entries(extraHeaders)) response.setHeader(name, value);

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  response.end(bytes);
}

function sendJson(request, response, statusCode, value) {
  send(request, response, statusCode, value, 'application/json; charset=utf-8');
}

function notFoundPage() {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>Not found · Fixture Atelier</title></head>
  <body><main><h1>Intentional fixture 404</h1><p>This path is not part of the SPA route set.</p></main></body>
</html>`;
}

async function handleRequest(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    send(request, response, 405, 'Method not allowed\n', 'text/plain; charset=utf-8', {
      Allow: 'GET, HEAD',
    });
    return;
  }

  let url;
  try {
    url = new URL(request.url ?? '/', `http://${FIXTURE_HOST}`);
  } catch {
    send(request, response, 400, 'Malformed request URL\n', 'text/plain; charset=utf-8');
    return;
  }

  if (url.pathname === '/api/lazy') {
    sendJson(request, response, 200, {
      ...lazyPayload,
      route: normalizeRoutePath(url.searchParams.get('route') ?? '/'),
    });
    return;
  }

  if (url.pathname === '/api/design-tokens') {
    sendJson(request, response, 200, {
      colors: ['canvas', 'surface', 'ink', 'muted', 'cobalt', 'coral', 'moss', 'violet', 'amber'],
      radii: ['sm', 'md', 'lg'],
      shadows: ['card', 'float'],
      spacingSteps: 8,
    });
    return;
  }

  if (url.pathname === '/assets/checker-a.png' || url.pathname === '/assets/checker-b.png') {
    send(request, response, 200, rasterBytes, 'image/png');
    return;
  }

  if (url.pathname === '/assets/fixture.woff2') {
    send(request, response, 200, await fontBytes(), 'font/woff2');
    return;
  }

  if (url.pathname === '/assets/fixture-archive.zip') {
    send(request, response, 200, emptyZipBytes, 'application/zip', {
      'Content-Disposition': 'attachment; filename="fixture-archive.zip"',
    });
    return;
  }

  if (url.pathname === '/downloads/sitepull-fixture.pdf') {
    send(request, response, 200, pdfBytes, 'application/pdf', {
      'Content-Disposition': 'attachment; filename="sitepull-fixture.pdf"',
    });
    return;
  }

  if (url.pathname === '/fixture-source/app.original.js') {
    send(
      request,
      response,
      200,
      '// Deterministic source-map fixture for Sitepull.\n',
      'text/javascript; charset=utf-8',
    );
    return;
  }

  if (url.pathname === '/robots.txt') {
    send(
      request,
      response,
      200,
      'User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n',
      'text/plain; charset=utf-8',
    );
    return;
  }

  if (url.pathname === '/sitemap.xml') {
    const requestAuthority =
      typeof request.headers.host === 'string' &&
      /^127\.0\.0\.1(?::\d{1,5})?$/.test(request.headers.host)
        ? request.headers.host
        : FIXTURE_HOST;
    const routeEntries = [...spaRoutes]
      .filter((route) => route !== '/search')
      .map((route) => `<url><loc>http://${requestAuthority}${route}</loc></url>`)
      .join('');
    send(
      request,
      response,
      200,
      `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${routeEntries}</urlset>`,
      'application/xml; charset=utf-8',
    );
    return;
  }

  const staticResource = staticResources.get(url.pathname);
  if (staticResource) {
    const [relativePath, contentType] = staticResource;
    send(request, response, 200, await cachedFile(relativePath), contentType);
    return;
  }

  if (spaRoutes.has(normalizeRoutePath(url.pathname))) {
    send(request, response, 200, await cachedFile('index.html'), 'text/html; charset=utf-8');
    return;
  }

  send(request, response, 404, notFoundPage(), 'text/html; charset=utf-8');
}

export function createFixtureServer() {
  const server = createServer((request, response) => {
    void handleRequest(request, response).catch((error) => {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      send(request, response, 500, 'Fixture server error\n', 'text/plain; charset=utf-8');
      console.error(error);
    });
  });

  server.keepAliveTimeout = 1_000;
  server.requestTimeout = 10_000;
  return server;
}

export async function startFixtureServer(options = {}) {
  const port = parsePort(options.port ?? process.env.SITEPULL_FIXTURE_PORT);
  const server = createFixtureServer();

  await new Promise((resolveListening, rejectListening) => {
    const onError = (error) => {
      server.off('listening', onListening);
      rejectListening(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListening();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, FIXTURE_HOST);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Fixture server did not expose a TCP address');
  }

  const url = `http://${FIXTURE_HOST}:${address.port}`;
  if (options.log !== false) console.log(`SITEPULL_FIXTURE_URL=${url}`);

  let closePromise;
  const close = () => {
    closePromise ??= new Promise((resolveClose, rejectClose) => {
      if (!server.listening) {
        resolveClose();
        return;
      }

      server.close((error) => {
        if (error) rejectClose(error);
        else resolveClose();
      });
      server.closeIdleConnections?.();
    });
    return closePromise;
  };

  return {
    close,
    host: FIXTURE_HOST,
    port: address.port,
    server,
    url,
  };
}

export const start = startFixtureServer;

async function runFromCommandLine() {
  const fixture = await startFixtureServer();
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`SITEPULL_FIXTURE_SHUTDOWN=${signal}`);
    try {
      await fixture.close();
    } catch (error) {
      console.error(error);
      process.exitCode = 1;
    }
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runFromCommandLine().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
