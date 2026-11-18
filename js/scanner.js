/*
 * 스캔 에이전트: 사진에서 문서 테두리를 찾고(OpenCV.js), 원근을 펴고(순수 JS 호모그래피),
 * 보정한 뒤 JPG·PDF로 내보낸다. OpenCV를 못 불러와도 모서리를 직접 맞춰 스캔할 수 있다.
 */
const Scanner = (() => {
  "use strict";

  const MAX_SOURCE = 2400; // 원본 사진의 긴 변 상한(px)
  const MAX_OUTPUT = 2200; // 펴진 문서의 긴 변 상한(px)
  let cvReady = false;
  const readyListeners = [];

  function markReady() {
    if (cvReady) return;
    cvReady = true;
    readyListeners.splice(0).forEach((fn) => fn(true));
  }

  function onOpenCvLoaded() {
    const c = window.cv;
    if (!c) return onOpenCvFailed();
    if (typeof c.then === "function") {
      c.then((mod) => { window.cv = mod; markReady(); });
    } else if (c.Mat) {
      markReady();
    } else {
      c.onRuntimeInitialized = markReady;
    }
  }

  function onOpenCvFailed() {
    readyListeners.splice(0).forEach((fn) => fn(false));
  }

  function onReady(fn) { if (cvReady) fn(true); else readyListeners.push(fn); }

  // 약 10MB라서 화면을 먼저 띄운 뒤 불러오고, 첫 주소가 실패하면 다음 주소를 시도한다.
  const OPENCV_URLS = [
    "https://docs.opencv.org/4.9.0/opencv.js",
    "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.2/dist/opencv.js",
  ];
  function loadOpenCv(i = 0) {
    if (i >= OPENCV_URLS.length) { onOpenCvFailed(); return; }
    const s = document.createElement("script");
    s.async = true;
    s.src = OPENCV_URLS[i];
    s.onload = onOpenCvLoaded;
    s.onerror = () => { s.remove(); loadOpenCv(i + 1); };
    document.body.appendChild(s);
  }

  /* ---------- 이미지 불러오기 ---------- */

  function loadFile(file) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith("image/")) {
        reject(new Error("이미지 파일만 스캔할 수 있습니다."));
        return;
      }
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, MAX_SOURCE / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.round(img.naturalWidth * scale);
        c.height = Math.round(img.naturalHeight * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("이 이미지를 열 수 없습니다. JPG나 PNG 파일로 다시 시도하세요."));
      };
      img.src = url;
    });
  }

  /* ---------- 모서리 ---------- */

  function orderCorners(pts) {
    // [좌상, 우상, 우하, 좌하]
    const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
    const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x));
    return [bySum[0], byDiff[0], bySum[3], byDiff[3]].map((p) => ({ x: p.x, y: p.y }));
  }

  function defaultCorners(w, h, inset = 0.06) {
    const dx = w * inset, dy = h * inset;
    return [{ x: dx, y: dy }, { x: w - dx, y: dy }, { x: w - dx, y: h - dy }, { x: dx, y: h - dy }];
  }

  function fullCorners(w, h) { return defaultCorners(w, h, 0); }

  function quadArea(q) {
    let a = 0;
    for (let i = 0; i < 4; i++) {
      const p = q[i], n = q[(i + 1) % 4];
      a += p.x * n.y - n.x * p.y;
    }
    return Math.abs(a) / 2;
  }

  /** OpenCV로 가장 큰 사각형 윤곽을 찾는다. 실패하면 null. */
  function detectCorners(source) {
    if (!cvReady) return null;
    const cv = window.cv;
    const scale = Math.min(1, 900 / Math.max(source.width, source.height));
    const small = document.createElement("canvas");
    small.width = Math.round(source.width * scale);
    small.height = Math.round(source.height * scale);
    small.getContext("2d").drawImage(source, 0, 0, small.width, small.height);

    const mats = [];
    const track = (m) => (mats.push(m), m);
    try {
      const src = track(cv.imread(small));
      const gray = track(new cv.Mat());
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      const blur = track(new cv.Mat());
      cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
      const kernel = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
      const minArea = small.width * small.height * 0.12;

      const attempts = [
        (dst) => { cv.Canny(blur, dst, 50, 150); },
        (dst) => { cv.Canny(blur, dst, 20, 80); },
        (dst) => {
          // 배경과 종이의 밝기 차이로 이진화
          cv.threshold(blur, dst, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
        },
      ];

      let best = null;
      let fallback = null;
      for (const run of attempts) {
        const edges = track(new cv.Mat());
        run(edges);
        cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
        cv.dilate(edges, edges, kernel);
        const contours = track(new cv.MatVector());
        const hierarchy = track(new cv.Mat());
        cv.findContours(edges, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

        for (let i = 0; i < contours.size(); i++) {
          const c = contours.get(i);
          const area = cv.contourArea(c);
          if (area < minArea || area > small.width * small.height * 0.985) { c.delete(); continue; }
          const peri = cv.arcLength(c, true);
          const approx = new cv.Mat();
          for (const eps of [0.02, 0.03, 0.045]) {
            cv.approxPolyDP(c, approx, eps * peri, true);
            if (approx.rows === 4) break;
          }
          if (approx.rows === 4 && cv.isContourConvex(approx)) {
            const d = approx.data32S;
            const pts = [0, 1, 2, 3].map((k) => ({ x: d[k * 2], y: d[k * 2 + 1] }));
            if (!best || area > best.area) best = { area, pts };
          } else if (!fallback || area > fallback.area) {
            const rect = cv.minAreaRect(c);
            const pts = cv.RotatedRect.points(rect).map((p) => ({ x: p.x, y: p.y }));
            fallback = { area, pts };
          }
          approx.delete();
          c.delete();
        }
        if (best) break;
      }

      const pick = best || fallback;
      if (!pick) return null;
      // 테두리 선에 걸친 배경이 남지 않도록 중심 쪽으로 아주 조금 당긴다
      const cx = pick.pts.reduce((a, p) => a + p.x, 0) / 4;
      const cy = pick.pts.reduce((a, p) => a + p.y, 0) / 4;
      const shrink = 0.006;
      return {
        corners: orderCorners(pick.pts.map((p) => ({
          x: (p.x + (cx - p.x) * shrink) / scale,
          y: (p.y + (cy - p.y) * shrink) / scale,
        }))),
        confident: !!best,
      };
    } catch (err) {
      console.warn("문서 테두리 인식 실패", err);
      return null;
    } finally {
      mats.forEach((m) => { try { m.delete(); } catch (_) { /* 이미 해제됨 */ } });
    }
  }

  /* ---------- 원근 보정 (호모그래피) ---------- */

  function solve(A, b) {
    const n = b.length;
    for (let col = 0; col < n; col++) {
      let piv = col;
      for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
      [A[col], A[piv]] = [A[piv], A[col]];
      [b[col], b[piv]] = [b[piv], b[col]];
      const p = A[col][col];
      if (Math.abs(p) < 1e-12) throw new Error("모서리 점이 한 줄에 놓여 있어 문서를 펼 수 없습니다.");
      for (let r = col + 1; r < n; r++) {
        const f = A[r][col] / p;
        for (let c = col; c < n; c++) A[r][c] -= f * A[col][c];
        b[r] -= f * b[col];
      }
    }
    const x = new Array(n);
    for (let r = n - 1; r >= 0; r--) {
      let s = b[r];
      for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
      x[r] = s / A[r][r];
    }
    return x;
  }

  /** 출력 좌표(u,v) → 원본 좌표(x,y) 변환 행렬 */
  function homography(from, to) {
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const { x: u, y: v } = from[i];
      const { x, y } = to[i];
      A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
      A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
    }
    return solve(A, b);
  }

  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  function warp(source, corners) {
    const [tl, tr, br, bl] = corners;
    let w = Math.max(dist(tl, tr), dist(bl, br));
    let h = Math.max(dist(tl, bl), dist(tr, br));
    const s = Math.min(1, MAX_OUTPUT / Math.max(w, h));
    w = Math.max(1, Math.round(w * s));
    h = Math.max(1, Math.round(h * s));

    const H = homography(
      [{ x: 0, y: 0 }, { x: w - 1, y: 0 }, { x: w - 1, y: h - 1 }, { x: 0, y: h - 1 }],
      corners
    );
    const sw = source.width, sh = source.height;
    const src = source.getContext("2d").getImageData(0, 0, sw, sh).data;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const octx = out.getContext("2d");
    const img = octx.createImageData(w, h);
    const dst = img.data;

    for (let v = 0; v < h; v++) {
      for (let u = 0; u < w; u++) {
        const den = H[6] * u + H[7] * v + 1;
        let x = (H[0] * u + H[1] * v + H[2]) / den;
        let y = (H[3] * u + H[4] * v + H[5]) / den;
        x = Math.min(Math.max(x, 0), sw - 1.001);
        y = Math.min(Math.max(y, 0), sh - 1.001);
        const x0 = x | 0, y0 = y | 0;
        const fx = x - x0, fy = y - y0;
        const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
        const o = (v * w + u) * 4;
        for (let c = 0; c < 3; c++) {
          const top = src[i00 + c] + (src[i10 + c] - src[i00 + c]) * fx;
          const bot = src[i01 + c] + (src[i11 + c] - src[i01 + c]) * fx;
          dst[o + c] = top + (bot - top) * fy;
        }
        dst[o + 3] = 255;
      }
    }
    octx.putImageData(img, 0, 0);
    return out;
  }

  function rotate90(canvas) {
    const out = document.createElement("canvas");
    out.width = canvas.height; out.height = canvas.width;
    const ctx = out.getContext("2d");
    ctx.translate(out.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(canvas, 0, 0);
    return out;
  }

  /* ---------- 보정 필터 ---------- */

  function percentile(hist, total, p) {
    let acc = 0;
    const target = total * p;
    for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
    return 255;
  }

  function applyFilter(base, mode) {
    const out = document.createElement("canvas");
    out.width = base.width; out.height = base.height;
    const ctx = out.getContext("2d");
    ctx.drawImage(base, 0, 0);
    if (mode === "original") return out;

    const img = ctx.getImageData(0, 0, out.width, out.height);
    const d = img.data;
    const n = out.width * out.height;

    if (mode === "enhance") {
      // 채널별 1%~99% 구간을 늘려 종이를 하얗게, 글자를 진하게
      for (let c = 0; c < 3; c++) {
        const hist = new Uint32Array(256);
        for (let i = c; i < d.length; i += 4) hist[d[i]]++;
        const lo = percentile(hist, n, 0.01);
        const hi = Math.max(lo + 1, percentile(hist, n, 0.97));
        const k = 255 / (hi - lo);
        for (let i = c; i < d.length; i += 4) d[i] = (d[i] - lo) * k;
      }
    } else {
      const lum = new Uint8ClampedArray(n);
      for (let i = 0, j = 0; j < n; i += 4, j++) lum[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

      if (mode === "gray") {
        const hist = new Uint32Array(256);
        for (let j = 0; j < n; j++) hist[lum[j]]++;
        const lo = percentile(hist, n, 0.01);
        const hi = Math.max(lo + 1, percentile(hist, n, 0.97));
        const k = 255 / (hi - lo);
        for (let i = 0, j = 0; j < n; i += 4, j++) d[i] = d[i + 1] = d[i + 2] = (lum[j] - lo) * k;
      } else if (mode === "bw") {
        // 적분 영상으로 국소 평균을 구하는 적응형 이진화 (그림자에 강함)
        const w = out.width, h = out.height;
        const integ = new Float64Array((w + 1) * (h + 1));
        for (let y = 1; y <= h; y++) {
          let row = 0;
          for (let x = 1; x <= w; x++) {
            row += lum[(y - 1) * w + (x - 1)];
            integ[y * (w + 1) + x] = integ[(y - 1) * (w + 1) + x] + row;
          }
        }
        const r = Math.max(8, Math.round(Math.max(w, h) / 50));
        const C = 12;
        for (let y = 0; y < h; y++) {
          const y1 = Math.max(0, y - r), y2 = Math.min(h, y + r + 1);
          for (let x = 0; x < w; x++) {
            const x1 = Math.max(0, x - r), x2 = Math.min(w, x + r + 1);
            const sum = integ[y2 * (w + 1) + x2] - integ[y1 * (w + 1) + x2] - integ[y2 * (w + 1) + x1] + integ[y1 * (w + 1) + x1];
            const mean = sum / ((x2 - x1) * (y2 - y1));
            const v = lum[y * w + x] < mean - C ? 0 : 255;
            const o = (y * w + x) * 4;
            d[o] = d[o + 1] = d[o + 2] = v;
          }
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return out;
  }

  /* ---------- 내보내기 ---------- */

  function stamp() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
  }

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function exportJPG(canvas, index) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error("JPG 파일을 만들지 못했습니다."));
        const name = `scan-${stamp()}${index != null ? `-p${index + 1}` : ""}.jpg`;
        download(blob, name);
        resolve(name);
      }, "image/jpeg", 0.92);
    });
  }

  function exportPDF(canvases) {
    if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("PDF 도구를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요.");
    const { jsPDF } = window.jspdf;
    let doc = null;
    canvases.forEach((c) => {
      const landscape = c.width > c.height;
      const pw = landscape ? 297 : 210, ph = landscape ? 210 : 297;
      const orientation = landscape ? "landscape" : "portrait";
      if (!doc) doc = new jsPDF({ unit: "mm", format: "a4", orientation, compress: true });
      else doc.addPage("a4", orientation);
      const s = Math.min(pw / c.width, ph / c.height);
      const w = c.width * s, h = c.height * s;
      doc.addImage(c.toDataURL("image/jpeg", 0.9), "JPEG", (pw - w) / 2, (ph - h) / 2, w, h, undefined, "FAST");
    });
    const name = `scan-${stamp()}.pdf`;
    doc.save(name);
    return name;
  }

  return {
    loadOpenCv, onReady,
    isReady: () => cvReady,
    loadFile, detectCorners, defaultCorners, fullCorners, quadArea,
    warp, rotate90, applyFilter, exportJPG, exportPDF,
  };
})();

