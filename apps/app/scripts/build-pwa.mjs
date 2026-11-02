import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
const root = new URL("../dist/", import.meta.url);
let html = await readFile(new URL("index.html", root), "utf8");
html = html.replace(/<title>.*?<\/title>/, "<title>Audio Angel</title>");
html = html.replace(
  "</head>",
  '<link rel="manifest" href="/manifest.json"/><meta name="theme-color" content="#0a0a0a"/><meta name="description" content="A music player with listening profiles. Demo preview."/><link rel="apple-touch-icon" href="/icon-192.png"/></head>',
);
await writeFile(new URL("index.html", root), html);
async function collect(dir) {
  const paths = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) paths.push(...(await collect(p)));
    else paths.push(p);
  }
  return paths;
}
const files = await collect(root.pathname);
// Only build-owned shell assets. No API data, Spotify requests, tokens or lyrics.
const assets = files
  .filter(
    (p) =>
      /\.(html|js|css|ttf|woff2|png|ico|json)$/.test(p) && !p.endsWith("sw.js"),
  )
  .map((p) => "/" + relative(root.pathname, p).split("\\").join("/"));
const version = createHash("sha256")
  .update(html + assets.join(""))
  .digest("hex")
  .slice(0, 12);
const source = `const CACHE = 'audio-angel-shell-${version}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('audio-angel-shell-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
 const url = new URL(event.request.url);
 if (event.request.method !== 'GET' || url.origin !== self.location.origin || event.request.headers.has('authorization') || url.pathname.startsWith('/api/') || url.pathname === '/health' || url.pathname.startsWith('/auth/')) return;
 if (event.request.mode === 'navigate') { event.respondWith(fetch(event.request).catch(() => caches.match('/index.html'))); return; }
 if (!ASSETS.includes(url.pathname)) return;
 event.respondWith(caches.open(CACHE).then(cache => cache.match(url.pathname)).then(cached => cached || fetch(event.request)));
});`;
await writeFile(new URL("sw.js", root), source);
console.log(`PWA shell generated: ${assets.length} assets, ${version}`);
