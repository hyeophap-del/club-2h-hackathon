// 분석 결과 코드 검증(js/agents/validateResult.js) 테스트
// 사례는 팀원 may0ne2e의 sex-extract 브랜치 SAMPLES(요일 불일치, 영수증, 문서 속 지시문)를 참고했습니다.
// 실행: node tests/validate.test.js   (Node 18 이상)
// 브라우저에서도 돌 수 있게 node:assert 대신 작은 확인 함수를 씁니다: await import('./tests/validate.test.js')
import { validateResult } from "../js/agents/validateResult.js";
const today = "2026-11-18"; // (수)

function eq(a, b) { if (a !== b) throw new Error(`기대 ${JSON.stringify(b)}, 실제 ${JSON.stringify(a)}`); }
function ok(v, msg) { if (!v) throw new Error(msg); }
const task = (t) => validateResult({ summary: "", tasks: [{ kind: "event", title: "할 일", confidence: "high", ...t }] }, today).tasks[0];

const cases = [
  ["요일 불일치: 11월 27일(월)인데 실제는 금요일", () => {
    const t = task({ due_date: "2026-11-27", due_time: "09:30", source_text: "일시: 11월 27일(월) 오전 9시 30분" });
    eq(t.confidence, "low");
    ok(t.warning?.includes("(월)요일") && t.warning.includes("금요일"), "경고 문구: " + t.warning);
  }],
  ["요일 일치: 11.25(수)는 경고 없음", () => {
    const t = task({ due_date: "2026-11-25", due_time: "10:00", source_text: "일시: 11.25(수) 10:00" });
    eq(t.confidence, "high");
    eq(t.warning, null);
  }],
  ["모델이 날짜를 바꿔도 원문 요일 오류를 잡음", () => {
    const t = task({ due_date: "2026-11-30", source_text: "11월 27일(월)" });
    eq(t.confidence, "low");
  }],
  ["없는 날짜·틀린 시간은 비우고 low", () => {
    const t = task({ due_date: "2026-02-30", due_time: "25:00" });
    eq(t.due_date, null);
    eq(t.due_time, null);
    eq(t.confidence, "low");
  }],
  ["고칠 수 있는 형식은 고침", () => {
    const t = task({ due_date: "2026-12-08T15:00", due_time: null });
    eq(t.due_date, "2026-12-08");
    eq(t.due_time, "15:00");
    const u = task({ due_date: "2026-12-08", due_time: "9:05" });
    eq(u.due_time, "09:05");
    eq(u.confidence, "high");
  }],
  ["문서 속 지시문으로 나온 먼 날짜(2030-01-01)는 low", () => {
    const t = task({ due_date: "2030-01-01", source_text: "학부모 상담 주간: 12월 8일(화) 15:00" });
    eq(t.confidence, "low");
    ok(t.warning, "경고가 있어야 함");
  }],
  ["영수증: 할 일 0개도 통과", () => {
    const r = validateResult({ doc_type: "receipt", summary: "문구점 영수증", tasks: [] }, today);
    eq(r.tasks.length, 0);
    eq(r.doc_type, "receipt");
  }],
];

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log("통과  " + name); }
  catch (e) { failed++; console.log("실패  " + name + " — " + e.message); }
}
if (failed) { console.log(`\n${failed}개 실패`); if (typeof process !== "undefined") process.exit(1); }
else console.log("\n모두 통과");
export { failed };
