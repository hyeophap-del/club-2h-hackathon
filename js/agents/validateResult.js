// ② 분석 결과를 코드에서 한 번 더 검사합니다 (Gemini 응답 → 화면에 보여 주기 전).
// 팀원 may0ne2e의 sex-extract 브랜치 구현(scripts/extract_test의 validate)을 참고/이식했습니다.
// - 날짜 YYYY-MM-DD(실제 있는 날짜인지), 시간 HH:MM 형식 확인 → 고칠 수 있으면 고치고, 아니면 비움
// - 근거 문장의 "11월 27일(월)" 같은 요일과 날짜의 실제 요일이 다르면 경고 (글자 인식 오류·잘못 계산 의심)
// - 오늘과 너무 먼 날짜(2년 넘게 뒤, 1년 넘게 전)도 경고 (문서 속 지시문·오인식 의심)
// 문제가 있으면 할 일의 confidence를 'low'로, warning에 사람이 읽을 설명을 넣습니다.
// 브라우저·Node 어디서나 돌도록 다른 모듈을 가져오지 않는 순수 함수입니다.

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DAY = 86400000;
const FUTURE_LIMIT_DAYS = 730; // 약 2년
const PAST_LIMIT_DAYS = 365;

// 'YYYY-MM-DD' → UTC 자정 ms. 형식이 틀리거나 없는 날짜(2월 30일 등)면 null
function parseDate(s) {
  const m = typeof s === 'string' && s.match(DATE_RE);
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2], +m[3]];
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? t : null;
}

function todayMs(today) {
  if (today instanceof Date) return Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return parseDate(today) ?? todayMs(new Date());
}

const iso = (t) => new Date(t).toISOString().slice(0, 10);

// 날짜 값 다듬기: '2026-11-27T09:30' → 날짜 + 시간, '2026.1.5' → '2026-01-05', 못 고치면 invalid
function cleanDate(v) {
  if (v == null || v === '') return { date: null, time: null, invalid: false };
  const s = String(v).trim();
  if (parseDate(s) != null) return { date: s, time: null, invalid: false };
  const m = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/);
  if (m) {
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (parseDate(date) != null) {
      const time = m[4] != null && +m[4] < 24 ? `${m[4].padStart(2, '0')}:${m[5]}` : null;
      return { date, time, invalid: false };
    }
  }
  return { date: null, time: null, invalid: true };
}

// 시간 값 다듬기: '9:30' → '09:30', '25:00'·'오전 9시' → invalid
function cleanTime(v) {
  if (v == null || v === '') return { time: null, invalid: false };
  const s = String(v).trim();
  if (TIME_RE.test(s)) return { time: s, invalid: false };
  const m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m && +m[1] < 24 && +m[2] < 60) return { time: `${m[1].padStart(2, '0')}:${m[2]}`, invalid: false };
  return { time: null, invalid: true };
}

// 근거 문장에서 "날짜(요일)" 표기를 모두 찾습니다.
// 예: 11월 27일(월), 2026년 11월 27일 (월요일), 11.25(수), 2026. 11. 25.(수), 12/3(목)
const DATE_WITH_WEEKDAY = /(?:(\d{4})\s*(?:년|[./-])\s*)?(\d{1,2})\s*(?:월|[./-])\s*(\d{1,2})\s*(?:일)?\s*\.?\s*\(\s*([일월화수목금토])(?:요일)?\s*\)/g;

export function findDatedWeekdays(text) {
  const out = [];
  if (typeof text !== 'string') return out;
  for (const m of text.matchAll(DATE_WITH_WEEKDAY)) {
    const month = +m[2];
    const day = +m[3];
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    out.push({ raw: m[0].trim(), year: m[1] ? +m[1] : null, month, day, weekday: m[4] });
  }
  return out;
}

