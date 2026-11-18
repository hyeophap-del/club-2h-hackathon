// ③ 날씨 에이전트 — Open-Meteo (무료, 키 불필요)
// 현재 위치(또는 행사 장소)의 오늘 날씨와 최대 16일 후까지의 일별 예보를 알려줍니다.
import { toDateKey } from '../util.js';

const SEOUL = { lat: 37.5665, lng: 126.978, label: '서울(기본값)' };
const CACHE_MS = 30 * 60 * 1000;

// WMO 날씨 코드 → 한국어 + 이모지
const CODES = {
  0: ['맑음', '☀️'], 1: ['대체로 맑음', '🌤️'], 2: ['구름 조금', '⛅'], 3: ['흐림', '☁️'],
  45: ['안개', '🌫️'], 48: ['짙은 안개', '🌫️'],
  51: ['약한 이슬비', '🌦️'], 53: ['이슬비', '🌦️'], 55: ['강한 이슬비', '🌧️'],
  61: ['약한 비', '🌦️'], 63: ['비', '🌧️'], 65: ['강한 비', '🌧️'],
  66: ['어는 비', '🌧️'], 67: ['강한 어는 비', '🌧️'],
  71: ['약한 눈', '🌨️'], 73: ['눈', '🌨️'], 75: ['강한 눈', '❄️'], 77: ['싸락눈', '🌨️'],
  80: ['소나기', '🌦️'], 81: ['소나기', '🌧️'], 82: ['강한 소나기', '⛈️'],
  85: ['눈 소나기', '🌨️'], 86: ['강한 눈 소나기', '❄️'],
  95: ['뇌우', '⛈️'], 96: ['우박 동반 뇌우', '⛈️'], 99: ['강한 우박 뇌우', '⛈️'],
};

export function describe(code) {
  const [text, icon] = CODES[code] || ['알 수 없음', '❔'];
  return { text, icon };
}

// 현재 위치 (권한 거부 시 서울)
export function getCurrentPosition() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(SEOUL);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: '현재 위치' }),
      () => resolve(SEOUL),
      { timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

async function fetchForecast(lat, lng) {
  const key = `wx:${lat.toFixed(2)},${lng.toFixed(2)}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (cached && Date.now() - cached.t < CACHE_MS) return cached.data;
  } catch { /* 캐시 없음 */ }

  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: lat, longitude: lng, timezone: 'Asia/Seoul', forecast_days: 16,
    current: 'temperature_2m,apparent_temperature,weather_code,precipitation',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error('날씨 정보를 가져오지 못했습니다.');
  const data = await res.json();
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch { /* 무시 */ }
  return data;
}

// 오늘 현재 날씨
export async function getCurrentWeather(pos) {
  const p = pos || (await getCurrentPosition());
  const data = await fetchForecast(p.lat, p.lng);
  const c = data.current;
  const today = dayFrom(data, 0);
  return {
    place: p.label,
    temp: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    ...describe(c.weather_code),
    today,
  };
}

function dayFrom(data, i) {
  const d = data.daily;
  return {
    date: d.time[i],
    max: Math.round(d.temperature_2m_max[i]),
    min: Math.round(d.temperature_2m_min[i]),
    rain: d.precipitation_probability_max[i] ?? 0,
    code: d.weather_code[i],
    ...describe(d.weather_code[i]),
  };
}

// 특정 날짜 예보 (16일 이후면 null)
export async function getForecastFor(dateKey, pos) {
  const p = pos || (await getCurrentPosition());
  const data = await fetchForecast(p.lat, p.lng);
  const i = data.daily.time.indexOf(dateKey);
  return i < 0 ? null : { place: p.label, ...dayFrom(data, i) };
}

// 날씨에 따른 조언 (준비물, 옷차림)
export function adviceFor(day) {
  if (!day) return [];
  const tips = [];
  const snowy = [71, 73, 75, 77, 85, 86].includes(day.code);
  if (day.rain >= 50) tips.push(snowy ? '❄️ 눈 예보 — 미끄럼 주의, 일찍 출발' : '☂️ 비 예보 — 우산 챙기기');
  else if (day.rain >= 30) tips.push('🌂 비 올 수도 있음 — 접이식 우산 추천');
  if (day.min <= 0) tips.push('🧤 영하 — 두꺼운 외투·장갑');
  else if (day.min <= 8) tips.push('🧥 쌀쌀함 — 외투 챙기기');
  if (day.max >= 30) tips.push('🥵 더움 — 물·모자 챙기기');
  if ([95, 96, 99].includes(day.code)) tips.push('⛈️ 뇌우 — 야외 활동 주의');
  return tips;
}

export function todayDateKey() {
  return toDateKey(new Date());
}
