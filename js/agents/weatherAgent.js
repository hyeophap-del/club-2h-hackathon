// ③ 날씨 에이전트 — Open-Meteo (무료, 키 불필요)
// 현재 위치(또는 행사 장소)의 오늘 날씨와 최대 16일 후까지의 일별·시간별 예보,
// 미세먼지(PM10/PM2.5, 환경부 기준 등급)와 자외선 지수를 알려줍니다.
// 일부 기능은 팀원 leokiller6646의 dw 브랜치 구현을 참고/이식
// (미세먼지 등급, 자외선, 시간별 예보, BigDataCloud 역지오코딩으로 "내 위치" 지역 이름 표시).
import { toDateKey } from '../util.js';

const SEOUL = { lat: 37.5665, lng: 126.978, label: '서울(기본값)' };
const HERE = '현재 위치';
const CACHE_MS = 30 * 60 * 1000;

// WMO 날씨 코드 → 한국어 + 이모지
const CODES = {
  0: ['맑음', '☀️'], 1: ['대체로 맑음', '🌤️'], 2: ['구름 조금', '⛅'], 3: ['흐림', '☁️'],
  45: ['안개', '🌫️'], 48: ['짙은 안개', '🌫️'],
  51: ['약한 이슬비', '🌦️'], 53: ['이슬비', '🌦️'], 55: ['강한 이슬비', '🌧️'],
  56: ['어는 이슬비', '🌧️'], 57: ['강한 어는 이슬비', '🌧️'],
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
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, label: HERE }),
      () => resolve(SEOUL),
      { timeout: 8000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

// sessionStorage 캐시 (30분)
function cacheGet(key) {
  try {
    const c = JSON.parse(sessionStorage.getItem(key) || 'null');
    if (c && Date.now() - c.t < CACHE_MS) return c.data;
  } catch { /* 캐시 없음 */ }
  return undefined;
}
function cacheSet(key, data) {
  try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), data })); } catch { /* 무시 */ }
}

async function fetchForecast(lat, lng) {
  const key = `wx2:${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.search = new URLSearchParams({
    latitude: lat, longitude: lng, timezone: 'Asia/Seoul', forecast_days: 16,
    current: 'temperature_2m,apparent_temperature,weather_code,precipitation',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,uv_index_max',
  });
  const res = await fetch(url);
  if (!res.ok) throw new Error('날씨 정보를 가져오지 못했습니다.');
  const data = await res.json();
  cacheSet(key, data);
  return data;
}

// 미세먼지: Open-Meteo 대기질 API (시간별 약 5일). 실패하면 null → 미세먼지 줄만 생략
async function fetchAir(lat, lng) {
  const key = `air:${lat.toFixed(2)},${lng.toFixed(2)}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return hit;
  try {
    const url = new URL('https://air-quality-api.open-meteo.com/v1/air-quality');
    url.search = new URLSearchParams({
      latitude: lat, longitude: lng, timezone: 'Asia/Seoul', forecast_days: 5,
      current: 'pm10,pm2_5', hourly: 'pm10,pm2_5',
    });
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    cacheSet(key, data);
    return data;
  } catch {
    return null;
  }
}

// "내 위치" 좌표 → "서울 마포구" 같은 지역 이름 (BigDataCloud, 키 불필요). 실패 시 '현재 위치'
async function areaName(lat, lng) {
  const key = `place:${lat.toFixed(2)},${lng.toFixed(2)}`;
  try { const c = sessionStorage.getItem(key); if (c) return c; } catch { /* 무시 */ }
  try {
    const url = `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=ko`;
    const res = await fetch(url);
    if (!res.ok) return HERE;
    const d = await res.json();
    // "서울특별시" → "서울", 구·시·군(adminLevel 6)이 있으면 그것을, 없으면 동네 이름
    const city = (d.city || d.principalSubdivision || '').replace(/(특별자치시|특별시|광역시)$/, '');
    const admin = d.localityInfo?.administrative || [];
    const district = admin.find((a) => a.adminLevel === 6)?.name || d.locality;
    const name = [city, district].filter((v, i, a) => v && a.indexOf(v) === i).join(' ');
    if (!name) return HERE;
    try { sessionStorage.setItem(key, name); } catch { /* 무시 */ }
    return name;
  } catch {
    return HERE;
  }
}

async function placeLabel(p) {
  return p.label === HERE ? areaName(p.lat, p.lng) : p.label;
}

// 환경부 기준 등급: PM10 0–30/31–80/81–150/151+, PM2.5 0–15/16–35/36–75/76+
const GRADES = ['좋음', '보통', '나쁨', '매우나쁨'];
export function pmGrade(value, kind) {
  if (value == null || Number.isNaN(value)) return null;
  const cut = kind === 'pm10' ? [30, 80, 150] : [15, 35, 75];
  const v = Math.round(value);
  const level = v <= cut[0] ? 0 : v <= cut[1] ? 1 : v <= cut[2] ? 2 : 3;
  return { level, name: GRADES[level] };
}

