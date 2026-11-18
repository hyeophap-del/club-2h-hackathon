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
