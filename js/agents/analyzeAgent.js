// ② 분석 역할 — Gemini 호출은 앱 전체에서 이 파일 한 곳, 문서 한 건당 한 번뿐입니다.
// 한 번의 호출로 ①페이지별 문서 모서리 + ②문서 종류·요약·할 일·장소·준비물·회신·납부·연락처·단계 계획을 함께 받습니다.
import { GEMINI_ENDPOINT, LANGUAGES } from '../config.js';
import { getSettings } from '../storage.js';
import { todayKey, weekdayName } from '../util.js';

const POINT = {
  type: 'OBJECT',
  properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } },
  required: ['x', 'y'],
};

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    doc_type: {
      type: 'STRING',
      enum: ['school_notice', 'school_application', 'university_assignment', 'university_notice', 'scholarship', 'bill', 'event', 'other'],
      description: '문서 종류',
    },
    audience: { type: 'STRING', enum: ['parent', 'student', 'general'], description: '이 문서를 받은 사람: 학부모 / 대학생 / 일반' },
    title: { type: 'STRING', description: '문서 제목 또는 한 줄 주제' },
    summary: { type: 'STRING', description: '핵심 요약 3~5문장' },
    key_points: { type: 'ARRAY', items: { type: 'STRING' } },
    pages: {
      type: 'ARRAY',
      description: '첨부한 이미지 순서대로, 사진 속 종이 문서의 네 모서리',
      items: {
        type: 'OBJECT',
        properties: {
          corners: {
            type: 'OBJECT',
            nullable: true,
            description: '이미지 너비·높이를 각각 0~1000으로 본 좌표. 경계를 찾을 수 없으면 null',
            properties: { top_left: POINT, top_right: POINT, bottom_right: POINT, bottom_left: POINT },
            required: ['top_left', 'top_right', 'bottom_right', 'bottom_left'],
          },
          blurry: { type: 'BOOLEAN', description: '글자를 읽기 어려울 만큼 흐리거나 잘렸는지' },
        },
        required: ['corners', 'blurry'],
      },
    },
    reply: {
      type: 'OBJECT',
      nullable: true,
      description: '회신·서명·동의서 제출이 필요한 문서면 그 정보, 아니면 null',
      properties: {
        due_date: { type: 'STRING', nullable: true },
        method: { type: 'STRING', description: '제출 방법 (예: 담임 선생님께 제출, 온라인 설문)' },
        what: { type: 'STRING', description: '무엇을 회신하는지 (예: 참가 동의서)' },
      },
      required: ['due_date', 'method', 'what'],
    },
    payment: {
      type: 'OBJECT',
      nullable: true,
      description: '납부해야 할 돈이 있으면 그 정보, 없으면 null',
      properties: {
        amount: { type: 'STRING', description: '금액 (예: 35,000원)' },
        bank: { type: 'STRING', nullable: true },
        account: { type: 'STRING', nullable: true, description: '계좌번호' },
        holder: { type: 'STRING', nullable: true, description: '예금주' },
        due_date: { type: 'STRING', nullable: true },
        method: { type: 'STRING', nullable: true, description: '스쿨뱅킹 자동이체 등 납부 방법' },
      },
      required: ['amount', 'bank', 'account', 'holder', 'due_date', 'method'],
    },
    contacts: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { name: { type: 'STRING' }, phone: { type: 'STRING' } },
        required: ['name', 'phone'],
      },
    },
    tasks: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          kind: { type: 'STRING', enum: ['event', 'deadline', 'reply', 'payment', 'prep'], description: '참석/마감/회신/납부/준비' },
          title: { type: 'STRING' },
          description: { type: 'STRING' },
          due_date: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD' },
          due_time: { type: 'STRING', nullable: true, description: 'HH:MM' },
          location: { type: 'STRING', nullable: true },
          items: { type: 'ARRAY', items: { type: 'STRING' } },
          confidence: { type: 'STRING', enum: ['high', 'low'], description: '날짜·내용을 확실히 읽었으면 high' },
          steps: {
            type: 'ARRAY',
            description: '큰 과제를 마감일부터 거꾸로 나눈 단계 (대학생 과제·시험·지원서 등). 필요 없으면 빈 배열',
            items: {
              type: 'OBJECT',
              properties: { title: { type: 'STRING' }, date: { type: 'STRING', description: 'YYYY-MM-DD' } },
              required: ['title', 'date'],
            },
          },
          source_text: { type: 'STRING' },
        },
        required: ['kind', 'title', 'description', 'due_date', 'due_time', 'location', 'items', 'confidence', 'steps', 'source_text'],
      },
    },
  },
  required: ['doc_type', 'audience', 'title', 'summary', 'key_points', 'pages', 'reply', 'payment', 'contacts', 'tasks'],
};

