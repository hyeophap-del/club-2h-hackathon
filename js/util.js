// 여러 파일에서 함께 쓰는 작은 도우미 함수들

// HTML에 넣기 전 특수문자 이스케이프 (AI 응답을 그대로 innerHTML에 넣지 않기 위해)
export function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// Date -> 'YYYY-MM-DD' (브라우저 로컬 시간 기준)
export function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function todayKey() {
  return toDateKey(new Date());
}

// 'YYYY-MM-DD' + 'HH:MM' -> Date (로컬 시간)
export function toDate(dateKey, time = '00:00') {
  const [y, m, d] = dateKey.split('-').map(Number);
  const [hh, mm] = (time || '00:00').split(':').map(Number);
  return new Date(y, m - 1, d, hh, mm);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function formatDue(task) {
  if (!task.dueDate) return '날짜 없음';
  const d = toDate(task.dueDate);
  const label = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
  return task.dueTime ? `${label} ${task.dueTime}` : label;
}

export function weekdayName(date) {
  return WEEKDAYS[date.getDay()];
}

// 오늘 기준 며칠 남았는지 (0 = 오늘, 음수 = 지남)
export function daysLeft(dateKey) {
  const today = toDate(todayKey());
  const due = toDate(dateKey);
  return Math.round((due - today) / 86400000);
}

export function dDayLabel(dateKey) {
  if (!dateKey) return '';
  const n = daysLeft(dateKey);
  if (n === 0) return 'D-DAY';
  return n > 0 ? `D-${n}` : `D+${-n}`;
}
