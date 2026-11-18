// 메인 에이전트(오케스트레이터)
// AI 호출은 analyzeAgent의 한 번뿐이고, 날씨·이동·문서 펴기는 정해진 계산/API를 부르는 도구로 사용합니다.
//
//   사진(여러 장) ─▶ analyzeDocument (Gemini 1회: 모서리 + 문서 종류 + 요약 + 할 일 + 장소 + 회신 + 납부 + 단계)
//                      ├─▶ scanAgent    : 모서리로 문서 펴기 → JPG/PDF, 보관함 저장
//                      ├─▶ routeAgent   : 장소 검색 → 소요시간 → 출발 시각 → 출발 알람
//                      └─▶ weatherAgent : 그날 날씨 → 우산 자동 추가, 옷차림 조언
//   (키 없음 / 한도 초과) ─▶ analyzeLocally (localAnalyzer: OpenCV 테두리 + Tesseract 글자 인식 + 날짜 규칙, 같은 결과 모양)
import { analyzeDocument } from './analyzeAgent.js';
import { analyzeLocally } from './localAnalyzer.js'; // 키가 없거나 한도 초과일 때: OCR + 날짜 규칙
import { searchPlace, planTrip, departTime } from './routeAgent.js';
import { getForecastFor, adviceFor } from './weatherAgent.js';
import { getSettings, getTasks, updateTask } from '../storage.js';
import { buildReminders } from '../notify.js';
import { todayKey } from '../util.js';

export { analyzeDocument, analyzeLocally };

// 키 없이 간단 분석(OCR + 규칙 기반 날짜)으로 넘어갈 만한 실패인지: 서버 혼잡(재시도 대상) 또는 무료 한도 초과
export function canFallBackLocally(err) {
  return !!err && (err.retryable || /429|한도|quota|RESOURCE_EXHAUSTED/i.test(err.message || ''));
}

// 키가 있으면 Gemini, 없으면 키 없는 간단 분석. onStatus(text)로 진행 상황을 알림
export function analyzeWithFallback(pages, onStatus) {
  return getSettings().apiKey ? analyzeDocument(pages, onStatus) : analyzeLocally(pages, onStatus);
}

const DEMO_HOME = { name: '집(예시: 서초구 반포동)', lat: 37.5045, lng: 127.005 };

// 할 일 하나에 장소·이동 계획을 붙임 (실패해도 할 일은 저장되도록 에러는 메시지로만 돌려줌)
export async function planTaskTrip(task) {
  if (!task.location || !task.dueDate) return { place: null, trip: null, error: null };
  const hasKakao = !!getSettings().kakaoJsKey;
  try {
    let place = null;
    if (hasKakao) place = await searchPlace(task.location);
    // 예시 체험 모드: 카카오 키가 없으면 예시 문서에 넣어 둔 좌표 사용
    if (!place && task.demoPlace && task.demoPlace.name === task.location) place = task.demoPlace;
    if (!place) {
      return {
        place: null, trip: null,
        error: hasKakao ? `"${task.location}"을(를) 지도에서 찾지 못했습니다.` : '설정에서 카카오 키를 넣으면 이동 시간과 출발 시각을 계산해 드립니다.',
      };
    }
    // 예시 체험 모드에서 집 주소를 설정하지 않았다면 예시 출발지(서울 서초구) 사용
    const demoOrigin = place === task.demoPlace && !getSettings().home ? DEMO_HOME : null;
    const trip = await planTrip(place, task.dueDate, task.dueTime, demoOrigin);
    return { place, trip, error: null };
  } catch (err) {
    return { place: null, trip: null, error: err.message };
  }
}

// D-day 브리핑: 할 일 + 그날 날씨(장소 기준) + 조언 + 준비물(비 오면 우산 추가)
export async function buildBriefing(task) {
  const pos = task.place ? { lat: task.place.lat, lng: task.place.lng, label: task.place.name } : undefined;
  let weather = null;
  try {
    weather = await getForecastFor(task.dueDate, pos, task.dueTime);
  } catch { /* 날씨 실패 시 생략 */ }
  const tips = adviceFor(weather);
  const items = [...(task.items || [])];
  if (weather?.rain >= 50 && !items.some((i) => i.includes('우산'))) items.push('우산 (비 예보)');
  if (weather?.air?.level >= 2 && !items.some((i) => i.includes('마스크'))) items.push(`마스크 (미세먼지 ${weather.air.grade})`);
  return { task, weather, tips, items };
}

// 오늘 출발해야 하는 할 일은 지금 위치·교통 기준으로 소요시간을 다시 계산해서 출발 알람을 갱신
export async function refreshTodayTrips() {
  const today = todayKey();
  const targets = getTasks().filter((t) => !t.done && t.dueDate === today && t.dueTime && t.place && getSettings().kakaoJsKey);
  const changed = [];
  for (const t of targets) {
    try {
      const trip = await planTrip(t.place, t.dueDate, t.dueTime);
      const departAt = departTime(t.dueDate, t.dueTime, trip.travelMinutes);
      if (departAt && departAt !== t.travel?.departAt) {
        const keep = (t.reminders || []).filter((r) => !r.label?.includes('출발'));
        const fresh = buildReminders(t.dueDate, t.dueTime, departAt).filter((r) => r.label?.includes('출발'));
        updateTask(t.id, {
          travel: { ...t.travel, minutes: trip.travelMinutes, basis: trip.basis, departAt },
          reminders: [...keep, ...fresh].sort((a, b) => a.at.localeCompare(b.at)),
        });
        changed.push(t.title);
      }
    } catch { /* 다음 기회에 */ }
  }
  return changed;
}
