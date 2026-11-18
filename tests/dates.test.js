// 날짜 분석기(js/dates.js) 테스트
// 원작: 팀원 leokiller6646의 dw 브랜치 구현을 옮겨 옴 (require → import 로 변환)
// 실행: node tests/dates.test.js   (Node 18 이상, 저장소 루트의 package.json "type": "module" 덕분에 import 사용)
import assert from "node:assert";
import * as D from "../js/dates.js";
const ref = new Date(2026, 10, 18); // 2026-11-18 (수)

function primary(text) { return D.analyze(text, ref).primary; }

const cases = [
  ["행사 일시가 발행일보다 우선",
   "현장체험학습 안내\n1. 일시: 2026년 11월 27일(금) 오전 9시 30분\n3. 동의서 제출: 11월 24일(화)까지\n2026. 11. 16.",
   "2026-11-27", "event", "09:30"],
  ["납기일이 작성일·사용기간보다 우선",
   "전기요금 청구서\n납기일 2026-11-30\n작성일 2026.11.10\n사용기간 2026.10.01 ~ 10.31",
   "2026-11-30", "deadline", null],
  ["영문 날짜와 시간",
   "Meeting invitation\nDate: Dec 3, 2026 at 2:00 PM\nIssued Nov 1, 2026",
   "2026-12-03", "event", "14:00"],
  ["접수 기간은 끝나는 날",
   "접수기간: 2026.11.20 ~ 2026.12.05 18:00\n발표: 12/12(토)",
   "2026-12-05", "period", "18:00"],
  ["상대 날짜",
   "내일 오후 3시 회의 / 다음 주 수요일까지 제출",
   "2026-11-25", "deadline", null],
  ["연도 없는 날짜는 올해 기준",
   "12월 3일(목)까지 회신 바랍니다.",
   "2026-12-03", "deadline", null],
  ["지난 달 초 날짜는 내년으로 보지 않음",
   "10월 2일 행사",
   "2026-10-02", "event", null],
  ["석 달 넘게 지난 날짜는 내년",
   "3월 2일 입학식",
   "2027-03-02", "event", null],
];

let failed = 0;
for (const [name, text, iso, cat, time] of cases) {
  const p = primary(text);
  try {
    assert.ok(p, "날짜를 찾지 못함");
    assert.strictEqual(p.iso, iso);
    assert.strictEqual(p.category, cat);
    assert.strictEqual(p.time, time);
    console.log("통과  " + name);
  } catch (e) {
    failed++;
    console.log("실패  " + name + " — " + e.message);
  }
}

assert.strictEqual(primary("전화 010-1234-5678 금액 12.50"), null);
console.log("통과  날짜가 없으면 null");

if (failed) { console.log(`\n${failed}개 실패`); process.exit(1); }
console.log("\n모두 통과");