function buildPrompt(pageCount, language) {
  const today = todayKey();
  const weekday = weekdayName(new Date());
  const lang = LANGUAGES[language] || LANGUAGES.ko;
  return `당신은 학부모와 대학생이 받은 문서를 읽고 해야 할 일을 정리해 주는 비서입니다.
오늘 날짜는 ${today} (${weekday}요일), 시간대는 한국(Asia/Seoul)입니다.
첨부한 ${pageCount}장의 이미지/PDF는 하나의 문서입니다. 순서대로 읽으세요.

[작성할 내용]
1. doc_type, audience: 문서 종류와 받는 사람. 가정통신문·체험학습·방과후 안내는 학부모(parent), 과제·강의·장학금·학과 공지는 대학생(student).
2. title, summary(3~5문장), key_points
3. tasks: 받은 사람이 해야 할 행동만 넣으세요.
   - kind: event(참석·방문), deadline(제출·신청 마감), reply(회신서·동의서 제출), payment(납부), prep(미리 준비)
   - 상대 날짜("다음 주 금요일까지", "3일 이내")는 오늘 기준으로 계산해 YYYY-MM-DD로. 연도가 없으면 오늘 이후 가장 가까운 날짜.
   - 날짜를 알 수 없으면 due_date는 null. 추측하지 마세요. 애매하게 읽은 항목은 confidence를 low로.
   - location: 직접 가야 하는 장소를 지도에서 검색할 수 있는 이름·주소로 (예: "국립과천과학관"). 없으면 null.
   - items: 챙겨야 할 준비물·서류.
   - steps: 대학생 과제·발표·시험·지원서처럼 준비가 필요한 일이고 마감까지 3일 이상 남았으면, 마감일부터 거꾸로 계산해 2~4단계(예: 자료 조사 → 초안 → 검토)로 나누고 각 단계 날짜를 오늘~마감 사이로 정하세요. 그 외에는 빈 배열.
   - source_text: 근거 문장을 원문 그대로.
4. reply: 회신·서명·동의서 제출이 필요하면 채우고, tasks에도 kind=reply 할 일을 넣으세요. 필요 없으면 null.
5. payment: 납부할 돈이 있으면 채우고, tasks에도 kind=payment 할 일을 넣으세요. 없으면 null.
6. contacts: 문의처 이름과 전화번호.
7. pages: 이미지마다 종이 문서의 네 모서리 좌표(너비·높이를 0~1000으로 환산)와 흐림 여부. PDF 페이지는 corners를 null로.

[언어] title, summary, key_points, tasks의 title·description은 ${lang.prompt}로 쓰세요. source_text만 원문 그대로 둡니다.
글자가 흐리거나 잘려 읽을 수 없는 부분은 지어내지 마세요.`;
}

function isValidResult(r) {
  return r && typeof r.summary === 'string' && Array.isArray(r.tasks);
}

function normalize(r, pageCount) {
  r.pages = Array.from({ length: pageCount }, (_, i) => r.pages?.[i] || { corners: null, blurry: false });
  r.contacts ||= [];
  r.key_points ||= [];
  r.tasks = r.tasks.map((t) => ({ items: [], steps: [], confidence: 'high', kind: 'deadline', ...t }));
  return r;
}

async function callGemini(pages, apiKey, model, language) {
  let res;
  try {
    res = await fetch(GEMINI_ENDPOINT(model), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              ...pages.map((p) => ({ inlineData: { mimeType: p.mimeType, data: p.data } })),
              { text: buildPrompt(pages.length, language) },
            ],
          },
        ],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
        },
      }),
    });
  } catch {
    throw new Error('네트워크 오류입니다. 인터넷 연결을 확인해 주세요.');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body?.error?.message || '';
    if (res.status === 429) throw new Error('무료 사용량 한도에 도달했습니다. 잠시 후 다시 시도하거나 "예시로 체험하기"를 이용해 주세요.');
    if (res.status === 400 && /API key/i.test(msg)) throw new Error('API 키가 올바르지 않습니다. 설정에서 확인해 주세요.');
    if (res.status === 403) throw new Error('API 키 권한이 없습니다. 설정에서 키를 확인해 주세요.');
    if (res.status === 404) throw new Error(`모델(${model})을 찾을 수 없습니다. 설정에서 모델 이름을 확인해 주세요.`);
    throw new Error(`분석 실패 (${res.status}) ${msg}`);
  }

  const body = await res.json();
  const text = body?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('');
  if (!text) throw new Error('문서를 분석하지 못했습니다. 더 선명한 사진으로 다시 시도해 주세요.');
  return JSON.parse(text);
}

// pages: [{mimeType, data}] (한 문서의 여러 장)
export async function analyzeDocument(pages) {
  const { apiKey, model, language } = getSettings();
  if (!apiKey) throw new Error('API 키가 없습니다. 설정에서 Gemini API 키를 입력하거나 "예시로 체험하기"를 눌러 주세요.');

  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await callGemini(pages, apiKey, model, language);
      if (isValidResult(result)) return normalize(result, pages.length);
      lastError = new Error('AI 응답 형식이 올바르지 않습니다.');
    } catch (err) {
      lastError = err;
      // JSON 파싱 오류만 재시도, 나머지(키 오류, 한도 초과)는 바로 중단
      if (!(err instanceof SyntaxError)) throw err;
    }
  }
  throw lastError;
}

export const DOC_TYPES = {
  school_notice: { label: '가정통신문', icon: '🏫' },
  school_application: { label: '학교 신청서', icon: '📝' },
  university_assignment: { label: '과제', icon: '📚' },
  university_notice: { label: '학과 공지', icon: '🎓' },
  scholarship: { label: '장학·지원', icon: '💰' },
  bill: { label: '고지서', icon: '🧾' },
  event: { label: '행사 안내', icon: '🎪' },
  other: { label: '기타 문서', icon: '📄' },
};

export const AUDIENCES = { parent: '학부모용', student: '대학생용', general: '일반' };

export const TASK_KINDS = {
  event: { label: '참석', cls: 'k-event' },
  deadline: { label: '마감', cls: 'k-deadline' },
  reply: { label: '회신', cls: 'k-reply' },
  payment: { label: '납부', cls: 'k-payment' },
  prep: { label: '준비', cls: 'k-prep' },
  step: { label: '단계', cls: 'k-step' },
};
