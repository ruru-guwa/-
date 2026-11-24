/* オフラインでも開けるように、しおりのファイルを端末に保存する */
const CACHE = "sh2026-v3";
const FILES = [
  "./", "./index.html", "./css/fonts.css", "./css/icons.css", "./fonts/phosphor/Phosphor.woff2", "./fonts/outfit-latin.woff2", "./css/style.css", "./js/data.js", "./js/app.js",
  "./manifest.webmanifest", "./icons/icon.svg", "./icons/icon-180.png", "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

// フォント（Zen Kaku Gothic New）は文字ごとに分かれた小さなファイルなので、
// 古いキャッシュを消したあと、裏で全部を保存しておく（中国で電波がなくても同じ見た目になる）
async function cacheFonts() {
  try {
    const c = await caches.open(CACHE);
    const css = await (await fetch("./css/fonts.css")).text();
    const urls = [...new Set([...css.matchAll(/url\((\.\.\/fonts\/[^)]+)\)/g)].map((m) => new URL(m[1], new URL("./css/", self.registration.scope)).href))];
    for (const u of urls) { if (!(await c.match(u))) { try { await c.add(u); } catch {} } }
  } catch {}
}

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(cacheFonts)
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  const isFont = e.request.url.includes("/fonts/");
  if (isFont) { // フォントは変わらないので、保存済みのものを優先
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })));
    return;
  }
  // それ以外は、通信できるときは最新を取りにいき、できないときは保存したものを使う
  e.respondWith(
    fetch(e.request)
      .then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
  );
});
