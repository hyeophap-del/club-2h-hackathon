// 앱 전체 설정값. 모델명은 Google AI Studio(https://aistudio.google.com)에서
// 현재 무료로 제공되는 Flash 계열 모델 이름을 확인한 뒤 바꿔 주세요.
export const GEMINI_MODEL = 'gemini-flash-latest'; // 항상 최신 Flash 모델을 가리키는 별칭

export const GEMINI_ENDPOINT = (model) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// 요약 언어 (다문화 가정, 유학생, 쉬운 말이 필요한 사용자)
export const LANGUAGES = {
  ko: { label: '한국어', prompt: '한국어' },
  easy: { label: '쉬운 한국어', prompt: '초등학생도 이해할 수 있는 쉬운 한국어(어려운 한자어는 풀어서)' },
  en: { label: 'English', prompt: 'English' },
  zh: { label: '中文', prompt: '简体中文' },
  vi: { label: 'Tiếng Việt', prompt: 'Tiếng Việt' },
};

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: GEMINI_MODEL,
  language: 'ko',
  // 알람 기본값: 마감 하루 전, 마감 당일 아침, 매일 아침 브리핑
  remindDayBefore: true,
  remindMorningOf: true,
  morningHour: 9,
  morningBriefing: true,
  // 카카오 (https://developers.kakao.com → 내 애플리케이션)
  kakaoJsKey: '',   // 장소 검색 (카카오맵 JavaScript SDK)
  kakaoRestKey: '', // 자동차 소요시간 (카카오모빌리티 길찾기)
  home: null,       // 출발지 {name, address, lat, lng}. 없으면 현재 위치
  travelBuffer: 10, // 출발 시각 계산 시 여유 시간(분)
};

// 알람 확인 주기(ms)
export const REMINDER_CHECK_INTERVAL = 30 * 1000;

// 한 번에 올릴 수 있는 최대 장수
export const MAX_PAGES = 5;
