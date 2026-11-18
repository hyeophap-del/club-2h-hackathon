// ② 분석 역할의 "키 없는 대체 경로" — Gemini 키가 없거나 무료 한도를 넘었을 때 씁니다.
// 원작: 팀원 leokiller6646의 dw 브랜치 구현을 옮겨 옴 (js/ocr.js의 Tesseract 글자 인식 + js/dates.js 날짜 분석)
//
//   사진 ─▶ OpenCV로 테두리 찾기(되면 펴서 읽기) ─▶ Tesseract(한국어+영어) 글자 인식 ─▶ 규칙 기반 날짜 분석
//        ─▶ analyzeAgent와 똑같은 모양의 결과 { doc_type, audience, title, summary, key_points, pages, reply,
//           payment, contacts, tasks } + local: true
//
// AI가 아니라서 "날짜 위주"로만 찾습니다. 할 일은 모두 confidence: 'low'(노란 표시)로 돌려주어 사용자가 확인하게 합니다.
// 무거운 도구(Tesseract 약 3MB + 언어 데이터, OpenCV 약 10MB)는 이 경로가 실제로 실행될 때만 CDN에서 불러옵니다.
import { analyze as analyzeDates } from '../dates.js';
import { detectCornersCV, cornersToAI, warpDocument, loadScriptOnce } from './scanAgent.js';

const TESSERACT_URLS = [
  'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js',
];

const STAGES = {
  'loading tesseract core': '글자 인식 엔진 불러오는 중',
  'initializing tesseract': '글자 인식 엔진 준비 중',
  'initialized tesseract': '글자 인식 엔진 준비 완료',
  'loading language traineddata': '한국어·영어 글자 데이터 내려받는 중 (처음 한 번)',
  'loaded language traineddata': '글자 데이터 준비 완료',
  'initializing api': '인식 준비 중',
  'initialized api': '인식 준비 완료',
  'recognizing text': '글자 읽는 중',
};

let workerPromise = null;
let progressHandler = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      try {
        await loadScriptOnce(TESSERACT_URLS, 30000);
      } catch {
        throw new Error('글자 인식 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
      }
      return window.Tesseract.createWorker(['kor', 'eng'], 1, {
        logger: (m) => progressHandler?.(m),
      });
    })();
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

// 인식 정확도를 위해 너무 작은 이미지는 키우고, 너무 큰 이미지는 줄임 (원작 ocr.js의 prepare)
function prepare(source) {
  const w0 = source.naturalWidth || source.width, h0 = source.naturalHeight || source.height;
  const long = Math.max(w0, h0);
  const target = long < 1400 ? 1400 : long > 2600 ? 2600 : long;
  const s = target / long;
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * s);
  c.height = Math.round(h0 * s);
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, c.width, c.height);
  return c;
}

function tidy(text) {
  return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 열 수 없습니다.'));
    img.src = src;
  });
}

const pct = (p) => `${Math.round((p || 0) * 100)}%`;

// ---------- 글자 → 결과 모양으로 바꾸기 ----------

// 글머리표·번호("1.", "2)")만 지움. "2학년"처럼 숫자로 시작하는 말은 남김
const BULLET = /^(?:\s*(?:[■□●○◆◇▶▷►•·※*\-–—>]+|\d{1,2}[.)](?!\d)))*\s*/;
// 날짜 앞에 붙는 흔한 라벨 ("일시:", "제출 기한:")
const GENERIC_LABEL = /^(일\s?시|일\s?정|날\s?짜|때|시\s?간|기\s?간|date|when)$/i;
const TAIL = /\s*(해\s?주시기\s?바랍니다|해\s?주십시오|해\s?주세요|바랍니다|부탁드립니다|합니다|입니다)[.\s]*$/;

const squash = (s) => s.replace(/\s+/g, ' ').trim();
// 글머리표(■ 등)를 OCR이 엉뚱한 한 글자("를", "o")로 읽는 일이 많음 → "X 라벨:" 꼴이면 앞 글자를 버림
//   ("를"·"을"로 시작하는 한국어 문장은 없으므로 이 글자들은 라벨이 없어도 버림)
const unbullet = (s) => s.replace(BULLET, '')
  .replace(/^(?:[를을흘ㅁ口oO=|]|\[\])\s+/, '')
  .replace(/^[^\s\d]\s+(?=[^:：\n]{1,10}[:：])/, '');

function lineAt(text, pos) {
  const start = text.lastIndexOf('\n', pos - 1) + 1;
  const nl = text.indexOf('\n', pos);
  return { start, end: nl === -1 ? text.length : nl };
}

