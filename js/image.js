// 업로드 파일을 Gemini에 보낼 수 있는 base64로 변환합니다.
// 사진은 용량을 줄이기 위해 긴 변 1600px JPEG로 압축합니다.

const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.85;
const MAX_PDF_BYTES = 15 * 1024 * 1024;

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('이미지를 열 수 없습니다. (HEIC는 JPG로 바꿔서 올려 주세요)'));
    img.src = src;
  });
}

async function compressImage(file) {
  const img = await loadImage(await readAsDataURL(file));
  const scale = Math.min(1, MAX_SIDE / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
}

// 같은 문서를 다시 올렸는지 확인하기 위한 지문(SHA-256)
export async function fingerprint(pages) {
  const text = pages.map((p) => p.data).join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// 흐림 정도 측정 (라플라시안 분산). 값이 작을수록 흐림. 이미지가 아니면 null
export async function sharpness(dataUrl) {
  const img = await loadImage(dataUrl);
  const size = 400;
  const scale = Math.min(1, size / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  let sum = 0, sumSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = g[i - w] + g[i + w] + g[i - 1] + g[i + 1] - 4 * g[i];
      sum += lap;
      sumSq += lap * lap;
      n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

export const BLUR_THRESHOLD = 60;

// 반환: { mimeType, data(base64, 접두어 없음), previewUrl, name }
export async function fileToInlineData(file) {
  let dataUrl;
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error('PDF가 너무 큽니다. (최대 15MB)');
    dataUrl = await readAsDataURL(file);
  } else if (file.type.startsWith('image/')) {
    dataUrl = await compressImage(file);
  } else {
    throw new Error('이미지 또는 PDF 파일만 올릴 수 있습니다.');
  }
  const [header, data] = dataUrl.split(',');
  const mimeType = header.match(/data:(.*?);base64/)[1];
  return { mimeType, data, previewUrl: dataUrl, name: file.name };
}