// 연도가 없는 표기는 기준 날짜(할 일 날짜 또는 오늘)와 가장 가까운 해로 봅니다.
function resolveMention(mn, refMs) {
  const refYear = new Date(refMs).getUTCFullYear();
  const years = mn.year ? [mn.year] : [refYear - 1, refYear, refYear + 1];
  let best = null;
  for (const y of years) {
    const t = parseDate(`${y}-${String(mn.month).padStart(2, '0')}-${String(mn.day).padStart(2, '0')}`);
    if (t != null && (best == null || Math.abs(t - refMs) < Math.abs(best - refMs))) best = t;
  }
  return best;
}

// 요일 검사: 문제가 있으면 경고 문장, 없으면 null
function weekdayWarning(sourceText, dueDate, todayMsValue) {
  const dueMs = parseDate(dueDate);
  for (const mn of findDatedWeekdays(sourceText)) {
    let sameDay = false;
    if (dueMs != null) {
      const d = new Date(dueMs);
      sameDay = d.getUTCMonth() + 1 === mn.month && d.getUTCDate() === mn.day && (!mn.year || mn.year === d.getUTCFullYear());
    }
    const t = sameDay ? dueMs : resolveMention(mn, dueMs ?? todayMsValue);
    if (t == null) continue;
    const actual = WEEKDAYS[new Date(t).getUTCDay()];
    if (actual === mn.weekday) continue;
    return sameDay
      ? `문서에는 (${mn.weekday})요일로 적혀 있지만 ${iso(t)}은 ${actual}요일입니다. 날짜를 원문과 비교해 확인해 주세요.`
      : `문서의 "${mn.raw}"은 날짜와 요일이 맞지 않습니다 (${iso(t)}은 ${actual}요일). 날짜를 원문과 비교해 확인해 주세요.`;
  }
  return null;
}

function validateTask(raw, base) {
  const t = { ...raw };
  const warnings = [];
  t.source_text = typeof t.source_text === 'string' ? t.source_text : '';

  const d = cleanDate(t.due_date);
  if (d.invalid) warnings.push(`날짜 "${t.due_date}"을(를) 읽을 수 없어 비웠습니다. 직접 입력해 주세요.`);
  t.due_date = d.date;
  if (d.time && !t.due_time) t.due_time = d.time;

  const tm = cleanTime(t.due_time);
  if (tm.invalid) warnings.push(`시간 "${t.due_time}"을(를) 읽을 수 없어 비웠습니다.`);
  t.due_time = tm.time;

  const dueMs = parseDate(t.due_date);
  if (dueMs != null) {
    const diff = Math.round((dueMs - base) / DAY);
    if (diff > FUTURE_LIMIT_DAYS || diff < -PAST_LIMIT_DAYS) {
      warnings.push(`${t.due_date}은 오늘과 너무 멀리 떨어진 날짜입니다. 문서의 날짜가 맞는지 확인해 주세요.`);
    }
  }

  const ww = weekdayWarning(t.source_text, t.due_date, base);
  if (ww) warnings.push(ww);

  // 단계 계획: 날짜가 틀린 단계는 버림
  if (Array.isArray(t.steps)) {
    t.steps = t.steps.map((s) => ({ ...s, date: cleanDate(s?.date).date })).filter((s) => s.date && s.title);
  }

  t.warning = warnings.length ? warnings.join(' ') : null;
  if (warnings.length) t.confidence = 'low';
  return t;
}

// result: Gemini 응답 객체 ({ tasks: [...], reply, payment, ... })
// today: 'YYYY-MM-DD' 또는 Date (없으면 지금)
// 반환: 검사·정리된 새 결과 (입력은 바꾸지 않음). tasks가 비어 있어도(영수증 등) 그대로 통과합니다.
export function validateResult(result, today = new Date()) {
  const base = todayMs(today);
  const r = { ...result };
  r.tasks = (Array.isArray(r.tasks) ? r.tasks : []).filter((t) => t && typeof t === 'object').map((t) => validateTask(t, base));
  for (const key of ['reply', 'payment']) {
    if (r[key] && typeof r[key] === 'object') r[key] = { ...r[key], due_date: cleanDate(r[key].due_date).date };
  }
  return r;
}
