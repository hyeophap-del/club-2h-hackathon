// 월간 달력 그리기
import { toDateKey, todayKey, esc } from './util.js';
import { findAllConflicts } from './schedule.js';

const WEEK_HEADER = ['일', '월', '화', '수', '목', '금', '토'];

// container: 달력을 그릴 요소, year/month(0~11), tasks: 할 일 배열
// onSelect(dateKey): 날짜 클릭 시 호출, selected: 선택된 날짜
export function renderMonth(container, { year, month, tasks, selected, onSelect }) {
  const byDate = {};
  for (const t of tasks) {
    if (!t.dueDate) continue;
    (byDate[t.dueDate] ||= []).push(t);
  }
  // 시간이 겹치는 일정이 있는 날짜 (칸에 ⚠ 표시)
  const conflicts = findAllConflicts(tasks);
  const conflictDays = new Set(tasks.filter((t) => conflicts.has(t.id)).map((t) => t.dueDate));

  const first = new Date(year, month, 1);
  const start = new Date(year, month, 1 - first.getDay()); // 첫 주 일요일
  const today = todayKey();

  let html = WEEK_HEADER.map((w, i) => `<div class="cal-head ${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${w}</div>`).join('');

  for (let i = 0; i < 42; i++) {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
    const key = toDateKey(d);
    const items = byDate[key] || [];
    const classes = ['cal-cell'];
    if (d.getMonth() !== month) classes.push('other');
    if (key === today) classes.push('today');
    if (key === selected) classes.push('selected');
    if (d.getDay() === 0) classes.push('sun');
    if (d.getDay() === 6) classes.push('sat');

    const chips = items
      .slice(0, 3)
      .map((t) => `<span class="chip ${t.kind ? 'c-' + t.kind : ''} ${t.done ? 'done' : ''}">${esc(t.title)}</span>`)
      .join('');
    const more = items.length > 3 ? `<span class="more">+${items.length - 3}</span>` : '';

    html += `<button type="button" class="${classes.join(' ')}" data-date="${key}">
      <span class="num">${d.getDate()}</span>${conflictDays.has(key) ? '<span class="cal-conflict" title="시간 겹침" aria-label="시간 겹침">⚠</span>' : ''}${chips}${more}</button>`;
  }

  container.innerHTML = html;
  container.querySelectorAll('.cal-cell').forEach((cell) => {
    cell.addEventListener('click', () => onSelect?.(cell.dataset.date));
  });
}
