/*
 * 날짜 분석 에이전트의 두뇌.
 * 인식된 글자에서 날짜 표현을 모두 찾고, 주변 문맥(마감, 일시, 발행 등)을 보고
 * "이 문서가 필요한 날짜"를 하나 고른다. DOM에 의존하지 않아 Node에서도 테스트할 수 있다.
 */
(function (root) {
  "use strict";

  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const EN_MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  const DAY_MS = 86400000;

  // 문맥 키워드: 날짜에 가까운 키워드가 그 날짜의 성격을 정한다.
  const CATEGORIES = [
    { id: "deadline", label: "제출·마감일", weight: 6,
      words: ["까지", "마감", "기한", "제출", "납부", "납기", "접수", "회신", "반납", "due", "deadline", "until"] },
    { id: "event", label: "행사·일정일", weight: 5,
      words: ["일시", "일정", "행사", "개최", "회의", "시험", "면접", "방문", "예약", "출발", "도착", "공연", "시작", "진행", "교육", "모임", "등교", "수업", "체험", "견학", "입학", "졸업", "상담", "진료", "검진", "meeting", "event", "schedule", "date", "when"] },
    { id: "period", label: "신청·기간", weight: 4,
      words: ["기간", "신청", "모집", "응모", "period"] },
    { id: "expire", label: "유효·만료일", weight: 3,
      words: ["유효", "만료", "expire", "valid"] },
    { id: "issued", label: "발행·작성일", weight: -3,
      words: ["발행", "작성", "발급", "출력", "인쇄", "등록일", "기준일", "issued", "printed"] },
  ];

  const DOC_TYPES = [
    ["가정통신문", ["가정통신문", "학부모", "담임"]],
    ["고지서·청구서", ["고지서", "청구서", "납부", "청구금액", "요금"]],
    ["영수증", ["영수증", "합계", "카드승인", "결제"]],
    ["초대장·안내문", ["초대", "초청", "안내", "참석"]],
    ["신청서·서식", ["신청서", "서식", "성명", "서명"]],
    ["계약서", ["계약", "갑", "을", "계약기간"]],
    ["공문", ["수신", "발신", "시행", "문서번호"]],
    ["진료·처방", ["처방", "진료", "병원", "약국"]],
    ["티켓·예약 확인", ["예매", "티켓", "좌석", "승차", "탑승", "예약번호"]],
  ];

  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }

  function makeDate(y, m, d) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
  }

  function toISO(d) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function diffDays(a, b) { return Math.round((startOfDay(a) - startOfDay(b)) / DAY_MS); }

  function formatKo(d, withYear) {
    const base = `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEKDAYS[d.getDay()]})`;
    return withYear === false ? base : `${d.getFullYear()}년 ${base}`;
  }

  function ddayLabel(n) {
    if (n === 0) return "D-DAY";
    return n > 0 ? `D-${n}` : `D+${-n}`;
  }

  function relativeLabel(n) {
    if (n === 0) return "오늘";
    if (n === 1) return "내일";
    if (n === 2) return "모레";
    if (n === -1) return "어제";
    return n > 0 ? `${n}일 남음` : `${-n}일 지남`;
  }

  // 연도가 없는 날짜: 기준일보다 90일 넘게 지났다면 내년으로 본다.
  function inferYear(m, d, ref) {
    let y = ref.getFullYear();
    const cand = makeDate(y, m, d);
    if (cand && diffDays(cand, ref) < -90) y += 1;
    return y;
  }

  // 전각 숫자·물결표를 반각으로 (글자 길이는 그대로 유지해 위치 정보를 보존)
  function normalize(text) {
    return text
      .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[～〜∼]/g, "~")
      .replace(/[．]/g, ".")
      .replace(/[／]/g, "/");
  }

  const WD = "(?:\\s*\\(\\s*[월화수목금토일]\\s*\\)|\\s*[월화수목금토일]요일)?";

  const PATTERNS = [
    { // 2026년 11월 18일, 2026.11.18, 2026-11-18, 2026/11/18
      re: new RegExp("(?<!\\d)((?:19|20)\\d{2})\\s*(?:년|[.\\-/])\\s*(\\d{1,2})\\s*(?:월|[.\\-/])\\s*(\\d{1,2})(?!\\d)\\s*(?:일|\\.)?" + WD, "g"),
      build: (m) => ({ y: +m[1], mo: +m[2], d: +m[3], explicitYear: true }) },
    { // Nov 18, 2026 / November 18th 2026
      re: /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+((?:19|20)\d{2})\b/gi,
      build: (m) => ({ y: +m[3], mo: EN_MONTHS[m[1].toLowerCase()], d: +m[2], explicitYear: true }) },
    { // 18 Nov 2026
      re: /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+((?:19|20)\d{2})\b/gi,
      build: (m) => ({ y: +m[3], mo: EN_MONTHS[m[2].toLowerCase()], d: +m[1], explicitYear: true }) },
    { // 26.11.18 (두 자리 연도)
      re: new RegExp("(?<![\\d.])(\\d{2})\\s*\\.\\s*(\\d{1,2})\\s*\\.\\s*(\\d{1,2})(?![\\d.]\\d)\\.?" + WD, "g"),
      build: (m) => ({ y: 2000 + +m[1], mo: +m[2], d: +m[3], explicitYear: true }) },
    { // 11/25(수), 11.25(수)  — 요일이 붙어 있어야 날짜로 인정
      re: /(?<![\d./])(\d{1,2})\s*[./]\s*(\d{1,2})\s*\.?\s*\(\s*([월화수목금토일])\s*\)/g,
      build: (m) => ({ mo: +m[1], d: +m[2], explicitYear: false }) },
    { // 2026.10.01 ~ 10.31 처럼 범위 뒤쪽의 월.일
      re: /(?<=~\s{0,3})(\d{1,2})\s*[./]\s*(\d{1,2})(?![\d])\.?/g,
      build: (m) => ({ mo: +m[1], d: +m[2], explicitYear: false }) },
    { // 11월 25일
      re: new RegExp("(?<!\\d)(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일" + WD, "g"),
      build: (m) => ({ mo: +m[1], d: +m[2], explicitYear: false }) },
  ];

  const RELATIVE = [
    { re: /(오늘|금일)/g, offset: () => 0 },
    { re: /(내일|명일)/g, offset: () => 1 },
    { re: /(모레)/g, offset: () => 2 },
    { re: /(글피)/g, offset: () => 3 },
    { re: /(\d{1,3})\s*일\s*(?:후|뒤)/g, offset: (m) => +m[1] },
    { re: /(이번|다음|다다음)\s*주\s*([월화수목금토일])요일/g, offset: (m, ref) => {
        const target = WEEKDAYS.indexOf(m[2]);
        const weeks = { 이번: 0, 다음: 1, 다다음: 2 }[m[1]];
        const mondayOffset = (ref.getDay() + 6) % 7; // 이번 주 월요일까지 거리
        const targetFromMonday = (target + 6) % 7;
        return -mondayOffset + weeks * 7 + targetFromMonday;
      } },
  ];

  const TIME_RE = /^[\s,()월화수목금토일요]{0,8}(?:at\s+)?(오전|오후|am|pm)?\s*(\d{1,2})\s*(?::\s*(\d{2})|시\s*(?:(\d{1,2})\s*분|(반))?)(?:\s*(am|pm|a\.m\.|p\.m\.))?/i;

  function findTime(text, from) {
    const m = TIME_RE.exec(text.slice(from, from + 24));
    if (!m) return null;
    let h = +m[2];
    const min = m[3] ? +m[3] : m[4] ? +m[4] : m[5] ? 30 : 0;
    const ap = ((m[1] || m[6] || "").toLowerCase().replace(/\./g, "")) || null;
    if ((ap === "오후" || ap === "pm") && h < 12) h += 12;
    if ((ap === "오전" || ap === "am") && h === 12) h = 0;
    if (h > 24 || min > 59) return null;
    return { h, min, text: `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`, length: m[0].length };
  }

  function overlaps(spans, s, e) { return spans.some(([a, b]) => s < b && e > a); }

  const keywordCache = new Map();
  // 영어는 단어 경계로, 한글은 OCR이 글자 사이에 넣는 공백("제 출")을 허용해서 찾는다.
  function keywordRegex(w) {
    if (!keywordCache.has(w)) {
      const src = /^[a-z]+$/.test(w) ? `\\b${w}\\b` : [...w].join("\\s?");
      keywordCache.set(w, new RegExp(src, "g"));
    }
    return keywordCache.get(w);
  }

  function classify(text, start, end) {
    // 문맥은 같은 줄 안에서만 본다. 날짜가 줄 맨 앞이면 바로 윗줄(제목·라벨)까지 본다.
    const lineStart = text.lastIndexOf("\n", start - 1) + 1;
    let ctxStart = lineStart;
    if (lineStart > 0 && !text.slice(lineStart, start).replace(/[\s:：\-·*•\d.)]/g, "")) {
      const prevStart = text.lastIndexOf("\n", Math.max(0, lineStart - 2)) + 1;
      const prevLine = text.slice(prevStart, lineStart).trim();
      // 윗줄이 숫자 없는 짧은 라벨일 때만 (예: "제출 기한" 다음 줄에 날짜)
      if (prevLine.length <= 14 && !/\d/.test(prevLine)) ctxStart = prevStart;
    }
    const nl = text.indexOf("\n", end);
    const lineEnd = nl === -1 ? text.length : nl;
    const before = text.slice(Math.max(ctxStart, start - 24), start).toLowerCase();
    const after = text.slice(end, Math.min(lineEnd, end + 18)).toLowerCase();
    let best = null;
    for (const cat of CATEGORIES) {
      for (const w of cat.words) {
        const re = keywordRegex(w);
        const find = (s, last) => {
          re.lastIndex = 0;
          let hit = null, mm;
          while ((mm = re.exec(s))) { hit = { idx: mm.index, len: mm[0].length }; if (!last) break; }
          return hit;
        };
        const bh = find(before, true);
        const ah = find(after, false);
        // "까지"는 날짜 바로 뒤에 올 때만 의미가 있다
        const candidates = [];
        if (bh && w !== "까지") candidates.push(before.length - bh.idx - bh.len);
        if (ah) candidates.push(ah.idx);
        for (const dist of candidates) {
          if (!best || dist < best.dist || (dist === best.dist && cat.weight > best.cat.weight)) {
            best = { cat, dist, word: w };
          }
        }
      }
    }
    return best;
  }

  function guessDocType(text) {
    let best = null;
    for (const [name, words] of DOC_TYPES) {
      const hits = words.filter((w) => text.includes(w)).length;
      if (hits && (!best || hits > best.hits)) best = { name, hits };
    }
    return best ? best.name : null;
  }

  function analyze(rawText, refDate) {
    const ref = startOfDay(refDate || new Date());
    const text = normalize(rawText || "");
    const spans = [];
    const found = [];

    for (const p of PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text))) {
        let start = m.index, end = m.index + m[0].length;
        // 정규식 끝의 공백은 표시에서 제외
        while (end > start && /\s/.test(text[end - 1])) end--;
        if (overlaps(spans, start, end)) continue;
        const b = p.build(m);
        if (!b.mo) continue;
        const year = b.explicitYear ? b.y : inferYear(b.mo, b.d, ref);
        const date = makeDate(year, b.mo, b.d);
        if (!date) continue;
        spans.push([start, end]);
        found.push({ date, start, end, raw: text.slice(start, end), explicitYear: b.explicitYear, relative: false });
      }
    }

    for (const r of RELATIVE) {
      r.re.lastIndex = 0;
      let m;
      while ((m = r.re.exec(text))) {
        const start = m.index, end = m.index + m[0].length;
        if (overlaps(spans, start, end)) continue;
        const off = r.offset(m, ref);
        const date = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate() + off);
        spans.push([start, end]);
        found.push({ date, start, end, raw: m[0], explicitYear: false, relative: true });
      }
    }

    found.sort((a, b) => a.start - b.start);

    // 범위(~, 부터) 연결 및 연도 상속
    for (let i = 0; i < found.length - 1; i++) {
      const a = found[i], b = found[i + 1];
      const between = text.slice(a.end, b.start);
      if (/^\s*(?:~|-|–|—|부터|에서)\s*$/.test(between) || /^\s*(?:\d{1,2}\s*[:시][^~\n]{0,8})?\s*~\s*$/.test(between)) {
        if (a.explicitYear && !b.explicitYear && !b.relative) {
          let y = a.date.getFullYear();
          let nd = makeDate(y, b.date.getMonth() + 1, b.date.getDate());
          if (nd && nd < a.date) nd = makeDate(y + 1, b.date.getMonth() + 1, b.date.getDate());
          if (nd) b.date = nd;
        }
        a.rangeRole = "start"; b.rangeRole = "end";
        a.pair = i + 1; b.pair = i;
      }
    }

    const results = found.map((f, i) => {
      const dday = diffDays(f.date, ref);
      const time = f.relative ? null : findTime(text, f.end);
      let ctx = classify(text, f.start, f.end + (time ? time.length : 0));
      // 범위의 짝 날짜가 가진 문맥을 공유
      if (!ctx && f.pair != null) {
        const o = found[f.pair];
        ctx = classify(text, o.start, o.end);
      }
      const cat = ctx ? ctx.cat : null;
      let score = cat ? cat.weight + (ctx.dist <= 6 ? 1 : 0) : 0;
      if (dday > 0) score += 3; else if (dday === 0) score += 2.5; else score -= 2;
      if (dday > 365) score -= 1.5;
      if (f.explicitYear) score += 0.5;
      if (time) score += 1;
      if (f.relative) score -= 0.5;
      if (f.rangeRole === "end" && cat && (cat.id === "deadline" || cat.id === "period")) score += 1.5;
      if (f.rangeRole === "start" && cat && cat.id === "event") score += 1;

      let label = cat ? cat.label : "언급된 날짜";
      if (f.rangeRole === "start") label += " (시작)";
      if (f.rangeRole === "end") label += " (끝)";

      return {
        index: i,
        date: f.date,
        iso: toISO(f.date),
        display: formatKo(f.date),
        start: f.start,
        end: f.end,
        raw: f.raw.trim(),
        time: time ? time.text : null,
        category: cat ? cat.id : "general",
        label,
        keyword: ctx ? ctx.word : null,
        inferredYear: !f.explicitYear && !f.relative,
        relative: f.relative,
        rangeRole: f.rangeRole || null,
        dday,
        ddayText: ddayLabel(dday),
        relativeText: relativeLabel(dday),
        score: Math.round(score * 10) / 10,
      };
    });

    let primary = null;
    for (const r of results) {
      if (!primary || r.score > primary.score) primary = r;
    }

    return {
      reference: toISO(ref),
      dates: results,
      primary,
      docType: guessDocType(text),
      summary: primary ? summarize(primary) : null,
    };
  }

  function summarize(p) {
    const when = p.time ? `${p.display} ${p.time}` : p.display;
    const phrase = {
      deadline: "제출·마감",
      event: "행사·일정",
      period: p.rangeRole === "end" ? "신청 기간 마감" : "신청 기간",
      expire: "유효기간 만료",
      issued: "발행",
      general: "문서에 적힌 날짜",
    }[p.category];
    let tail;
    if (p.dday > 0) tail = `${p.dday}일 남았습니다.`;
    else if (p.dday === 0) tail = "바로 오늘입니다.";
    else tail = `이미 ${-p.dday}일 지났습니다.`;
    return `이 문서는 ${when}의 ${phrase}에 필요한 문서로 보입니다. ${tail}`;
  }

  const api = { analyze, toISO, formatKo, diffDays, ddayLabel, relativeLabel, WEEKDAYS };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.DateAgent = api;
})(typeof window !== "undefined" ? window : globalThis);
