// ④ 이동 에이전트 — 카카오 API
// 문서에서 찾은 장소를 검색하고, 출발지에서 걸리는 시간과 출발해야 할 시각을 계산합니다.
//  - 장소 검색: 카카오맵 JavaScript SDK (JavaScript 키, 사이트 도메인 등록 필요)
//  - 자동차 소요시간: 카카오모빌리티 길찾기 API (REST API 키)
//  - 대중교통: 카카오맵 길찾기 링크로 안내
import { getSettings } from '../storage.js';
import { toDate } from '../util.js';
import { getCurrentPosition } from './weatherAgent.js';

let sdkPromise = null;

function loadKakaoSdk() {
  const { kakaoJsKey } = getSettings();
  if (!kakaoJsKey) return Promise.reject(new Error('카카오 JavaScript 키가 없습니다. 설정에서 입력해 주세요.'));
  if (window.kakao?.maps?.services) return Promise.resolve(window.kakao);
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(kakaoJsKey)}&libraries=services&autoload=false`;
    s.onload = () => window.kakao.maps.load(() => resolve(window.kakao));
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error('카카오 지도를 불러오지 못했습니다. 키와 등록된 사이트 도메인을 확인해 주세요.'));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

// 장소명 또는 주소 → {name, address, lat, lng}
export async function searchPlace(query, near) {
  const kakao = await loadKakaoSdk();
  const svc = kakao.maps.services;

  const byKeyword = () => new Promise((resolve) => {
    const opts = near ? { location: new kakao.maps.LatLng(near.lat, near.lng), sort: svc.SortBy.ACCURACY } : {};
    new svc.Places().keywordSearch(query, (res, status) => resolve(status === svc.Status.OK ? res[0] : null), opts);
  });
  const byAddress = () => new Promise((resolve) => {
    new svc.Geocoder().addressSearch(query, (res, status) => resolve(status === svc.Status.OK ? res[0] : null));
  });

  const hit = (await byKeyword()) || (await byAddress());
  if (!hit) return null;
  return {
    name: hit.place_name || hit.address_name,
    address: hit.road_address_name || hit.address_name || hit.address?.address_name || '',
    lat: Number(hit.y),
    lng: Number(hit.x),
  };
}

// 출발지: 설정에 저장한 집 주소 좌표, 없으면 현재 위치
export async function getOrigin() {
  const { home } = getSettings();
  if (home?.lat) return { ...home, label: home.name || '집' };
  const pos = await getCurrentPosition();
  return { ...pos, name: pos.label };
}

function straightKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// 자동차 소요시간(분), 거리(km)
async function carRoute(origin, dest) {
  const { kakaoRestKey } = getSettings();
  if (!kakaoRestKey) throw new Error('카카오 REST API 키가 없습니다.');
  const url = new URL('https://apis-navi.kakaomobility.com/v1/directions');
  url.search = new URLSearchParams({ origin: `${origin.lng},${origin.lat}`, destination: `${dest.lng},${dest.lat}` });
  const res = await fetch(url, { headers: { Authorization: `KakaoAK ${kakaoRestKey}` } });
  if (!res.ok) throw new Error(`길찾기 실패 (${res.status})`);
  const data = await res.json();
  const route = data.routes?.[0];
  if (!route || route.result_code !== 0) throw new Error(route?.result_msg || '경로를 찾을 수 없습니다.');
  return { minutes: Math.round(route.summary.duration / 60), km: +(route.summary.distance / 1000).toFixed(1) };
}

// 출발 시각 = 도착 시각 − 이동 시간 − 여유 시간 (도착 시간이 없으면 null)
export function departTime(dueDate, dueTime, travelMinutes) {
  if (!dueDate || !dueTime || travelMinutes == null) return null;
  const { travelBuffer } = getSettings();
  return new Date(toDate(dueDate, dueTime).getTime() - (travelMinutes + travelBuffer) * 60000).toISOString();
}

export function kakaoMapLink(dest) {
  return `https://map.kakao.com/link/to/${encodeURIComponent(dest.name)},${dest.lat},${dest.lng}`;
}

// 핵심 함수: 장소 + 도착 시각 → 이동 계획
// 반환: {origin, dest, car:{minutes,km}|null, walkMinutes, departAt(ISO)|null, mapLink, note}
export async function planTrip(place, dueDate, dueTime, originOverride = null) {
  const origin = originOverride || (await getOrigin());
  const km = straightKm(origin, place);
  let car = null, note = '';
  try {
    car = await carRoute(origin, place);
  } catch (err) {
    // 길찾기 실패 시 직선거리로 대략 계산 (도로는 보통 직선의 1.4배, 평균 30km/h)
    car = { minutes: Math.round(((km * 1.4) / 30) * 60), km: +(km * 1.4).toFixed(1), estimated: true };
    note = `${err.message} — 직선거리로 추정했습니다.`;
  }
  if (km > 100) {
    note += ` 출발지(${origin.name || origin.label})가 ${Math.round(km)}km 떨어져 있습니다. 설정에서 집 주소를 확인해 주세요.`;
  }
  const walkMinutes = km < 5 ? Math.round(((km * 1.3) / 4.5) * 60) : null;

  // 걸어서 20분 이내면 도보 기준, 아니면 자동차 기준으로 출발 시각 계산
  const travelMin = walkMinutes && walkMinutes <= 20 ? walkMinutes : car.minutes;
  const departAt = departTime(dueDate, dueTime, travelMin);

  return {
    origin: { name: origin.name || origin.label, lat: origin.lat, lng: origin.lng },
    dest: place,
    car,
    walkMinutes,
    basis: walkMinutes && walkMinutes <= 20 ? '도보' : '자동차',
    travelMinutes: travelMin,
    departAt,
    mapLink: kakaoMapLink(place),
    note,
  };
}
