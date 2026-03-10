// ============================================================
// Service Worker — Push通知専用（キャッシュ制御なし）
// ============================================================

// install: 即座に activate へ移行
self.addEventListener('install', () => {
    self.skipWaiting();
});

// activate: このアプリの旧キャッシュのみ削除（他アプリのキャッシュには触れない）
const OWN_CACHE_PREFIX = 'pocket-yasunobu-';
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((names) =>
            Promise.all(
                names
                    .filter((name) => name.startsWith(OWN_CACHE_PREFIX))
                    .map((name) => caches.delete(name))
            )
        )
    );
    self.clients.claim();
});

// SKIP_WAITING メッセージ受信時に即座に activate
self.addEventListener('message', (event) => {
    if (event.data?.type === 'SKIP_WAITING') {
        self.skipWaiting();
    }
});
