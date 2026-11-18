// .ics(아이캘린더) 내보내기 — 휴대폰 기본 캘린더로 옮기면 웹을 닫아도 휴대폰이 알람을 울립니다.
import { toDate } from './util.js';

function pad(n) { return String(n).padStart(2, '0'); }

function fmtLocal(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
}
function fmtDate(d) {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}
function escText(s) {
  return String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m);
}
// 한 줄 75바이트 제한 (간단히 글자 수 기준으로 접기)
function fold(line) {
  const out = [];
  for (let i = 0; i < line.length; i += 60) out.push((i ? ' ' : '') + line.slice(i, i + 60));
  return out.join('\r\n');
}

function eventFor(task) {
  const lines = ['BEGIN:VEVENT', `UID:${task.id}@doc-assistant`, `DTSTAMP:${fmtLocal(new Date())}`];
  if (task.dueTime) {
    const start = toDate(task.dueDate, task.dueTime);
    lines.push(`DTSTART;TZID=Asia/Seoul:${fmtLocal(start)}`);
    lines.push(`DTEND;TZID=Asia/Seoul:${fmtLocal(new Date(start.getTime() + 60 * 60000))}`);
  } else {
    const d = toDate(task.dueDate);
    lines.push(`DTSTART;VALUE=DATE:${fmtDate(d)}`);
    lines.push(`DTEND;VALUE=DATE:${fmtDate(new Date(d.getTime() + 86400000))}`);
  }
  lines.push(`SUMMARY:${escText(task.title)}`);
  const desc = [task.description, task.items?.length ? `준비물: ${task.items.join(', ')}` : '', task.travel?.departAt ? `출발: ${new Date(task.travel.departAt).toTimeString().slice(0, 5)}` : '']
    .filter(Boolean).join('\n');
  if (desc) lines.push(`DESCRIPTION:${escText(desc)}`);
  if (task.place || task.location) lines.push(`LOCATION:${escText(task.place ? `${task.place.name} ${task.place.address}` : task.location)}`);
  for (const r of task.reminders || []) {
    if (r.notified) continue;
    lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escText(r.label || task.title)}`,
      `TRIGGER;VALUE=DATE-TIME:${new Date(r.at).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`, 'END:VALARM');
  }
  lines.push('END:VEVENT');
  return lines;
}

export function buildIcs(tasks) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//doc-assistant//KO', 'CALSCALE:GREGORIAN',
    'BEGIN:VTIMEZONE', 'TZID:Asia/Seoul', 'BEGIN:STANDARD', 'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:KST', 'END:STANDARD', 'END:VTIMEZONE',
    ...tasks.filter((t) => t.dueDate).flatMap(eventFor),
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n');
}

export function downloadIcs(tasks, name = '할일') {
  const blob = new Blob([buildIcs(tasks)], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