// 날짜가 있는 줄(문장이 다음 줄로 이어지면 그 줄까지)을 근거 문장으로
function sourceLine(text, d, allDates) {
  const { start, end } = lineAt(text, d.start);
  let line = text.slice(start, end);
  let lineEnd = end;
  const next = lineAt(text, Math.min(text.length, end + 1));
  const nextText = end < text.length ? text.slice(next.start, next.end).trim() : '';
  const nextHasDate = allDates.some((o) => o.start >= next.start && o.start < next.end);
  // "라벨: 값" 줄이 아닌 문장이 글머리표·라벨 없는 다음 줄로 이어지면 붙임
  const isLabelLine = /^.{1,14}[:：]/.test(unbullet(line.trim()));
  const nextIsItem = unbullet(nextText) !== nextText || /[:：]/.test(nextText);
  if (nextText && !nextHasDate && !isLabelLine && !nextIsItem && !/[.!?。]\s*$/.test(line.trim())) {
    line += ' ' + nextText;
    lineEnd = next.end;
  }
  return { line: squash(unbullet(line)), start, end: lineEnd };
}

// 줄에서 날짜·시간 표현을 지우고 남은 말로 할 일 제목을 만듦
function titleFor(text, d, src, docTitle) {
  let line = text.slice(src.start, src.end).replace(/\n/g, ' ');
  // 날짜 원문 + 바로 뒤의 시간·"까지" 제거
  const rel = d.start - src.start;
  line = line.slice(0, rel) + ' ' + line.slice(rel + (d.end - d.start))
    .replace(/^[\s,()월화수목금토일요]*(오전|오후|am|pm)?\s*\d{1,2}\s*(:\s*\d{2}|시\s*(\d{1,2}\s*분|반)?)?/i, (m) => (/\d/.test(m) ? ' ' : m))
    .replace(/^\s*(까지|부터|~)/, ' ');
  line = squash(unbullet(line));

  let label = null;
  const colon = line.search(/[:：]/);
  if (colon > 0 && colon <= 12) {
    label = squash(line.slice(0, colon));
    line = squash(line.slice(colon + 1));
  }
  line = line.replace(TAIL, '').replace(/^[,·\s]+|[,·\s]+$/g, '').replace(/\(\s*\)/g, '').trim()
    .replace(/^\(([^()]*)\)$/, '$1');

  // 날짜가 줄 맨 앞이면 바로 윗줄(예: "■ 진로 특강 (출석 인정)")이 제목인 경우가 많음
  const before = text.slice(src.start, d.start).replace(/[\s:：\-·*•■□●○◆◇※]/g, '');
  let prev = null;
  if (!before && src.start > 0) {
    const p = lineAt(text, src.start - 1);
    const pt = squash(unbullet(text.slice(p.start, p.end)));
    if (pt && pt.length <= 30 && !/\d{1,2}\s*[월./]\s*\d/.test(pt)) prev = pt;
  }

  // "일시:"처럼 뜻 없는 라벨이면 윗줄 제목 → 문서 제목("2학년 현장체험학습 안내" → "2학년 현장체험학습")
  const fromDoc = (docTitle || '').replace(/\s*(안내|공지|알림|안내문|공지사항)\s*$/, '') || '문서 일정';
  let title;
  if (label && !GENERIC_LABEL.test(label.replace(/\s/g, ''))) title = line ? `${label} (${line})` : label;
  else if (prev) title = prev;
  else if (label) title = fromDoc;
  else if (line.replace(/[^가-힣a-zA-Z]/g, '').length >= 6) title = line;
  else title = fromDoc;
  return title.length > 40 ? `${title.slice(0, 39)}…` : title;
}

const KIND = { deadline: 'deadline', event: 'event', period: 'event', expire: 'deadline', general: 'event' };

