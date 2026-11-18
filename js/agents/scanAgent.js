// ① 문서 인식 에이전트
// 사진 속 문서의 네 모서리(AI가 찾거나 사용자가 조정)를 받아 반듯하게 펴고, JPG/PDF로 변환합니다.

// AI가 준 0~1000 비율 좌표 → 이미지 픽셀 좌표 [tl, tr, br, bl]
export function cornersFromAI(aiCorners, width, height) {
  if (!aiCorners) return null;
  const order = ['top_left', 'top_right', 'bottom_right', 'bottom_left'];
  const pts = order.map((k) => aiCorners[k]);
  if (pts.some((p) => !p || typeof p.x !== 'number' || typeof p.y !== 'number')) return null;
  const result = pts.map((p) => ({
    x: Math.min(Math.max(p.x, 0), 1000) / 1000 * width,
    y: Math.min(Math.max(p.y, 0), 1000) / 1000 * height,
  }));
  // 너무 작은 영역(이미지의 10% 미만)이면 인식 실패로 봄
  return polygonArea(result) < width * height * 0.1 ? null : result;
}

export function defaultCorners(width, height) {
  const m = 0.05;
  return [
    { x: width * m, y: height * m },
    { x: width * (1 - m), y: height * m },
    { x: width * (1 - m), y: height * (1 - m) },
    { x: width * m, y: height * (1 - m) },
  ];
}

function polygonArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    a += p[i].x * p[j].y - p[j].x * p[i].y;
  }
  return Math.abs(a) / 2;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// 4점 → 4점 원근 변환 행렬(3x3) 계산. from[i]를 to[i]로 보내는 행렬.
function perspectiveMatrix(from, to) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i];
    const { x: u, y: v } = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    b.push(v);
  }
  const h = solve(A, b);
  return [...h, 1];
}

// 가우스 소거법으로 Ax = b 풀기
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

// 이미지와 네 모서리 → 반듯하게 편 문서 canvas
export function warpDocument(img, corners) {
  const [tl, tr, br, bl] = corners;
  const outW = Math.round(Math.max(dist(tl, tr), dist(bl, br)));
  const outH = Math.round(Math.max(dist(tl, bl), dist(tr, br)));

  const src = document.createElement('canvas');
  src.width = img.naturalWidth || img.width;
  src.height = img.naturalHeight || img.height;
  const sctx = src.getContext('2d');
  sctx.drawImage(img, 0, 0);
  const sData = sctx.getImageData(0, 0, src.width, src.height).data;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const octx = out.getContext('2d');
  const oImg = octx.createImageData(outW, outH);
  const oData = oImg.data;

  // 결과 이미지 좌표 → 원본 좌표 행렬
  const H = perspectiveMatrix(
    [{ x: 0, y: 0 }, { x: outW, y: 0 }, { x: outW, y: outH }, { x: 0, y: outH }],
    corners
  );

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const w = H[6] * x + H[7] * y + H[8];
      const sx = Math.round((H[0] * x + H[1] * y + H[2]) / w);
      const sy = Math.round((H[3] * x + H[4] * y + H[5]) / w);
      const o = (y * outW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height) {
        oData[o] = oData[o + 1] = oData[o + 2] = 255;
      } else {
        const s = (sy * src.width + sx) * 4;
        oData[o] = sData[s];
        oData[o + 1] = sData[s + 1];
        oData[o + 2] = sData[s + 2];
      }
      oData[o + 3] = 255;
    }
  }
  octx.putImageData(oImg, 0, 0);
  return out;
}

