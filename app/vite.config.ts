import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Writes sw.js once every built file is on disk, with the exact list of files, so the installed app
// opens and works with no network at all. The cache name is a hash of every file's content
// (index.html, manifest and icon included), so any change reaches installed copies.
function offline(): Plugin {
  return {
    name: 'daftar-offline',
    apply: 'build',
    writeBundle(options) {
      const dir = options.dir!;
      const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
      const paths = walk(dir).map((f) => relative(dir, f).split('\\').join('/')).filter((f) => f !== 'sw.js').sort();
      const hash = createHash('sha256');
      for (const f of paths) hash.update(f).update('\0').update(readFileSync(join(dir, f))).update('\0');
      const version = hash.digest('hex').slice(0, 12);
      const files = ['./', ...paths.map((f) => `./${f}`)];
      // The hashed files this build's index.html loads. A fetched page that does not name them all
      // is an older copy (an HTTP or CDN cache), and installing it would strand the app blank.
      const required = [...new Set(readFileSync(join(dir, 'index.html'), 'utf8').match(/assets\/[^"'\s)]+/g) ?? [])];
      const source = `// Generated at build time. Cache-first for this app's own files; nothing else is fetched.
const CACHE = 'daftar-${version}';
const FILES = ${JSON.stringify(files)};
const REQUIRED = ${JSON.stringify(required)};
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    // Straight from the server, never from the browser's HTTP cache.
    const got = await Promise.all(FILES.map(async (f) => {
      const res = await fetch(new Request(f, { cache: 'reload' }));
      if (!res.ok) throw new Error(f + ' ' + res.status);
      return [f, res];
    }));
    const index = await got[0][1].clone().text();
    if (!REQUIRED.every((a) => index.includes(a))) throw new Error('index.html is from another version; not installing');
    const cache = await caches.open(CACHE);
    await Promise.all(got.map(([f, res]) => cache.put(f, res)));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('daftar-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match('./', { ignoreVary: true }).then((index) => index || fetch(req));
      return fetch(req);
    }),
  );
});
`;
      writeFileSync(join(dir, 'sw.js'), source);
    },
  };
}

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [preact(), offline()],
  server: { port: 5178, strictPort: true, fs: { allow: ['..'] } },
  build: { outDir: '../dist', emptyOutDir: true },
});
