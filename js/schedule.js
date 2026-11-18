// 일정 시간 겹침(충돌) 찾기
// 팀원 may0ne2e의 sex-extract 브랜치 구현을 참고/이식 (conflictsFor: 1시간 가정, 이동 시간 부족 안내)
// 화면·저장소를 건드리지 않는 순수 함수만 둡니다 (Node 테스트: tests/schedule.test.js).
import { toDate } from './util.js';

// 일정이 끝나는 시각은 문서에 거의 없으므로 1시간으로 가정 (원작과 같음)
export const ASSUMED_MINUTES = 60;
const MIN = 60000;
const DAY = 86400000;

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/* ---------- 시간 겹침 ---------- */
// 할 일이 실제로 시간을 차지하는 구간 [start, end) (ms). 시간을 차지하지 않으면 null.
// - 시간을 차지하는 것: '참석(event)' 종류, 또는 이동(travel)이 있는 할 일
//   (마감·회신·납부·준비·단계는 "그때까지 하면 되는 일"이라 다른 일정과 겹친다고 보지 않음)
// - 시간이 있으면: 출발 시각(travel.departAt, 없으면 시작 시각) ~ 시작 + 60분
// - 시간이 없는 참석 일정(종일): 그날 하루 전체 → 같은 날의 다른 참석 일정과 겹침
// - 끝낸 할 일은 제외
export function windowOf(task) {
  if (!task || task.done || !task.dueDate) return null;
  const occupies = task.kind === 'event' || !!task.travel?.minutes;
  if (!occupies) return null;
  if (!task.dueTime) {
    if (task.kind !== 'event') return null;
    const s = toDate(task.dueDate).getTime();
    return { start: s, end: s + DAY, allDay: true, begin: s };
  }
  const begin = toDate(task.dueDate, task.dueTime).getTime();
  const depart = task.travel?.departAt ? new Date(task.travel.departAt).getTime() : NaN;
  const start = Number.isFinite(depart) && depart < begin ? depart : begin;
  return { start, end: begin + ASSUMED_MINUTES * MIN, allDay: false, begin };
}

function overlaps(a, b) {
  return a.start < b.end && b.start < a.end;
}

const same = (a, b) => a === b || (a.id != null && a.id === b.id);

// task와 시간이 겹치는 다른 할 일 목록 (시작 순)
export function conflictsFor(task, allTasks = []) {
  const w = windowOf(task);
  if (!w) return [];
  return allTasks
    .filter((o) => !same(o, task))
    .filter((o) => { const ow = windowOf(o); return ow && overlaps(w, ow); })
    .sort((a, b) => windowOf(a).begin - windowOf(b).begin);
}

// 모든 할 일의 겹침: Map(id → 겹치는 할 일 배열). 겹침이 없는 할 일은 들어가지 않음.
export function findAllConflicts(tasks = []) {
  const out = new Map();
  const timed = tasks.map((t) => ({ t, w: windowOf(t) })).filter((x) => x.w);
  for (let i = 0; i < timed.length; i++) {
    for (let j = i + 1; j < timed.length; j++) {
      const a = timed[i], b = timed[j];
      if (!overlaps(a.w, b.w)) continue;
      (out.get(a.t.id) || out.set(a.t.id, []).get(a.t.id)).push(b.t);
      (out.get(b.t.id) || out.set(b.t.id, []).get(b.t.id)).push(a.t);
    }
  }
  return out;
}

// 업로드 화면용: 새로 뽑은 할 일(draft) 하나하나가 이미 저장된 할 일과 겹치는지
// → draftTasks와 같은 길이의 배열, 각 칸은 겹치는 기존 할 일 배열
export function conflictsWithExisting(draftTasks = [], existingTasks = []) {
  return draftTasks.map((d) => conflictsFor(d, existingTasks));
}

// 겹침을 한 줄로 설명 (원작의 "이동 시간이 N분 부족해요" 안내를 따름)
export function describeConflict(task, other) {
  const w = windowOf(task), ow = windowOf(other);
  if (!w || !ow) return '';
  const name = `“${other.title}”`;
  if (w.allDay || ow.allDay) return `${name}과 같은 날 일정이에요.`;
  if (w.begin === ow.begin) return `${name}과 같은 시간(${hhmm(new Date(w.begin))})에 시작해요.`;
  if (ow.begin < w.begin) {
    // 앞 일정이 끝나기 전에 출발/시작해야 함
    const short = Math.round((ow.end - w.start) / MIN);
    const what = w.start < w.begin ? '이동 시간이' : '시간이';
    return `앞 일정 ${name}이 ${hhmm(new Date(ow.end))}에 끝나면 ${what} ${short}분 부족해요.`;
  }
  return `${name}(${hhmm(new Date(ow.begin))})과 시간이 겹쳐요.`;
}

