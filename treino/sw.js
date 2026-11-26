/* Service worker da Ficha de Treino.
   1) Agenda a notificação de fim do descanso, que aparece mesmo com o app em segundo plano.
   2) Guarda o app e as fotos em cache para abrir sem internet na academia. */
const CACHE = 'ficha-treino-v8';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Rede primeiro para o HTML (pega atualizações), cache primeiro para o resto.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !isFont) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put('./index.html', copy)); return res; })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok || res.type === 'opaque') { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});

/* ---- Descanso ---- */
let pending = null; // { timer, resolve }

function cancelPending() {
  if (pending) { clearTimeout(pending.timer); pending.resolve(); pending = null; }
}

// Cada repetição do aviso (mesma tag, renotify) faz o Android vibrar de novo.
// O Android ignora padrões de vibração enviados pelo site, então repetir é o jeito de alongar o alerta.
const REPEAT_GAP = 2200;
let stopRepeat = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function appOnScreen() {
  const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  return wins.some((w) => w.visibilityState === 'visible' && w.focused);
}

async function show(d) {
  if (!d.force && await appOnScreen()) return; // com o app na tela, a própria página avisa
  stopRepeat = false;
  const n = Math.max(1, Math.min(5, d.repeat || 3));
  for (let k = 0; k < n; k++) {
    if (k > 0) {
      await sleep(REPEAT_GAP);
      if (stopRepeat || (!d.force && await appOnScreen())) break;
    }
    await self.registration.showNotification(d.title || 'Descanso encerrado', {
      body: d.body || 'Hora da próxima série',
      tag: 'descanso',
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [1200, 200, 1200, 200, 1200],
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      timestamp: Date.now(),
      data: { url: self.registration.scope }
    });
  }
}

self.addEventListener('notificationclose', () => { stopRepeat = true; });

self.addEventListener('message', (e) => {
  const d = e.data || {};
  if (d.type === 'cancel') { cancelPending(); stopRepeat = true; return; }
  if (d.type !== 'schedule') return;
  cancelPending();
  const delay = Math.max(0, (d.at || 0) - Date.now());
  // waitUntil mantém o service worker vivo até o descanso acabar.
  e.waitUntil(new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending = null;
      show(d).catch(() => {}).finally(resolve);
    }, delay);
    pending = { timer, resolve };
  }));
});

self.addEventListener('notificationclick', (e) => {
  stopRepeat = true;
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
      for (const w of wins) { if ('focus' in w) return w.focus(); }
      return self.clients.openWindow((e.notification.data && e.notification.data.url) || './');
    })
  );
});
