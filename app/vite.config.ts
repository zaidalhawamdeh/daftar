import preact from '@preact/preset-vite';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';

// Writes sw.js after the build with the exact list of built files, so the installed app opens and
// works with no network at all. A new build gets a new cache name; old caches are dropped.
function offline(): Plugin {
  return {
    name: 'daftar-offline',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = ['./', ...Object.keys(bundle).map((f) => `./${f}`), './manifest.webmanifest', './icon.svg'];
      const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 12);
      const source = `// Generated at build time. Cache-first for this app's own files; nothing else is fetched.
const CACHE = 'daftar-${version}';
const FILES = ${JSON.stringify(files)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
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
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
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
