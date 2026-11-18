// 알람: 페이지가 열려 있는 동안 주기적으로 확인해서 알림을 띄웁니다.
// (서버가 없으므로 탭이 닫혀 있으면 알림이 오지 않습니다 → .ics 내보내기로 보완)
import { REMINDER_CHECK_INTERVAL } from './config.js';
import { getSettings, getTasks, updateTask } from './storage.js';
import { toDate, formatDue, todayKey } from './util.js';

const STALE_MS = 12 * 60 * 60 * 1000; // 12시간 넘게 지난 알람은 조용히 넘김
const BRIEFING_KEY = 'lastBriefing';

export function notificationSupported() {
  return 'Notification' in window;
}

export async function requestPermission() {
  if (!notificationSupported()) return 'unsupported';
  return Notification.requestPermission();
}

// 할 일의 마감일로부터 알람 시각 목록 생성
export function buildReminders(dueDate, dueTime, departAt = null) {
  if (!dueDate) return [];
  const extra = [];
  if (departAt) {
    const t = new Date(departAt).getTime();
    extra.push({ at: new Date(t - 10 * 60000).toISOString(), notified: false, label: '출발 10분 전' });
    extra.push({ at: new Date(t).toISOString(), notified: false, label: '지금 출발하세요' });
  }
  const { remindDayBefore, remindMorningOf, morningHour } = getSettings();
  const hour = String(morningHour).padStart(2, '0') + ':00';
  const times = [];
  if (remindDayBefore) {
    const due = toDate(dueDate, dueTime || hour);
    times.push(new Date(due.getTime() - 24 * 60 * 60 * 1000));
  }
  if (remindMorningOf) {
    times.push(toDate(dueDate, hour));
  }
  if (dueTime) {
    const due = toDate(dueDate, dueTime);
    times.push(new Date(due.getTime() - 60 * 60 * 1000)); // 마감 1시간 전
  }
  const now = Date.now();
  const unique = [...new Set(times.map((t) => t.getTime()))].filter((t) => t > now).sort();
  return [
    ...unique.map((t) => ({ at: new Date(t).toISOString(), notified: false })),
    ...extra.filter((r) => new Date(r.at).getTime() > now),
  ].sort((a, b) => a.at.localeCompare(b.at));
}

export function showToast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 8000);
}

// 알림 띄우기. 안드로이드 크롬은 new Notification()을 지원하지 않아 서비스 워커로 띄웁니다.
export async function notifyUser(title, body, url, tag) {
  if (!notificationSupported() || Notification.permission !== 'granted') return false;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, tag, data: { url }, icon: 'icon.svg', badge: 'icon.svg' });
      return true;
    }
  } catch { /* 아래 방식으로 */ }
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => { window.focus(); location.href = url; };
    return true;
  } catch {
    return false;
  }
}

function fire(task, label) {
  const lines = [`마감: ${formatDue(task)}`];
  if (task.place) lines.push(`장소: ${task.place.name}`);
  if (task.items?.length) lines.push(`준비물: ${task.items.join(', ')}`);
  notifyUser(`${label ? `[${label}] ` : '할 일 알림: '}${task.title}`, lines.join('\n'), `calendar.html?date=${task.dueDate}`, task.id + (label || ''));
  showToast(`🔔 ${label ? `[${label}] ` : ''}${task.title} (${formatDue(task)})`);
}

export function checkReminders() {
  const now = Date.now();
  for (const task of getTasks()) {
    if (task.done || !task.reminders?.length) continue;
    let changed = false;
    let fireLabel; // undefined = 발송 안 함
    const reminders = task.reminders.map((r) => {
      if (r.notified || new Date(r.at).getTime() > now) return r;
      changed = true;
      if (now - new Date(r.at).getTime() < STALE_MS) fireLabel = r.label || '';
      return { ...r, notified: true };
    });
    if (changed) {
      updateTask(task.id, { reminders });
      if (fireLabel !== undefined) fire(task, fireLabel);
    }
  }
}

// 아침 브리핑: 설정한 아침 시각이 지나면 하루 한 번 "오늘 할 일 + 날씨"를 알려줌 (정오 이후엔 생략)
async function checkMorningBriefing() {
  const { morningBriefing, morningHour } = getSettings();
  const now = new Date();
  const today = todayKey();
  if (!morningBriefing || now.getHours() < morningHour || now.getHours() >= 12) return;
  let last = null;
  try { last = localStorage.getItem(BRIEFING_KEY); } catch { /* 무시 */ }
  if (last === today) return;
  try { localStorage.setItem(BRIEFING_KEY, today); } catch { /* 무시 */ }

  const todays = getTasks().filter((t) => !t.done && t.dueDate === today);
  let weatherLine = '';
  try {
    const { getCurrentWeather, adviceFor } = await import('./agents/weatherAgent.js');
    const w = await getCurrentWeather();
    const tips = adviceFor(w.today);
    const air = w.air || w.today.air;
    weatherLine = `${w.icon} ${w.text} ${w.today.min}~${w.today.max}℃, 강수 ${w.today.rain}%${air ? `, 미세먼지 ${air.grade}` : ''}${tips.length ? ' · ' + tips[0] : ''}`;
  } catch { /* 날씨 없이 */ }
  const taskLine = todays.length
    ? `오늘 할 일 ${todays.length}건: ${todays.map((t) => t.title).slice(0, 3).join(', ')}`
    : '오늘 마감인 할 일은 없습니다.';
  const body = [weatherLine, taskLine].filter(Boolean).join('\n');
  notifyUser('☀️ 오늘의 브리핑', body, 'index.html', 'briefing');
  showToast(`☀️ ${taskLine}`);
}

export function startReminderLoop() {
  const tick = () => {
    checkReminders();
    checkMorningBriefing();
  };
  tick();
  setInterval(tick, REMINDER_CHECK_INTERVAL);
}