function airSummary(pm10, pm25) {
  const g10 = pmGrade(pm10, 'pm10');
  const g25 = pmGrade(pm25, 'pm25');
  if (!g10 && !g25) return null;
  const level = Math.max(g10?.level ?? 0, g25?.level ?? 0);
  return {
    pm10: pm10 == null ? null : Math.round(pm10),
    pm25: pm25 == null ? null : Math.round(pm25),
    grade10: g10?.name ?? null, grade25: g25?.name ?? null,
    level, grade: GRADES[level],
  };
}

// 그날의 시간별 최대값 (예보 범위 밖이면 null)
function airForDate(air, dateKey) {
  const h = air?.hourly;
  if (!h) return null;
  let m10 = null, m25 = null;
  h.time.forEach((t, i) => {
    if (!t.startsWith(dateKey)) return;
    if (h.pm10[i] != null) m10 = Math.max(m10 ?? 0, h.pm10[i]);
    if (h.pm2_5[i] != null) m25 = Math.max(m25 ?? 0, h.pm2_5[i]);
  });
  return airSummary(m10, m25);
}

function hourAt(data, i) {
  const h = data.hourly;
  const code = h.weather_code[i];
  return {
    time: h.time[i].slice(11, 16),
    hour: Number(h.time[i].slice(11, 13)),
    temp: Math.round(h.temperature_2m[i]),
    rain: h.precipitation_probability[i] ?? 0,
    code,
    ...describe(code),
  };
}

// 오늘 현재 날씨 (+ 미세먼지, 자외선, 앞으로 몇 시간)
export async function getCurrentWeather(pos) {
  const p = pos || (await getCurrentPosition());
  const [data, air, place] = await Promise.all([fetchForecast(p.lat, p.lng), fetchAir(p.lat, p.lng), placeLabel(p)]);
  const c = data.current;
  const today = dayFrom(data, Math.max(0, data.daily.time.indexOf(c.time.slice(0, 10))));
  today.air = airForDate(air, today.date);
  const nowAir = air?.current ? airSummary(air.current.pm10, air.current.pm2_5) : null;
  // 오늘 조언은 "지금"과 "오늘 최대" 중 나쁜 쪽 미세먼지 기준
  if (nowAir && (!today.air || nowAir.level > today.air.level)) today.air = nowAir;
  let hours = [];
  if (data.hourly) {
    const start = data.hourly.time.findIndex((t) => t.slice(0, 13) >= c.time.slice(0, 13));
    if (start >= 0) for (let i = start + 1; i < Math.min(data.hourly.time.length, start + 7); i++) hours.push(hourAt(data, i));
  }
  return {
    place,
    temp: Math.round(c.temperature_2m),
    feels: Math.round(c.apparent_temperature),
    ...describe(c.weather_code),
    air: nowAir,
    uv: today.uv,
    hours,
    today,
  };
}

function dayFrom(data, i) {
  const d = data.daily;
  const uv = d.uv_index_max?.[i];
  return {
    date: d.time[i],
    max: Math.round(d.temperature_2m_max[i]),
    min: Math.round(d.temperature_2m_min[i]),
    rain: d.precipitation_probability_max[i] ?? 0,
    code: d.weather_code[i],
    uv: uv == null ? null : Math.round(uv),
    ...describe(d.weather_code[i]),
  };
}

// 특정 날짜 예보 (16일 이후면 null)
// time('HH:MM')을 주면 그 시각의 날씨를 at: { time, hour, temp, rain, code, text, icon }로 함께 돌려줌
// 미세먼지는 약 5일 이내 날짜만 air: { grade, level, pm10, pm25, ... } (그날 최대값 기준)
export async function getForecastFor(dateKey, pos, time) {
  const p = pos || (await getCurrentPosition());
  const [data, air, place] = await Promise.all([fetchForecast(p.lat, p.lng), fetchAir(p.lat, p.lng), placeLabel(p)]);
  const i = data.daily.time.indexOf(dateKey);
  if (i < 0) return null;
  const day = { place, ...dayFrom(data, i), air: airForDate(air, dateKey) };
  if (time && /^\d{1,2}:\d{2}/.test(time) && data.hourly) {
    const hh = String(Number(time.split(':')[0])).padStart(2, '0');
    const j = data.hourly.time.indexOf(`${dateKey}T${hh}:00`);
    if (j >= 0) day.at = hourAt(data, j);
  }
  return day;
}

// 날씨에 따른 조언 (준비물, 옷차림, 미세먼지, 자외선)
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
  if (day.air?.level >= 2) tips.push(`😷 미세먼지 ${day.air.grade} — 마스크 챙기기`);
  if (day.uv >= 6) tips.push('🧴 자외선 강함 — 선크림');
  return tips;
}

export function todayDateKey() {
  return toDateKey(new Date());
}
