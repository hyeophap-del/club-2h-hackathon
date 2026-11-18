// 일정 시간 겹침(js/schedule.js) 테스트
// 실행: node tests/schedule.test.js   (Node 18 이상, 브라우저에서 import 해도 동작하도록 node:assert 대신 작은 확인 함수 사용)
import { conflictsFor, findAllConflicts, conflictsWithExisting } from "../js/schedule.js";

const ev = (id, dueTime, extra = {}) => ({ id, kind: "event", title: id, dueDate: "2026-11-27", dueTime, ...extra });
const ids = (list) => list.map((t) => t.id).join(",");

const trip = ev("trip", "09:00");
const tasks = [
  trip,
  ev("meet", "09:30"),                                   // 09:00~10:00 과 겹침
  ev("lunch", "12:00"),                                  // 안 겹침
  ev("far", "10:30", { travel: { minutes: 40, departAt: new Date(2026, 10, 27, 9, 45).toISOString() } }), // 출발 09:45 → 겹침
  { id: "due", kind: "deadline", title: "제출", dueDate: "2026-11-27", dueTime: "09:00" }, // 마감은 시간을 차지하지 않음
  ev("allday", null, { dueDate: "2026-11-28" }),
  ev("next", "15:00", { dueDate: "2026-11-28" }),        // 종일 참석 일정과 같은 날
  ev("done", "09:00", { done: true }),                   // 끝낸 일은 제외
];

const cases = [
  ["1시간 안에 시작하는 일정은 겹침", () => ids(conflictsFor(trip, tasks)), "meet,far"],
  ["이동 시간 때문에 겹침", () => ids(conflictsFor(tasks[3], tasks)), "trip,meet"],
  ["마감·끝낸 일은 겹치지 않음", () => ids(conflictsFor(tasks[4], tasks)) + "|" + ids(conflictsFor(tasks[7], tasks)), "|"],
  ["종일 참석 일정은 같은 날 참석과 겹침", () => ids(conflictsFor(tasks[5], tasks)), "next"],
  ["findAllConflicts", () => [...findAllConflicts(tasks).keys()].sort().join(","), "allday,far,meet,next,trip"],
  ["conflictsWithExisting (초안 순서대로)", () => conflictsWithExisting(
    [{ kind: "event", title: "새 일정", dueDate: "2026-11-27", dueTime: "12:30" }, { kind: "prep", title: "준비", dueDate: "2026-11-27" }],
    tasks).map(ids).join("|"), "lunch|"],
];

let failed = 0;
for (const [name, fn, want] of cases) {
  const got = fn();
  if (got === want) console.log("통과  " + name);
  else { failed++; console.log(`실패  ${name} — 기대 ${JSON.stringify(want)}, 결과 ${JSON.stringify(got)}`); }
}
if (failed) {
  console.log(`\n${failed}개 실패`);
  if (typeof process !== "undefined") process.exit(1);
} else console.log("\n모두 통과");
export const result = { failed, total: cases.length };
