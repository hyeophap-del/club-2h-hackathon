/*
 * 세 에이전트를 잇는 화면 로직.
 * 스캔(1) → 날짜 읽기(2) → 그 날짜의 날씨(3) 순서로 결과가 흘러간다.
 */
(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    todayLabel: $("todayLabel"), todayChip: $("todayWeatherChip"),
    scanStatus: $("scanStatus"), readStatus: $("readStatus"), weatherStatus: $("weatherStatus"),
    dropzone: $("dropzone"), fileInput: $("fileInput"), cameraInput: $("cameraInput"),
    editor: $("editor"), editorHint: $("editorHint"), editorCanvas: $("editorCanvas"),
    redetectBtn: $("redetectBtn"), fullFrameBtn: $("fullFrameBtn"), cancelEditBtn: $("cancelEditBtn"), cropBtn: $("cropBtn"),
    result: $("result"), resultCanvas: $("resultCanvas"), pages: $("pages"), rotateBtn: $("rotateBtn"),
    pdfBtn: $("pdfBtn"), jpgBtn: $("jpgBtn"), addPageBtn: $("addPageBtn"), analyzeBtn: $("analyzeBtn"),
    autoAnalyze: $("autoAnalyze"), cvNote: $("cvNote"),
    verdict: $("verdict"), ocrProgress: $("ocrProgress"), ocrBar: $("ocrBar"), ocrMsg: $("ocrMsg"),
    dateList: $("dateList"), ocrText: $("ocrText"), ocrEdit: $("ocrEdit"),
    editTextBtn: $("editTextBtn"), copyTextBtn: $("copyTextBtn"), editActions: $("editActions"),
    cancelTextBtn: $("cancelTextBtn"), reanalyzeBtn: $("reanalyzeBtn"),
    weatherPlace: $("weatherPlace"), placeForm: $("placeForm"), placeInput: $("placeInput"),
    placeResults: $("placeResults"), locateBtn: $("locateBtn"), weatherBody: $("weatherBody"),
    toast: $("toast"),
  };

  const state = {
    queue: [],
    source: null,
    pages: [],      // { base, filter, out, thumb }
    current: -1,
    filter: "enhance",
    text: "",
    analysis: null,
    chosen: null,   // 사용자가 목록에서 고른 날짜 index
    weather: null,
    air: null,
    place: null,
    ocrRunning: false,
  };

  const editor = new CornerEditor(el.editorCanvas);
  const DEFAULT_PLACE = { name: "서울", lat: 37.5665, lon: 126.978 };

  /* ---------- 공통 ---------- */

  function setStatus(node, status, text) {
    node.dataset.status = status;
    node.textContent = text;
  }

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3200);
  }

  function escapeHTML(s) {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* 저장소를 못 써도 동작에는 지장 없음 */ }
  }
  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
  }

  const today = new Date();
  el.todayLabel.textContent = `${today.getFullYear()}년 ${today.getMonth() + 1}월 ${today.getDate()}일 ${DateAgent.WEEKDAYS[today.getDay()]}요일`;

  /* ---------- 1. 스캔 에이전트 ---------- */

  Scanner.onReady((ok) => {
    el.cvNote.textContent = ok ? "" : "테두리 자동 인식 엔진을 불러오지 못했습니다. 모서리를 직접 맞춰서 스캔할 수 있어요.";
    if (ok && !el.editor.hidden && state.source) detect();
  });

  function handleFiles(files) {
    const images = [...files].filter((f) => f.type.startsWith("image/"));
    if (!images.length) { toast("이미지 파일만 스캔할 수 있습니다."); return; }
    state.queue.push(...images);
    if (el.editor.hidden) openNext();
  }

  async function openNext() {
    const file = state.queue.shift();
    if (!file) return;
    setStatus(el.scanStatus, "working", "사진 여는 중");
    try {
      state.source = await Scanner.loadFile(file);
    } catch (err) {
      setStatus(el.scanStatus, "error", "열기 실패");
      toast(err.message);
      openNext();
      return;
    }
    el.dropzone.hidden = true;
    el.result.hidden = true;
    el.editor.hidden = false;
    editor.setImage(state.source, Scanner.defaultCorners(state.source.width, state.source.height));
    detect();
    el.cropBtn.focus({ preventScroll: true });
  }

  function detect() {
    const { width: w, height: h } = state.source;
    if (!Scanner.isReady()) {
      editor.setCorners(Scanner.defaultCorners(w, h));
      el.editorHint.textContent = "자동 인식 엔진을 준비하는 중입니다. 모서리 점을 끌어 문서 영역을 직접 맞출 수 있어요.";
      setStatus(el.scanStatus, "working", "모서리 조정");
      return;
    }
    setStatus(el.scanStatus, "working", "테두리 찾는 중");
    const found = Scanner.detectCorners(state.source);
    if (found && found.confident) {
      editor.setCorners(found.corners);
      el.editorHint.textContent = "문서 테두리를 찾았습니다. 어긋난 곳이 있으면 모서리 점을 끌어서 맞추세요.";
    } else if (found) {
      editor.setCorners(found.corners);
      el.editorHint.textContent = "테두리가 뚜렷하지 않아 대략 맞췄습니다. 모서리 점을 문서 꼭짓점에 맞춰 주세요.";
    } else {
      editor.setCorners(Scanner.defaultCorners(w, h));
      el.editorHint.textContent = "문서 테두리를 찾지 못했습니다. 모서리 점을 문서 꼭짓점으로 끌어 주세요.";
    }
    setStatus(el.scanStatus, "working", "모서리 조정");
  }

  function closeEditor() {
    el.editor.hidden = true;
    state.source = null;
    if (state.pages.length) el.result.hidden = false;
    else el.dropzone.hidden = false;
  }

  function crop() {
    const corners = editor.getCorners();
    const { width: w, height: h } = state.source;
    if (Scanner.quadArea(corners) < w * h * 0.02) {
      toast("문서 영역이 너무 작습니다. 모서리 점을 문서 꼭짓점에 맞춰 주세요.");
      return;
    }
    setStatus(el.scanStatus, "working", "문서 펴는 중");
    el.cropBtn.disabled = true;
    // 화면이 상태 표시를 그릴 틈을 준 뒤 무거운 계산을 시작
    requestAnimationFrame(() => setTimeout(() => {
      try {
        const base = Scanner.warp(state.source, corners);
        addPage(base);
        el.cropBtn.disabled = false;
        closeEditor();
        setStatus(el.scanStatus, "done", `스캔 완료 ${state.pages.length}쪽`);
        if (state.queue.length) openNext();
        else if (el.autoAnalyze.checked) analyzePages();
      } catch (err) {
        el.cropBtn.disabled = false;
        setStatus(el.scanStatus, "error", "스캔 실패");
        toast(err.message);
      }
    }, 30));
  }

  function makeThumb(canvas) {
    const s = 120 / canvas.height;
    const t = document.createElement("canvas");
    t.width = Math.max(1, Math.round(canvas.width * s));
    t.height = 120;
    t.getContext("2d").drawImage(canvas, 0, 0, t.width, t.height);
    return t.toDataURL("image/jpeg", 0.7);
  }

  function renderPage(page) {
    page.out = Scanner.applyFilter(page.base, page.filter);
    page.thumb = makeThumb(page.out);
  }

  function addPage(base) {
    const page = { base, filter: state.filter };
    renderPage(page);
    state.pages.push(page);
    selectPage(state.pages.length - 1);
  }

  function selectPage(i) {
    state.current = i;
    const page = state.pages[i];
    if (!page) return;
    const c = el.resultCanvas;
    c.width = page.out.width;
    c.height = page.out.height;
    c.getContext("2d").drawImage(page.out, 0, 0);
    document.querySelectorAll(".segmented button").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.filter === page.filter)));
    renderThumbs();
  }

  function renderThumbs() {
    el.pages.innerHTML = "";
    if (state.pages.length < 2) return;
    state.pages.forEach((p, i) => {
      const wrap = document.createElement("div");
      wrap.style.position = "relative";
      const b = document.createElement("button");
      b.type = "button";
      b.className = "page-thumb";
      b.setAttribute("aria-label", `${i + 1}쪽 보기`);
      b.setAttribute("aria-current", String(i === state.current));
      b.innerHTML = `<img src="${p.thumb}" alt=""><span class="page-thumb__num">${i + 1}</span>`;
      b.addEventListener("click", () => selectPage(i));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "page-thumb__del";
      del.setAttribute("aria-label", `${i + 1}쪽 삭제`);
      del.textContent = "×";
      del.addEventListener("click", () => removePage(i));
      wrap.append(b, del);
      el.pages.appendChild(wrap);
    });
  }

  function removePage(i) {
    state.pages.splice(i, 1);
    if (!state.pages.length) {
      state.current = -1;
      el.result.hidden = true;
      el.dropzone.hidden = false;
      setStatus(el.scanStatus, "idle", "대기");
      return;
    }
    selectPage(Math.min(i, state.pages.length - 1));
    setStatus(el.scanStatus, "done", `스캔 완료 ${state.pages.length}쪽`);
  }

  // 사진 넣는 방법: 선택, 촬영, 끌어놓기, 붙여넣기
  el.fileInput.addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });
  el.cameraInput.addEventListener("change", (e) => { handleFiles(e.target.files); e.target.value = ""; });
  el.dropzone.addEventListener("click", (e) => { if (!e.target.closest("label")) el.fileInput.click(); });
  el.dropzone.addEventListener("keydown", (e) => {
    if (e.target === el.dropzone && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); el.fileInput.click(); }
  });
  ["dragenter", "dragover"].forEach((t) => el.dropzone.addEventListener(t, (e) => { e.preventDefault(); el.dropzone.classList.add("is-over"); }));
  ["dragleave", "drop"].forEach((t) => el.dropzone.addEventListener(t, () => el.dropzone.classList.remove("is-over")));
  el.dropzone.addEventListener("drop", (e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); });
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    if (!el.dropzone.contains(e.target) && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });
  window.addEventListener("paste", (e) => {
    if (e.target.closest && e.target.closest("textarea, input")) return;
    const files = [...(e.clipboardData?.items || [])].filter((it) => it.type.startsWith("image/")).map((it) => it.getAsFile());
    if (files.length) handleFiles(files);
  });

  el.redetectBtn.addEventListener("click", detect);
  el.fullFrameBtn.addEventListener("click", () => {
    editor.setCorners(Scanner.fullCorners(state.source.width, state.source.height));
    el.editorHint.textContent = "사진 전체를 문서로 사용합니다.";
  });
  el.cancelEditBtn.addEventListener("click", () => {
    state.queue = [];
    closeEditor();
    setStatus(el.scanStatus, state.pages.length ? "done" : "idle", state.pages.length ? `스캔 완료 ${state.pages.length}쪽` : "대기");
  });
  el.cropBtn.addEventListener("click", crop);

  document.querySelectorAll(".segmented button").forEach((b) => b.addEventListener("click", () => {
    const page = state.pages[state.current];
    if (!page) return;
    state.filter = b.dataset.filter;
    page.filter = b.dataset.filter;
    renderPage(page);
    selectPage(state.current);
  }));

  el.rotateBtn.addEventListener("click", () => {
    const page = state.pages[state.current];
    if (!page) return;
    page.base = Scanner.rotate90(page.base);
    renderPage(page);
    selectPage(state.current);
  });

  el.addPageBtn.addEventListener("click", () => el.fileInput.click());

  el.jpgBtn.addEventListener("click", async () => {
    if (!state.pages.length) return;
    try {
      if (state.pages.length === 1) {
        const name = await Scanner.exportJPG(state.pages[0].out);
        toast(`${name} 파일을 저장했습니다.`);
      } else {
        for (let i = 0; i < state.pages.length; i++) await Scanner.exportJPG(state.pages[i].out, i);
        toast(`JPG ${state.pages.length}장을 저장했습니다.`);
      }
    } catch (err) { toast(err.message); }
  });

  el.pdfBtn.addEventListener("click", () => {
    if (!state.pages.length) return;
    try {
      const name = Scanner.exportPDF(state.pages.map((p) => p.out));
      toast(`${name} 파일을 저장했습니다 (${state.pages.length}쪽).`);
    } catch (err) { toast(err.message); }
  });

  el.analyzeBtn.addEventListener("click", analyzePages);

  /* ---------- 2. 날짜 분석 에이전트 ---------- */

  async function analyzePages() {
    if (!state.pages.length || state.ocrRunning) return;
    state.ocrRunning = true;
    el.analyzeBtn.disabled = true;
    el.ocrProgress.hidden = false;
    el.ocrBar.style.width = "0%";
    el.ocrMsg.textContent = "글자 인식 준비 중 (처음에는 언어 데이터를 내려받느라 조금 걸립니다)";
    setStatus(el.readStatus, "working", "글자 읽는 중");
    try {
      const { text, confidence } = await OCR.recognize(state.pages.map((p) => p.out), (p) => {
        el.ocrMsg.textContent = p.label;
        el.ocrBar.style.width = `${Math.round(p.progress * 100)}%`;
      });
      el.ocrProgress.hidden = true;
      if (!text.trim()) {
        setStatus(el.readStatus, "error", "글자 없음");
        el.verdict.innerHTML = `<p class="verdict__empty">글자를 찾지 못했습니다. '흑백 문서' 보정을 고르거나 더 밝고 가까이 찍은 사진으로 다시 시도하세요. 글자를 직접 붙여넣어도 됩니다.</p>`;
        renderText("", null);
        return;
      }
      runAnalysis(text, confidence);
    } catch (err) {
      console.error(err);
      el.ocrProgress.hidden = true;
      setStatus(el.readStatus, "error", "인식 실패");
      toast(err.message || "글자를 인식하지 못했습니다.");
    } finally {
      state.ocrRunning = false;
      el.analyzeBtn.disabled = false;
    }
  }

  function runAnalysis(text, confidence) {
    state.text = text;
    state.analysis = DateAgent.analyze(text, new Date());
    state.chosen = null;
    renderAnalysis(confidence);
    renderDocDay();
    const p = state.analysis.primary;
    setStatus(el.readStatus, "done", p ? "날짜 찾음" : "날짜 없음");
  }

  function chosenDate() {
    const a = state.analysis;
    if (!a || !a.dates.length) return null;
    return state.chosen != null ? a.dates[state.chosen] : a.primary;
  }

  function renderAnalysis(confidence) {
    const a = state.analysis;
    const p = chosenDate();
    if (!p) {
      el.verdict.innerHTML = `<p class="verdict__empty">문서에서 날짜를 찾지 못했습니다. 인식된 글자를 확인하고, 날짜가 잘못 읽혔다면 '직접 고치기'로 바로잡은 뒤 다시 분석하세요.</p>`;
    } else {
      const isAuto = state.chosen == null;
      const kicker = isAuto ? "이 문서가 필요한 날" : "직접 고른 날짜";
      const notes = [];
      if (p.inferredYear) notes.push("문서에 연도가 없어 가까운 해로 추정했습니다.");
      if (p.relative) notes.push("'오늘·내일' 같은 표현은 오늘을 기준으로 계산했습니다.");
      const summary = isAuto ? a.summary : `${p.display}${p.time ? " " + p.time : ""}, ${p.label}. ${p.dday >= 0 ? (p.dday ? `${p.dday}일 남았습니다.` : "바로 오늘입니다.") : `${-p.dday}일 지났습니다.`}`;
      el.verdict.innerHTML = `
        <p class="verdict__kicker">${kicker}</p>
        <div class="verdict__date">
          <span class="verdict__year">${p.date.getFullYear()}년</span>
          <span class="verdict__big">${p.date.getMonth() + 1}월 ${p.date.getDate()}일 (${DateAgent.WEEKDAYS[p.date.getDay()]})</span>
          <span class="dday">${p.ddayText}</span>
        </div>
        <p class="verdict__meta"><strong>${escapeHTML(p.label)}</strong>${p.time ? `, ${p.time}` : ""}${p.keyword ? ` (근거: '${escapeHTML(p.keyword)}')` : ""}</p>
        <p class="verdict__meta">${escapeHTML(summary)}</p>
        ${notes.map((n) => `<p class="verdict__doc">${escapeHTML(n)}</p>`).join("")}
        ${a.docType ? `<p class="verdict__doc">문서 종류 추정: ${escapeHTML(a.docType)}</p>` : ""}
        ${confidence != null ? `<p class="verdict__doc">글자 인식 신뢰도 ${confidence}%${confidence < 60 ? ", 날짜가 틀렸을 수 있으니 원문을 확인하세요." : ""}</p>` : ""}`;
    }

    el.dateList.innerHTML = "";
    if (a.dates.length > 1 || (a.dates.length === 1 && state.chosen != null)) {
      const sorted = [...a.dates].sort((x, y) => x.date - y.date);
      sorted.forEach((d) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "date-row" + (d.dday < 0 ? " is-past" : "");
        b.setAttribute("aria-pressed", String(p && d.index === p.index));
        b.innerHTML = `
          <span class="date-row__date">${escapeHTML(d.display)}${d.time ? " " + d.time : ""}</span>
          <span class="date-row__label">${escapeHTML(d.label)}, 원문 '${escapeHTML(d.raw.replace(/\s+/g, " "))}'</span>
          <span class="date-row__dday">${d.ddayText}</span>`;
        b.title = "이 날짜를 기준으로 보기";
        b.addEventListener("click", () => {
          state.chosen = a.primary && d.index === a.primary.index ? null : d.index;
          renderAnalysis(confidence);
          renderDocDay();
        });
        el.dateList.appendChild(b);
      });
    }
    renderText(state.text, a);
  }

  function renderText(text, analysis) {
    if (!text) {
      el.ocrText.innerHTML = `<span class="muted">아직 읽은 글자가 없습니다.</span>`;
      return;
    }
    const p = chosenDate();
    let html = "", pos = 0;
    const dates = analysis ? [...analysis.dates].sort((a, b) => a.start - b.start) : [];
    for (const d of dates) {
      html += escapeHTML(text.slice(pos, d.start));
      const cls = p && d.index === p.index ? ' class="is-primary"' : "";
      html += `<mark${cls} title="${escapeHTML(d.display + " · " + d.label)}">${escapeHTML(text.slice(d.start, d.end))}</mark>`;
      pos = d.end;
    }
    html += escapeHTML(text.slice(pos));
    el.ocrText.innerHTML = html;
  }

  function openTextEditor() {
    el.ocrEdit.value = state.text;
    el.ocrEdit.hidden = false;
    el.editActions.hidden = false;
    el.ocrText.hidden = true;
    el.editTextBtn.disabled = true;
    el.ocrEdit.focus();
  }
  function closeTextEditor() {
    el.ocrEdit.hidden = true;
    el.editActions.hidden = true;
    el.ocrText.hidden = false;
    el.editTextBtn.disabled = false;
  }

  el.editTextBtn.addEventListener("click", openTextEditor);
  el.cancelTextBtn.addEventListener("click", closeTextEditor);
  el.reanalyzeBtn.addEventListener("click", () => {
    const text = el.ocrEdit.value.trim();
    closeTextEditor();
    if (!text) { toast("분석할 글자를 입력하세요."); return; }
    runAnalysis(text, null);
  });
  el.copyTextBtn.addEventListener("click", async () => {
    if (!state.text) { toast("복사할 글자가 아직 없습니다."); return; }
    try { await navigator.clipboard.writeText(state.text); toast("인식된 글자를 복사했습니다."); }
    catch (_) { toast("복사하지 못했습니다. 글자를 직접 선택해 복사하세요."); }
  });

  /* ---------- 3. 날씨 에이전트 ---------- */

  async function loadWeather(place) {
    state.place = place;
    el.weatherPlace.textContent = `${place.name}의 날씨를 불러오는 중`;
    setStatus(el.weatherStatus, "working", "불러오는 중");
    try {
      const [data, airNow] = await Promise.all([Weather.forecast(place.lat, place.lon), Weather.air(place.lat, place.lon)]);
      state.weather = data;
      state.air = airNow;
      store("docAssistant.place", place);
      renderWeather();
      setStatus(el.weatherStatus, "done", "최신");
    } catch (err) {
      console.error(err);
      setStatus(el.weatherStatus, "error", "불러오기 실패");
      el.weatherPlace.textContent = place.name;
      el.weatherBody.innerHTML = `<p class="muted">날씨를 불러오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 검색하세요.</p>`;
      el.todayChip.textContent = "날씨 정보 없음";
    }
  }

  function fmtTime(iso) { return iso ? iso.slice(11, 16) : "-"; }

  function renderWeather() {
    const data = state.weather;
    if (!data) return;
    const c = data.current;
    const di = Weather.todayIndex(data);
    const d = data.daily;
    const now = Weather.describe(c.weather_code, c.is_day);
    const updated = c.time.slice(11, 16);
    el.weatherPlace.textContent = `${state.place.name}, ${updated} 기준`;
    el.todayChip.textContent = `${now.icon} ${state.place.name} ${Math.round(c.temperature_2m)}°C ${now.text}`;
    el.todayChip.classList.remove("chip--quiet");

    const pm10 = state.air ? Weather.pmGrade(state.air.pm10, "pm10") : null;
    const pm25 = state.air ? Weather.pmGrade(state.air.pm2_5, "pm25") : null;
    const airCls = (g) => (!g ? "" : g.level === 0 ? "air-good" : g.level === 1 ? "" : g.level === 2 ? "air-bad" : "air-worst");

    const hours = Weather.nextHours(data, 24);
    const week = d.time.slice(di, di + 7);
    const docIso = chosenDate() ? chosenDate().iso : null;

    el.weatherBody.innerHTML = `
      <div>
        <div class="now">
          <span class="now__icon" aria-hidden="true">${now.icon}</span>
          <span class="now__temp">${Math.round(c.temperature_2m)}°</span>
          <span class="now__desc">${now.text}, 체감 ${Math.round(c.apparent_temperature)}°</span>
        </div>
        <dl class="facts">
          <div class="fact"><dt>최고 / 최저</dt><dd>${Math.round(d.temperature_2m_max[di])}° / ${Math.round(d.temperature_2m_min[di])}°</dd></div>
          <div class="fact"><dt>강수 확률</dt><dd>${d.precipitation_probability_max[di] ?? "-"}%</dd></div>
          <div class="fact"><dt>습도</dt><dd>${c.relative_humidity_2m}%</dd></div>
          <div class="fact"><dt>바람</dt><dd>${c.wind_speed_10m.toFixed(1)}<small> m/s</small></dd></div>
          <div class="fact"><dt>미세먼지</dt><dd class="${airCls(pm10)}">${pm10 ? pm10.name : "-"}${state.air ? `<small> ${Math.round(state.air.pm10)}㎍</small>` : ""}</dd></div>
          <div class="fact"><dt>초미세먼지</dt><dd class="${airCls(pm25)}">${pm25 ? pm25.name : "-"}${state.air ? `<small> ${Math.round(state.air.pm2_5)}㎍</small>` : ""}</dd></div>
          <div class="fact"><dt>자외선</dt><dd>${d.uv_index_max[di] != null ? Math.round(d.uv_index_max[di]) : "-"}</dd></div>
          <div class="fact"><dt>해 뜨는 시각</dt><dd>${fmtTime(d.sunrise[di])}</dd></div>
          <div class="fact"><dt>해 지는 시각</dt><dd>${fmtTime(d.sunset[di])}</dd></div>
        </dl>
      </div>
      <div>
        <div class="advice">
          <h3>오늘의 조언</h3>
          <ul class="briefing">${Weather.briefing(data, state.air).map((l) => `<li>${escapeHTML(l)}</li>`).join("")}</ul>
        </div>
        <div id="docDay"></div>
        <div class="hourly">
          <h3>앞으로 24시간</h3>
          <div class="hourly__strip" tabindex="0" aria-label="시간별 예보">
            ${hours.map((h, i) => `
              <div class="hour">
                <div class="hour__t">${i === 0 ? "지금" : `${h.hour}시`}</div>
                <div class="hour__i" aria-hidden="true">${h.icon}</div>
                <div class="hour__temp">${Math.round(h.temp)}°</div>
                <div class="hour__p">${h.pop >= 20 ? `${h.pop}%` : ""}</div>
              </div>`).join("")}
          </div>
        </div>
        <div class="week" aria-label="7일 예보">
          ${week.map((iso, k) => {
            const i = di + k;
            const w = Weather.describe(d.weather_code[i]);
            const dt = new Date(iso + "T00:00:00");
            const name = k === 0 ? "오늘" : k === 1 ? "내일" : DateAgent.WEEKDAYS[dt.getDay()];
            return `<div class="day${iso === docIso ? " is-doc" : ""}" title="${w.text}">
              <div class="day__name">${name} ${dt.getDate()}일</div>
              <div class="day__i" aria-hidden="true">${w.icon}</div>
              <div><span class="day__hi">${Math.round(d.temperature_2m_max[i])}°</span> <span class="day__lo">${Math.round(d.temperature_2m_min[i])}°</span></div>
            </div>`;
          }).join("")}
        </div>
      </div>`;
    renderDocDay();
  }

  /** 문서가 필요한 날의 예보 (2번 에이전트 결과와 연결) */
  function renderDocDay() {
    const box = document.getElementById("docDay");
    if (!box || !state.weather) return;
    // 주간 예보의 강조 표시도 함께 갱신
    const p = chosenDate();
    document.querySelectorAll(".week .day").forEach((node, k) => {
      const iso = state.weather.daily.time[Weather.todayIndex(state.weather) + k];
      node.classList.toggle("is-doc", !!p && iso === p.iso);
    });
    if (!p) { box.innerHTML = ""; return; }

    const head = `<h3>문서 날짜의 날씨</h3>`;
    const when = `${p.display}${p.time ? " " + p.time : ""}`;
    if (p.dday < 0) {
      box.innerHTML = `<div class="docday">${head}<p>${escapeHTML(when)}은 이미 지난 날짜라 예보가 없습니다.</p></div>`;
      return;
    }
    const f = Weather.dayForecast(state.weather, p.iso);
    if (!f) {
      box.innerHTML = `<div class="docday">${head}<p>${escapeHTML(when)}은 ${p.dday}일 뒤라 아직 예보가 없습니다. 예보는 16일 앞까지만 나오니 ${p.dday - 15}일 뒤에 다시 확인하세요.</p></div>`;
      return;
    }
    const tips = [];
    if (f.pop >= 60) tips.push("우산을 챙기세요");
    else if (f.pop >= 30) tips.push("작은 우산이 있으면 좋겠어요");
    tips.push(Weather.outfit((f.hi + f.lo) / 2).replace(/\.$/, ""));
    box.innerHTML = `
      <div class="docday">
        ${head}
        <p>${escapeHTML(when)} (${p.relativeText}), ${escapeHTML(state.place.name)}</p>
        <div class="docday__line">
          <span class="docday__icon" aria-hidden="true">${f.icon}</span>
          <span class="docday__temps">${Math.round(f.hi)}° / ${Math.round(f.lo)}°</span>
          <span>${f.text}, 강수 확률 ${f.pop ?? "-"}%</span>
        </div>
        <p>${escapeHTML(tips.join(". "))}.</p>
      </div>`;
  }

  el.placeForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = el.placeInput.value.trim();
    if (!q) return;
    el.placeResults.hidden = true;
    try {
      const results = await Weather.search(q);
      if (!results.length) { toast(`'${q}'에 해당하는 도시를 찾지 못했습니다. 영문 이름으로도 검색해 보세요.`); return; }
      if (results.length === 1) { pickPlace(results[0]); return; }
      el.placeResults.innerHTML = results.map((r, i) => `<li><button type="button" data-i="${i}">${escapeHTML(r.name)}<small>${escapeHTML(r.detail)}</small></button></li>`).join("");
      el.placeResults.hidden = false;
      el.placeResults.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => pickPlace(results[+b.dataset.i])));
      el.placeResults.querySelector("button").focus();
    } catch (err) {
      toast("도시를 검색하지 못했습니다. 인터넷 연결을 확인하세요.");
    }
  });

  function pickPlace(r) {
    el.placeResults.hidden = true;
    el.placeInput.value = "";
    loadWeather({ name: r.name, lat: r.lat, lon: r.lon });
  }

  document.addEventListener("click", (e) => { if (!el.placeForm.contains(e.target)) el.placeResults.hidden = true; });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") el.placeResults.hidden = true; });

  el.locateBtn.addEventListener("click", async () => {
    setStatus(el.weatherStatus, "working", "위치 확인 중");
    try {
      const pos = await Weather.currentPosition();
      const name = await Weather.placeName(pos.lat, pos.lon);
      loadWeather({ name, lat: pos.lat, lon: pos.lon });
    } catch (err) {
      setStatus(el.weatherStatus, state.weather ? "done" : "error", state.weather ? "최신" : "위치 없음");
      toast(err.message);
    }
  });

  /* ---------- 시작 ---------- */
  Scanner.loadOpenCv();
  const saved = load("docAssistant.place");
  loadWeather(saved && typeof saved.lat === "number" ? saved : DEFAULT_PLACE);
})();
