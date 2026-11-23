import { createReadStream, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { type Plugin, defineConfig } from 'vite';

const DATA = resolve(__dirname, 'data');

/**
 * Serves ./data (terrain pmtiles, OSM tiles) under /data with HTTP range support, which
 * the pmtiles reader needs. The data stays out of the build output; host it next to it.
 */
function serveData(): Plugin {
  const handler = (
    req: { url?: string; headers: Record<string, string | string[] | undefined> },
    res: import('node:http').ServerResponse,
    next: () => void,
  ): void => {
    const url = req.url?.split('?')[0] ?? '';
    if (!url.startsWith('/data/')) {
      next();
      return;
    }
    const path = resolve(DATA, decodeURIComponent(url.slice('/data/'.length)));
    if (!path.startsWith(DATA + sep)) {
      res.statusCode = 403;
      res.end();
      return;
    }
    let size: number;
    try {
      const stat = statSync(path);
      if (!stat.isFile()) throw new Error('not a file');
      size = stat.size;
    } catch {
      res.statusCode = 404;
      res.end();
      return;
    }
    const type = path.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    res.setHeader('Content-Type', type);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'no-cache');
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
      if (start > end || start >= size) {
        res.statusCode = 416;
        res.setHeader('Content-Range', `bytes */${size}`);
        res.end();
        return;
      }
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
      res.setHeader('Content-Length', String(end - start + 1));
      createReadStream(path, { start, end }).pipe(res);
      return;
    }
    res.setHeader('Content-Length', String(size));
    createReadStream(path).pipe(res);
  };
  return {
    name: 'serve-data',
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [serveData()],
  server: { port: 5175, strictPort: true, host: true },
  preview: { port: 4175, strictPort: true, host: true },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
