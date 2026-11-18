// 모든 페이지 공통: 상단 메뉴, 마감 임박 배너, 알람 루프, 앱 설치(PWA) 준비
import { getTasks, getSettings } from './storage.js';
import { startReminderLoop } from './notify.js';
import { daysLeft, esc } from './util.js';

const LINKS = [
  { href: 'index.html', label: '홈', icon: '🏠' },
  { href: 'upload.html', label: '올리기', icon: '📷' },
  { href: 'calendar.html', label: '캘린더', icon: '📅' },
  { href: 'docs.html', label: '문서함', icon: '🗂️' },
  { href: 'settings.html', label: '설정', icon: '⚙️' },
];

function setupPwa() {
  const head = document.head;
  if (!head.querySelector('link[rel="manifest"]')) {
    head.insertAdjacentHTML('beforeend', `
      <link rel="manifest" href="manifest.webmanifest" />
      <link rel="icon" href="icon.svg" type="image/svg+xml" />
      <link rel="apple-touch-icon" href="icon.svg" />
      <meta name="theme-color" content="#4f46e5" />
      <meta name="apple-mobile-web-app-capable" content="yes" />`);
  }
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 지원 안 되는 환경 */ });
  }
}

export function initPage(active) {
  setupPwa();

  const header = document.createElement('header');
  header.className = 'topbar';
  header.innerHTML = `
    <a class="brand" href="index.html">📄 문서 비서</a>
    <nav>${LINKS.map(
      (l) => `<a href="${l.href}" class="${l.href === active ? 'active' : ''}"><span class="nav-icon">${l.icon}</span>${l.label}</a>`
    ).join('')}</nav>`;
  document.body.prepend(header);

  renderDueBanner(header);

  if (!getSettings().apiKey && !['settings.html', 'index.html'].includes(active)) {
    const warn = document.createElement('div');
    warn.className = 'banner warn';
    warn.innerHTML = 'Gemini API 키가 없어 실제 분석은 할 수 없습니다. <a href="settings.html">설정</a>하거나 예시로 체험해 보세요.';
    header.after(warn);
  }

  startReminderLoop();
}

function renderDueBanner(header) {
  const urgent = getTasks().filter((t) => !t.done && t.dueDate && daysLeft(t.dueDate) >= 0 && daysLeft(t.dueDate) <= 1);
  if (!urgent.length) return;
  const banner = document.createElement('div');
  banner.className = 'banner urgent';
  const names = urgent.slice(0, 3).map((t) => esc(t.title)).join(', ');
  banner.innerHTML = `⏰ 오늘·내일 ${urgent.length}건: ${names}${urgent.length > 3 ? ' 외' : ''}
    <a href="index.html#briefing-section">브리핑 보기</a>`;
  header.after(banner);
  document.title = `(${urgent.length}) ${document.title}`;
}