// 스캔한 느낌(밝기·대비 보정) 필터
export function enhance(canvas) {
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let k = 0; k < 3; k++) {
      d[i + k] = Math.min(255, Math.max(0, (d[i + k] - 128) * 1.35 + 150));
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function download(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
}

export function downloadJpg(canvas, name = '문서') {
  download(canvas.toDataURL('image/jpeg', 0.9), `${name}.jpg`);
}

// 여러 장(canvas 또는 Image)을 A4 PDF 한 파일로. jsPDF는 페이지에서 CDN으로 불러옵니다 (window.jspdf)
export function downloadPdf(pages, name = '문서') {
  const { jsPDF } = window.jspdf || {};
  if (!jsPDF) {
    alert('PDF 변환 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
    return;
  }
  const list = Array.isArray(pages) ? pages : [pages];
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = 210, pageH = 297, margin = 8;
  list.forEach((src, i) => {
    if (i) pdf.addPage();
    const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
    const ratio = Math.min((pageW - margin * 2) / sw, (pageH - margin * 2) / sh);
    const w = sw * ratio, h = sh * ratio;
    // A4에 비율 유지해서 가운데 배치
    pdf.addImage(src, 'JPEG', (pageW - w) / 2, (pageH - h) / 2, w, h);
  });
  pdf.save(`${name}.pdf`);
}

// ---------------------------------------------------------------------------
// 스캔 모드(컬러/회색조/흑백)와 OpenCV 테두리 찾기
// 원작: 팀원 leokiller6646의 dw 브랜치 구현을 옮겨 옴 (js/scanner.js의 applyFilter·detectCorners)
// ---------------------------------------------------------------------------

export const SCAN_MODES = { color: '컬러', gray: '회색조', bw: '흑백' };

function percentile(hist, total, p) {
  let acc = 0;
  const target = total * p;
  for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc >= target) return i; }
  return 255;
}