/* ---------- 모서리 편집기 ---------- */
class CornerEditor {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.image = null;
    this.corners = [];
    this.drag = -1;
    this.hover = -1;
    this.focusIndex = -1;

    canvas.tabIndex = 0;
    canvas.addEventListener("pointerdown", (e) => this.onDown(e));
    canvas.addEventListener("pointermove", (e) => this.onMove(e));
    canvas.addEventListener("pointerup", (e) => this.onUp(e));
    canvas.addEventListener("pointercancel", (e) => this.onUp(e));
    canvas.addEventListener("keydown", (e) => this.onKey(e));
    window.addEventListener("resize", () => this.layout());
  }

  setImage(image, corners) {
    this.image = image;
    this.corners = corners.map((p) => ({ ...p }));
    this.layout();
  }

  setCorners(corners) { this.corners = corners.map((p) => ({ ...p })); this.draw(); }
  getCorners() { return this.corners.map((p) => ({ ...p })); }

  layout() {
    if (!this.image) return;
    const stage = this.canvas.parentElement;
    const maxW = stage.clientWidth || 600;
    const maxH = Math.max(320, window.innerHeight * 0.62);
    const s = Math.min(maxW / this.image.width, maxH / this.image.height, 1);
    const cssW = Math.round(this.image.width * s), cssH = Math.round(this.image.height * s);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = cssW + "px";
    this.canvas.style.height = cssH + "px";
    this.canvas.width = Math.round(cssW * dpr);
    this.canvas.height = Math.round(cssH * dpr);
    this.scale = (cssW * dpr) / this.image.width; // 이미지 px → 캔버스 px
    this.dpr = dpr;
    this.draw();
  }

  toImage(e) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * this.image.width,
      y: ((e.clientY - r.top) / r.height) * this.image.height,
    };
  }

  nearest(p) {
    const r = this.canvas.getBoundingClientRect();
    const hit = (28 / r.width) * this.image.width; // 화면 기준 28px 이내
    let best = -1, bd = Infinity;
    this.corners.forEach((c, i) => {
      const d = Math.hypot(c.x - p.x, c.y - p.y);
      if (d < bd) { bd = d; best = i; }
    });
    return bd <= hit ? best : -1;
  }

  clamp(p) {
    return { x: Math.min(Math.max(p.x, 0), this.image.width), y: Math.min(Math.max(p.y, 0), this.image.height) };
  }

  onDown(e) {
    if (!this.image) return;
    const p = this.toImage(e);
    this.drag = this.nearest(p);
    if (this.drag >= 0) {
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  onMove(e) {
    if (!this.image) return;
    const p = this.toImage(e);
    if (this.drag >= 0) {
      this.corners[this.drag] = this.clamp(p);
      this.draw(p);
    } else {
      const h = this.nearest(p);
      if (h !== this.hover) { this.hover = h; this.canvas.style.cursor = h >= 0 ? "grab" : "crosshair"; this.draw(); }
    }
  }

  onUp() { this.drag = -1; this.draw(); }

  onKey(e) {
    // Tab으로 캔버스에 들어온 뒤 1~4로 모서리 선택, 방향키로 이동
    if (!this.image) return;
    if (/^[1-4]$/.test(e.key)) { this.focusIndex = +e.key - 1; this.draw(); e.preventDefault(); return; }
    const step = (e.shiftKey ? 20 : 4) / this.scale * this.dpr;
    const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (move) {
      if (this.focusIndex < 0) this.focusIndex = 0;
      const c = this.corners[this.focusIndex];
      this.corners[this.focusIndex] = this.clamp({ x: c.x + move[0], y: c.y + move[1] });
      this.draw();
      e.preventDefault();
    }
  }

  draw(loupeAt) {
    if (!this.image) return;
    const { ctx, canvas, scale } = this;
    const css = getComputedStyle(document.documentElement);
    const pen = css.getPropertyValue("--pen").trim() || "#2448b8";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.image, 0, 0, canvas.width, canvas.height);

    const pts = this.corners.map((p) => ({ x: p.x * scale, y: p.y * scale }));
    // 문서 바깥을 어둡게
    ctx.save();
    ctx.fillStyle = "rgba(10, 18, 30, 0.45)";
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 3; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fill("evenodd");
    ctx.restore();

    ctx.lineWidth = 2 * this.dpr;
    ctx.strokeStyle = pen;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();

    pts.forEach((p, i) => {
      const active = i === this.drag || i === this.hover || i === this.focusIndex;
      ctx.beginPath();
      ctx.arc(p.x, p.y, (active ? 12 : 9) * this.dpr, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.lineWidth = 3 * this.dpr;
      ctx.strokeStyle = pen;
      ctx.stroke();
    });

    // 끌고 있는 모서리 주변 확대경
    if (loupeAt && this.drag >= 0) {
      const R = 56 * this.dpr, zoom = 2.5;
      const cx = pts[this.drag].x, cy = pts[this.drag].y;
      const lx = cx < canvas.width / 2 ? canvas.width - R - 10 * this.dpr : R + 10 * this.dpr;
      const ly = R + 10 * this.dpr;
      ctx.save();
      ctx.beginPath();
      ctx.arc(lx, ly, R, 0, Math.PI * 2);
      ctx.clip();
      const sx = this.corners[this.drag].x, sy = this.corners[this.drag].y;
      const half = R / (zoom * scale);
      ctx.drawImage(this.image, sx - half, sy - half, half * 2, half * 2, lx - R, ly - R, R * 2, R * 2);
      ctx.strokeStyle = pen;
      ctx.lineWidth = 1.5 * this.dpr;
      ctx.beginPath();
      ctx.moveTo(lx - 10 * this.dpr, ly); ctx.lineTo(lx + 10 * this.dpr, ly);
      ctx.moveTo(lx, ly - 10 * this.dpr); ctx.lineTo(lx, ly + 10 * this.dpr);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(lx, ly, R, 0, Math.PI * 2);
      ctx.lineWidth = 3 * this.dpr;
      ctx.strokeStyle = "#fff";
      ctx.stroke();
    }
  }
}
