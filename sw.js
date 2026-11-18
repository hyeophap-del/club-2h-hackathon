// 서비스 워커: 홈 화면에 설치(PWA), 오프라인에서도 화면 열기, 알림 클릭 처리
const CACHE = 'doc-assistant-v6';
const ASSETS = [
  './', 'index.html', 'upload.html', 'calendar.html', 'docs.html', 'settings.html',
  'css/style.css', 'icon.svg', 'manifest.webmanifest',
  'js/config.js', 'js/util.js', 'js/storage.js', 'js/image.js', 'js/calendar.js', 'js/notify.js', 'js/nav.js',
  'js/archive.js', 'js/ics.js', 'js/demo.js', 'js/cornerEditor.js', 'js/intake.js',
  'js/agents/orchestrator.js', 'js/agents/analyzeAgent.js', 'js/agents/scanAgent.js',
  'js/agents/weatherAgent.js', 'js/agents/routeAgent.js',
  'js/agents/localAnalyzer.js', 'js/agents/validateResult.js', 'js/dates.js', 'js/schedule.js', // 키 없는 간단 분석 (Tesseract·OpenCV는 CDN이라 캐시 안 함)
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 우리 사이트 파일은 "네트워크 먼저, 실패하면 캐시" (수정 사항이 바로 보이도록)
// 외부 API(Gemini, 카카오, 날씨)는 건드리지 않음
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = new URL(e.notification.data?.url || 'index.html', self.registration.scope).href;
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      if (open) return open.navigate(target).then((c) => c && c.focus());
      return self.clients.openWindow(target);
    })
  );
});