function toTasks(text, analysis, docTitle) {
  const tasks = [];
  const seen = new Set();
  for (const d of analysis.dates) {
    if (d.category === 'issued') continue; // 발행·작성일은 할 일이 아님
    // 기간의 시작일은 건너뛰고 끝나는 날만 (행사 기간은 시작일만)
    const pair = d.rangeRole === 'start' ? analysis.dates[d.index + 1] : d.rangeRole === 'end' ? analysis.dates[d.index - 1] : null;
    if (d.rangeRole === 'start' && d.category !== 'event') continue;
    if (d.rangeRole === 'end' && d.category === 'event') continue;
    let kind = KIND[d.category] || 'event';
    if (d.category === 'period' && d.rangeRole === 'end') kind = 'deadline'; // 신청 기간 끝 = 마감
    const key = `${d.iso}|${d.time}|${kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const src = sourceLine(text, d, analysis.dates);
    const range = pair ? ` (기간 ${pair.iso < d.iso ? pair.iso : d.iso} ~ ${pair.iso < d.iso ? d.iso : pair.iso})` : '';
    tasks.push({
      kind,
      title: titleFor(text, d, src, docTitle),
      description: `${d.label}${d.keyword ? ` · "${d.keyword}"` : ''}${range} — 글자 인식으로 찾은 날짜입니다. 원문과 비교해 주세요.`,
      due_date: d.iso,
      due_time: d.time,
      location: null,
      items: [],
      confidence: 'low',
      steps: [],
      source_text: src.line,
      score: d.score,
    });
  }
  // 점수 높은(문서가 필요한) 날짜 순으로 최대 6개
  return tasks.sort((a, b) => b.score - a.score).slice(0, 6).map(({ score, ...t }) => t)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
}

function guessTitle(lines) {
  const head = lines.slice(0, 5);
  return head.find((l) => /안내|공지|통신|과제|알림|모집|신청|초대|고지|청구/.test(l))
    || head.slice().sort((a, b) => b.length - a.length)[0] || '';
}

// 날짜 분석기의 문서 종류 + 대학생·장학 키워드 → analyzeAgent의 doc_type / audience
function guessType(text, dateDocType, title) {
  const t = text.replace(/\s/g, '');
  let doc_type = 'other';
  if (/장학/.test(t)) doc_type = 'scholarship';
  else if (/과제|레포트|리포트|보고서제출|LMS|e-?class/i.test(t)) doc_type = 'university_assignment';
  else if (/학과|교수|조교|수강|강의|학점|대학교/.test(t)) doc_type = 'university_notice';
  else if (dateDocType === '가정통신문' || /가정통신문|학부모|초등학교|중학교|고등학교|유치원/.test(t)) {
    doc_type = /신청서|동의서/.test(title.replace(/\s/g, '')) ? 'school_application' : 'school_notice';
  } else if (dateDocType === '고지서·청구서') doc_type = 'bill';
  else if (dateDocType === '초대장·안내문' || dateDocType === '티켓·예약 확인') doc_type = 'event';
  const audience = /^school_/.test(doc_type) ? 'parent'
    : /^university_|scholarship/.test(doc_type) ? 'student'
      : /학부모|자녀/.test(t) ? 'parent' : /학생|학번/.test(t) ? 'student' : 'general';
  return { doc_type, audience };
}

const PHONE = /(?<!\d)(0\d{1,2}|1[5-9]\d{2})\s*[-.)\s]\s*(\d{3,4})\s*[-.\s]\s*(\d{4})(?!\d)/g;
function findContacts(text) {
  const out = [];
  for (const line of text.split('\n')) {
    PHONE.lastIndex = 0;
    let m;
    while ((m = PHONE.exec(line))) {
      const phone = `${m[1]}-${m[2]}-${m[3]}`;
      if (out.some((c) => c.phone === phone)) continue;
      const name = squash(line.slice(0, m.index).replace(BULLET, '')
        .replace(/(문의|연락처|전화|tel|☎|담당)\s*[:：]?/gi, ' ').replace(/[:：,()]/g, ' ')) || '연락처';
      out.push({ name: name.slice(0, 20), phone });
    }
  }
  return out.slice(0, 3);
}

// 글머리표나 "라벨: 값" 줄을 핵심 내용으로
function keyPoints(lines, title) {
  return lines
    .filter((l) => l !== title && (/^[■□●○◆◇▶▷►•※*\-]/.test(l) || /^.{1,10}[:：]\s*\S/.test(l)))
    .map((l) => squash(unbullet(l)))
    .filter((l) => l.length >= 4)
    .slice(0, 6);
}

// pages: 사진 [{mimeType, data, previewUrl}] 또는 글자 페이지 [{kind: 'text', text, name}] (js/intake.js)
//   글자 페이지(HWPX, 글자가 있는 PDF)는 글자 인식 없이 바로 날짜 분석, 스캔본 PDF는 사진으로 바뀌어 와서 사진처럼 읽음
// onStatus(text): 진행 상황 표시
export async function analyzeLocally(pages, onStatus) {
  const t0 = performance.now();
  const isText = (p) => p.kind === 'text' && typeof p.text === 'string';
  const images = pages.map((p, i) => ({ p, i })).filter(({ p }) => !isText(p) && p.mimeType?.startsWith('image/'));
  const textCount = pages.filter(isText).length;
  const skipped = pages.length - images.length - textCount;
  if (!images.length && !textCount) {
    throw new Error('스캔한 PDF(글자 없는 PDF)는 Gemini 키가 있어야 읽을 수 있습니다. 설정에서 키를 넣거나, 사진(JPG·PNG)으로 찍어 올려 주세요.');
  }

  let workerReady = null;
  if (images.length) {
    onStatus?.('글자 인식 도구 준비 중… (처음 한 번은 수십 초 걸릴 수 있어요)');
    workerReady = getWorker(); // 테두리 찾는 동안 함께 내려받기
    workerReady.catch(() => {});
  }

  const resultPages = pages.map(() => ({ corners: null, blurry: false }));
  const timings = {};
  const texts = [];
  // 글자 페이지는 올린 순서대로 바로 씀 (사진 글자와 섞일 때도 순서 유지)
  const textAt = new Map(pages.map((p, i) => [i, isText(p) ? tidy(p.text) : null]));
  const flushTextsBefore = (limit) => {
    for (const [i, t] of textAt) if (i < limit && t != null) { texts.push(t); textAt.delete(i); }
  };
  for (let k = 0; k < images.length; k++) {
    const { p, i } = images[k];
    flushTextsBefore(i);
    const label = images.length > 1 ? `${k + 1}/${images.length}쪽 ` : '';
    const img = await loadImg(p.previewUrl || `data:${p.mimeType};base64,${p.data}`);
    const w = img.naturalWidth, h = img.naturalHeight;

    onStatus?.(`${label}문서 테두리 찾는 중…`);
    const tc = performance.now();
    const corners = await detectCornersCV(img);
    timings.cv = (timings.cv || 0) + Math.round(performance.now() - tc);
    resultPages[i].corners = cornersToAI(corners, w, h);
    // 테두리를 찾았으면 반듯하게 편 뒤 읽어야 글자 인식이 훨씬 잘 됨
    const source = corners ? warpDocument(img, corners) : img;

    const worker = await workerReady;
    const to = performance.now();
    progressHandler = (m) => {
      const stage = STAGES[m.status] || m.status;
      onStatus?.(`${label}${stage}${m.status === 'recognizing text' ? ` ${pct(m.progress)}` : ''}`);
    };
    onStatus?.(`${label}글자 읽는 중…`);
    const { data } = await worker.recognize(prepare(source));
    progressHandler = null;
    timings.ocr = (timings.ocr || 0) + Math.round(performance.now() - to);
    texts.push(tidy(data.text || ''));
  }
  flushTextsBefore(Infinity);
  if (textCount) onStatus?.('문서 글자에서 날짜 찾는 중…');

  const text = texts.join('\n\n');
  const lines = text.split('\n').map(squash).filter(Boolean);
  if (!lines.length) {
    throw new Error(images.length
      ? '사진에서 글자를 읽지 못했습니다. 밝은 곳에서 문서가 화면을 채우도록 다시 찍어 주세요.'
      : '문서에서 글자를 찾지 못했습니다.');
  }
  const analysis = analyzeDates(text, new Date());
  const title = guessTitle(lines);
  const { doc_type, audience } = guessType(text, analysis.docType, title);
  const tasks = toTasks(text, analysis, title);
  // 글자 페이지만 있었으면 "글자 인식(OCR)"이 아니라 문서 글자를 그대로 읽은 것
  const how = images.length ? '글자 인식으로' : '문서 글자에서';
  if (!images.length) tasks.forEach((t) => { t.description = t.description.replace('글자 인식으로 찾은', '문서 글자에서 찾은'); });

  const summary = analysis.summary
    ? `${analysis.summary} (키 없이 ${how} 날짜만 찾은 간단 분석입니다.)`
    : `${lines.slice(0, 2).join(' ')} — 문서에서 날짜를 찾지 못했습니다. (키 없이 ${how} 읽은 간단 분석입니다.)`;
  const points = keyPoints(lines, title);
  if (skipped) points.push(`스캔한 PDF ${skipped}개는 Gemini 키가 있어야 읽을 수 있어 건너뛰었습니다.`);

  return {
    doc_type,
    audience,
    title: title || '제목 없음',
    summary,
    key_points: points,
    pages: resultPages,
    reply: null,
    payment: null,
    contacts: findContacts(text),
    tasks,
    local: true,
    ocr_text: text,
    timings: { ...timings, total: Math.round(performance.now() - t0) },
  };
}