// canvas를 그 자리에서 보정해서 돌려줌
//   color: 기존 "선명하게" 필터 (밝기·대비)
//   gray : 밝기만 남기고 1%~97% 구간을 늘려 종이는 하얗게, 글자는 진하게
//   bw   : 적분 영상으로 주변 평균을 구하는 적응형 이진화 (그림자·조명 얼룩에 강함)
export function applyMode(canvas, mode = 'color') {
  if (mode === 'color') return enhance(canvas);
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, n = w * h;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const lum = new Uint8ClampedArray(n);
  for (let i = 0, j = 0; j < n; i += 4, j++) lum[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

  if (mode === 'gray') {
    const hist = new Uint32Array(256);
    for (let j = 0; j < n; j++) hist[lum[j]]++;
    const lo = percentile(hist, n, 0.01);
    const hi = Math.max(lo + 1, percentile(hist, n, 0.97));
    const k = 255 / (hi - lo);
    for (let i = 0, j = 0; j < n; i += 4, j++) d[i] = d[i + 1] = d[i + 2] = (lum[j] - lo) * k;
  } else if (mode === 'bw') {
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
        const o = (y * w + x) * 4;
        d[o] = d[o + 1] = d[o + 2] = lum[y * w + x] < mean - C ? 0 : 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// 외부 스크립트를 필요할 때만 한 번 불러옴 (주소가 여러 개면 앞에서부터 시도)
const scriptCache = new Map();
export function loadScriptOnce(urls, timeoutMs = 20000) {
  const key = urls.join('|');
  if (!scriptCache.has(key)) {
    const p = (async () => {
      for (const src of urls) {
        const ok = await new Promise((resolve) => {
          const s = document.createElement('script');
          s.src = src;
          s.async = true;
          const timer = setTimeout(() => { s.remove(); resolve(false); }, timeoutMs);
          s.onload = () => { clearTimeout(timer); resolve(true); };
          s.onerror = () => { clearTimeout(timer); s.remove(); resolve(false); };
          document.head.appendChild(s);
        });
        if (ok) return true;
      }
      throw new Error('외부 도구를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.');
    })();
    p.catch(() => scriptCache.delete(key)); // 실패하면 다음에 다시 시도할 수 있게
    scriptCache.set(key, p);
  }
  return scriptCache.get(key);
}

// OpenCV.js(약 10MB)는 테두리를 찾아야 할 때만 불러옵니다. 첫 주소가 안 되면 다음 주소.
const OPENCV_URLS = [
  'https://docs.opencv.org/4.9.0/opencv.js',
  'https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.9.0-release.2/dist/opencv.js',
];
let cvPromise = null;

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// 주의: Emscripten 모듈(cv)은 then을 가진 객체라서 Promise로 바로 넘기면 끝없이 then을 부름
//       → 항상 { cv } 상자에 담아서 돌려줌
export function loadOpenCV(timeoutMs = 20000) {
  if (!cvPromise) {
    cvPromise = withTimeout((async () => {
      await loadScriptOnce(OPENCV_URLS, timeoutMs);
      const c = window.cv;
      if (!c) throw new Error('OpenCV 없음');
      if (c.Mat) return { cv: c };
      if (typeof c.then === 'function') {
        return await new Promise((resolve) => c.then((mod) => resolve({ cv: (window.cv = mod || c) })));
      }
      return await new Promise((resolve) => { c.onRuntimeInitialized = () => resolve({ cv: window.cv }); });
    })(), timeoutMs, 'OpenCV 불러오기 시간 초과');
    cvPromise.catch(() => { cvPromise = null; });
  }
  return cvPromise;
}

function orderCorners(pts) {
  // [좌상, 우상, 우하, 좌하]
  const bySum = [...pts].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...pts].sort((a, b) => a.y - a.x - (b.y - b.x));
  return [bySum[0], byDiff[0], bySum[3], byDiff[3]].map((p) => ({ x: p.x, y: p.y }));
}

// 사진(Image 또는 canvas)에서 가장 큰 사각형 윤곽을 찾아 픽셀 좌표 [tl, tr, br, bl]로 돌려줌.
// OpenCV를 못 불러오거나(오프라인·시간 초과) 사각형을 못 찾으면 null.
export async function detectCornersCV(img, timeoutMs = 20000) {
  let cv;
  try {
    ({ cv } = await loadOpenCV(timeoutMs));
  } catch (err) {
    console.warn('OpenCV를 불러오지 못해 테두리 자동 찾기를 건너뜁니다.', err);
    return null;
  }
  const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
  const scale = Math.min(1, 900 / Math.max(W, H));
  const small = document.createElement('canvas');
  small.width = Math.round(W * scale);
  small.height = Math.round(H * scale);
  small.getContext('2d').drawImage(img, 0, 0, small.width, small.height);

  const mats = [];
  const track = (m) => (mats.push(m), m);
  try {
    const src = track(cv.imread(small));
    const gray = track(new cv.Mat());
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    const blur = track(new cv.Mat());
    cv.GaussianBlur(gray, blur, new cv.Size(5, 5), 0);
    const kernel = track(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5)));
    const total = small.width * small.height;
    const attempts = [
      (dst) => cv.Canny(blur, dst, 50, 150),
      (dst) => cv.Canny(blur, dst, 20, 80),
      (dst) => cv.threshold(blur, dst, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU), // 배경과 종이의 밝기 차이
    ];

    let best = null;
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
        if (area < total * 0.12 || area > total * 0.985) { c.delete(); continue; }
        const peri = cv.arcLength(c, true);
        const approx = new cv.Mat();
        for (const eps of [0.02, 0.03, 0.045]) {
          cv.approxPolyDP(c, approx, eps * peri, true);
          if (approx.rows === 4) break;
        }
        if (approx.rows === 4 && cv.isContourConvex(approx) && (!best || area > best.area)) {
          const d = approx.data32S;
          best = { area, pts: [0, 1, 2, 3].map((k) => ({ x: d[k * 2], y: d[k * 2 + 1] })) };
        }
        approx.delete();
        c.delete();
      }
      if (best) break;
    }
    if (!best) return null;
    // 테두리 선에 걸친 배경이 남지 않도록 중심 쪽으로 아주 조금 당김
    const cx = best.pts.reduce((a, p) => a + p.x, 0) / 4;
    const cy = best.pts.reduce((a, p) => a + p.y, 0) / 4;
    const shrink = 0.006;
    return orderCorners(best.pts.map((p) => ({
      x: (p.x + (cx - p.x) * shrink) / scale,
      y: (p.y + (cy - p.y) * shrink) / scale,
    })));
  } catch (err) {
    console.warn('문서 테두리 인식 실패', err);
    return null;
  } finally {
    mats.forEach((m) => { try { m.delete(); } catch { /* 이미 해제됨 */ } });
  }
}

// 픽셀 좌표 [tl, tr, br, bl] → Gemini와 같은 0~1000 비율 좌표 객체 (cornersFromAI의 반대)
export function cornersToAI(corners, width, height) {
  if (!corners) return null;
  const keys = ['top_left', 'top_right', 'bottom_right', 'bottom_left'];
  return Object.fromEntries(corners.map((p, i) => [keys[i], {
    x: Math.round((p.x / width) * 1000),
    y: Math.round((p.y / height) * 1000),
  }]));
}
