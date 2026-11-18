/*
 * 날씨 에이전트: Open-Meteo(키 없이 쓰는 공개 API)로 오늘 날씨·시간별·16일 예보와
 * 미세먼지를 가져오고, 옷차림·우산 같은 조언을 문장으로 만든다.
 */
const Weather = (() => {
  "use strict";

  const WMO = {
    0: ["맑음", "☀️"], 1: ["대체로 맑음", "🌤️"], 2: ["구름 조금", "⛅"], 3: ["흐림", "☁️"],
    45: ["안개", "🌫️"], 48: ["짙은 안개", "🌫️"],
    51: ["약한 이슬비", "🌦️"], 53: ["이슬비", "🌦️"], 55: ["굵은 이슬비", "🌧️"],
    56: ["어는 이슬비", "🌧️"], 57: ["강한 어는 이슬비", "🌧️"],
    61: ["약한 비", "🌦️"], 63: ["비", "🌧️"], 65: ["강한 비", "🌧️"],
    66: ["어는 비", "🌧️"], 67: ["강한 어는 비", "🌧️"],
    71: ["약한 눈", "🌨️"], 73: ["눈", "🌨️"], 75: ["많은 눈", "❄️"], 77: ["싸락눈", "🌨️"],
    80: ["약한 소나기", "🌦️"], 81: ["소나기", "🌧️"], 82: ["강한 소나기", "⛈️"],
    85: ["약한 눈 소나기", "🌨️"], 86: ["강한 눈 소나기", "❄️"],
    95: ["뇌우", "⛈️"], 96: ["우박을 동반한 뇌우", "⛈️"], 99: ["강한 우박 뇌우", "⛈️"],
  };
  const NIGHT_ICON = { 0: "🌙", 1: "🌙" };

  function describe(code, isDay = 1) {
    const [text, icon] = WMO[code] || ["알 수 없음", "🌡️"];
    return { text, icon: !isDay && NIGHT_ICON[code] ? NIGHT_ICON[code] : icon };
  }

  async function getJSON(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`날씨 서버 응답 오류 (${res.status})`);
    return res.json();
  }

  function currentPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error("이 브라우저는 위치 확인을 지원하지 않습니다."));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        (err) => reject(new Error(err.code === 1
          ? "위치 권한이 거부되었습니다. 도시 이름으로 검색하세요."
          : "현재 위치를 확인하지 못했습니다. 도시 이름으로 검색하세요.")),
        { timeout: 10000, maximumAge: 10 * 60 * 1000 }
      );
    });
  }

  async function placeName(lat, lon) {
    try {
      const d = await getJSON(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=ko`);
      return [d.city || d.principalSubdivision, d.locality].filter((v, i, a) => v && a.indexOf(v) === i).join(" ") || "현재 위치";
    } catch (_) {
      return "현재 위치";
    }
  }

  async function search(name) {
    const d = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=ko&format=json`);
    return (d.results || []).map((r) => ({
      name: r.name,
      detail: [r.admin1, r.country].filter(Boolean).join(", "),
      lat: r.latitude,
      lon: r.longitude,
    }));
  }

  async function forecast(lat, lon) {
    const q = new URLSearchParams({
      latitude: lat.toFixed(4),
      longitude: lon.toFixed(4),
      current: "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,is_day",
      hourly: "temperature_2m,precipitation_probability,weather_code,is_day",
      daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,uv_index_max,sunrise,sunset",
      wind_speed_unit: "ms",
      timezone: "auto",
      forecast_days: "16",
    });
    return getJSON(`https://api.open-meteo.com/v1/forecast?${q}`);
  }

  async function air(lat, lon) {
    try {
      const d = await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&current=pm10,pm2_5&timezone=auto`);
      return d.current || null;
    } catch (_) {
      return null;
    }
  }

  // 환경부 기준 등급
  function pmGrade(value, kind) {
    if (value == null) return null;
    const cut = kind === "pm10" ? [30, 80, 150] : [15, 35, 75];
    const names = ["좋음", "보통", "나쁨", "매우 나쁨"];
    const level = value <= cut[0] ? 0 : value <= cut[1] ? 1 : value <= cut[2] ? 2 : 3;
    return { level, name: names[level] };
  }

  function outfit(t) {
    if (t >= 28) return "민소매나 반팔, 반바지처럼 가볍게 입으세요.";
    if (t >= 23) return "반팔이나 얇은 셔츠면 충분합니다.";
    if (t >= 20) return "얇은 긴팔이나 가디건이 알맞습니다.";
    if (t >= 17) return "얇은 니트나 맨투맨을 입으세요.";
    if (t >= 12) return "자켓이나 가디건을 챙기세요.";
    if (t >= 9) return "트렌치코트나 야상처럼 겉옷이 필요합니다.";
    if (t >= 5) return "코트에 내복이나 히트텍을 받쳐 입으세요.";
    return "패딩과 목도리로 단단히 챙겨 입으세요.";
  }

  function todayIndex(data) {
    const today = data.current.time.slice(0, 10);
    const i = data.daily.time.indexOf(today);
    return i < 0 ? 0 : i;
  }

  function briefing(data, airNow) {
    const c = data.current;
    const di = todayIndex(data);
    const d = data.daily;
    const hi = d.temperature_2m_max[di], lo = d.temperature_2m_min[di];
    const pop = d.precipitation_probability_max[di];
    const uv = d.uv_index_max[di];
    const lines = [];

    lines.push(`지금 ${Math.round(c.temperature_2m)}°C, 체감 ${Math.round(c.apparent_temperature)}°C입니다. ${outfit(c.apparent_temperature)}`);

    if (c.precipitation > 0 || pop >= 60) lines.push(`오늘 강수 확률이 ${pop ?? "?"}%입니다. 우산을 꼭 챙기세요.`);
    else if (pop >= 30) lines.push(`강수 확률 ${pop}%로 비 소식이 조금 있습니다. 작은 우산이 있으면 좋겠어요.`);
    else lines.push(`비 소식은 없습니다 (강수 확률 ${pop ?? 0}%).`);

    if (hi - lo >= 10) lines.push(`일교차가 ${Math.round(hi - lo)}°C로 큽니다. 아침저녁에 입을 겉옷을 챙기세요.`);
    if (uv >= 8) lines.push(`자외선 지수가 ${Math.round(uv)}(매우 높음)입니다. 한낮 외출은 피하고 자외선 차단제를 바르세요.`);
    else if (uv >= 6) lines.push(`자외선 지수 ${Math.round(uv)}(높음). 자외선 차단제를 바르세요.`);
    if (c.wind_speed_10m >= 9) lines.push(`바람이 초속 ${Math.round(c.wind_speed_10m)}m로 강합니다.`);

    if (airNow) {
      const g10 = pmGrade(airNow.pm10, "pm10"), g25 = pmGrade(airNow.pm2_5, "pm25");
      const worst = Math.max(g10 ? g10.level : 0, g25 ? g25.level : 0);
      if (worst >= 2) lines.push("미세먼지가 나쁩니다. 마스크를 쓰고 바깥 활동을 줄이세요.");
      else lines.push(`미세먼지는 ${worst === 0 ? "좋음" : "보통"} 수준입니다.`);
    }
    return lines;
  }

  /** 문서 날짜(iso)에 해당하는 일별 예보. 예보 범위 밖이면 null. */
  function dayForecast(data, iso) {
    const i = data.daily.time.indexOf(iso);
    if (i < 0) return null;
    const d = data.daily;
    return {
      iso,
      ...describe(d.weather_code[i]),
      hi: d.temperature_2m_max[i],
      lo: d.temperature_2m_min[i],
      pop: d.precipitation_probability_max[i],
      rain: d.precipitation_sum[i],
      uv: d.uv_index_max[i],
    };
  }

  function nextHours(data, count = 24) {
    const h = data.hourly;
    const nowHour = data.current.time.slice(0, 13);
    let start = h.time.findIndex((t) => t.slice(0, 13) >= nowHour);
    if (start < 0) start = 0;
    const out = [];
    for (let i = start; i < Math.min(h.time.length, start + count); i++) {
      out.push({
        time: h.time[i],
        hour: +h.time[i].slice(11, 13),
        temp: h.temperature_2m[i],
        pop: h.precipitation_probability[i],
        ...describe(h.weather_code[i], h.is_day[i]),
      });
    }
    return out;
  }

  return { describe, currentPosition, placeName, search, forecast, air, pmGrade, briefing, dayForecast, nextHours, outfit, todayIndex };
})();
