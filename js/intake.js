// 파일 받기: 사진 · PDF · 한글(HWPX)을 분석에 넘길 "페이지" 목록으로 바꿉니다.
// 팀원 may0ne2e의 sex-extract 브랜치 구현(scripts/extract_test: 형식 판별, HWPX 글자 추출,
// PDF 텍스트 레이어)을 참고/이식했습니다.
//
//   사진          ─▶ 이미지 페이지 { mimeType: 'image/jpeg', data, previewUrl, name }  (js/image.js에서 압축)
//   HWPX          ─▶ 글자 페이지   { kind: 'text', text, name, mimeType: 'text/plain' }  (JSZip으로 본문 XML 읽기)
//   PDF(글자 있음) ─▶ 글자 페이지 1개 (pdf.js 텍스트 레이어 — 더 싸고 정확함)
//   PDF(스캔본)    ─▶ 예전처럼 PDF 그대로 { mimeType: 'application/pdf', data } (Gemini만 읽음)
//   HWP(구형)     ─▶ 브라우저에서 읽을 수 없어 안내 메시지
//
// JSZip·pdf.js는 해당 파일을 올렸을 때만 CDN에서 불러옵니다.
import { fileToInlineData } from './image.js';
import { loadScriptOnce } from './agents/scanAgent.js';

const JSZIP_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js',
  'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
];
const PDFJS_URLS = [
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js',
  'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js',
];
// 한글 글꼴(CID) PDF에서 글자를 제대로 뽑으려면 CMap이 필요함
const PDF_DOC_OPTIONS = {
  cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/standard_fonts/',
};

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const MAX_TEXT_CHARS = 30000;    // 아주 긴 문서는 앞부분만
const MIN_CHARS_PER_PAGE = 30;   // 쪽당 글자가 이보다 적으면 스캔본으로 봄

const HWP_MESSAGE = "HWP는 한글에서 'HWPX' 또는 PDF로 저장해서 올려 주세요.";

// 파일 앞부분(매직 넘버)으로 실제 형식 판별 — 윈도우에서 .hwpx는 file.type이 빈 문자열인 경우가 많음
async function sniff(file) {
  const h = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const is = (...b) => b.every((v, i) => h[i] === v);
  if (is(0x25, 0x50, 0x44, 0x46)) return 'pdf';                                 // %PDF
  if (is(0x50, 0x4b, 0x03, 0x04)) return 'zip';                                 // PK..
  if (is(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)) return 'ole';         // 구형 HWP·오피스
  return 'other';
}

const extOf = (name) => (name.match(/\.([^.]+)$/)?.[1] || '').toLowerCase();
const tidy = (s) => s.replace(/ /g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
const clip = (s) => (s.length > MAX_TEXT_CHARS ? `${s.slice(0, MAX_TEXT_CHARS)}\n…(이하 생략)` : s);

function textPage(text, name) {
  return { kind: 'text', text: clip(text), name, mimeType: 'text/plain' };
}

// ---------- HWPX ----------

// 본문 XML(Contents/sectionN.xml)에서 <hp:t> 글자만 뽑음. 문단(p)마다 줄 바꿈, 표 칸도 문단이라 같이 읽힘
function hwpxXmlToText(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  let out = '';
  const walk = (node, inT) => {
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { if (inT) out += c.nodeValue; continue; }
      if (c.nodeType !== 1) continue;
      const n = c.localName;
      if (n === 'tab') out += '\t';
      else if (n === 'lineBreak') out += '\n';
      else if (n === 't') walk(c, true);
      else { walk(c, inT); if (n === 'p') out += '\n'; }
    }
  };
  walk(doc, false);
  return tidy(out);
}

async function hwpxToPages(file, onStatus) {
  onStatus?.('한글(HWPX) 파일 여는 중…');
  await loadScriptOnce(JSZIP_URLS);
  let zip;
  try {
    zip = await window.JSZip.loadAsync(file);
  } catch {
    throw new Error(`${file.name}: 압축을 풀 수 없습니다. 파일이 손상되었는지 확인해 주세요.`);
  }
  const mimetype = (await zip.file('mimetype')?.async('string'))?.trim();
  const sections = Object.keys(zip.files)
    .map((name) => [name, name.match(/^Contents\/section(\d+)\.xml$/i)])
    .filter(([, m]) => m)
    .sort((a, b) => a[1][1] - b[1][1])
    .map(([name]) => name);
  if (mimetype !== 'application/hwp+zip' && !sections.length) {
    throw new Error(`${file.name}: 한글(HWPX) 문서가 아닌 압축 파일입니다. 워드·엑셀 파일은 PDF로 저장해서 올려 주세요.`);
  }
  const parts = [];
  for (const name of sections) parts.push(hwpxXmlToText(await zip.file(name).async('string')));
  const text = tidy(parts.join('\n\n'));
  if (!text) throw new Error(`${file.name}: 한글 문서에서 글자를 찾지 못했습니다. PDF로 저장해서 올려 주세요.`);
  return [textPage(text, file.name)];
}

// ---------- PDF ----------

async function getPdfjs() {
  await loadScriptOnce(PDFJS_URLS);
  const lib = window.pdfjsLib;
  if (!lib.GlobalWorkerOptions.workerSrc) {
    // 실제로 불러온 주소(cdnjs 또는 jsdelivr)와 같은 버전의 워커 사용
    const src = [...document.scripts].map((s) => s.src).find((s) => PDFJS_URLS.includes(s)) || PDFJS_URLS[0];
    lib.GlobalWorkerOptions.workerSrc = src.replace(/pdf\.min\.js$/, 'pdf.worker.min.js');
  }
  return lib;
}

// 스캔본(글자 없는) PDF는 예전처럼 PDF 그대로 Gemini에 보냄 (키 없는 간단 분석은 읽지 못함)
const rawPdf = (file) => fileToInlineData(file.type === 'application/pdf' ? file : new File([file], file.name, { type: 'application/pdf' }));

async function pdfToPages(file, onStatus) {
  if (file.size > MAX_PDF_BYTES) throw new Error(`${file.name}: PDF가 너무 큽니다. (최대 30MB)`);
  onStatus?.('PDF 여는 중…');
  let pdfjs;
  try {
    pdfjs = await getPdfjs();
  } catch {
    return [await rawPdf(file)]; // 도구를 못 불러오면 예전 방식대로
  }
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), ...PDF_DOC_OPTIONS }).promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new Error(`${file.name}: 암호가 걸린 PDF는 열 수 없습니다.`);
    throw new Error(`${file.name}: PDF를 열 수 없습니다.`);
  }
  try {
    const texts = [];
    for (let i = 1; i <= doc.numPages; i++) {
      onStatus?.(`PDF 글자 읽는 중… (${i}/${doc.numPages}쪽)`);
      const tc = await (await doc.getPage(i)).getTextContent();
      texts.push(tc.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join(''));
      if (texts.join('').length > MAX_TEXT_CHARS) break;
    }
    const text = tidy(texts.join('\n\n'));
    if (text.replace(/\s/g, '').length >= MIN_CHARS_PER_PAGE * Math.min(texts.length, 3)) {
      return [textPage(text, file.name)];
    }
  } finally {
    doc.destroy();
  }
  return [await rawPdf(file)];
}

// ---------- 입구 ----------

// file → 페이지 객체 배열
export async function fileToPages(file, onStatus) {
  const kind = await sniff(file);
  const ext = extOf(file.name);
  if (kind === 'pdf' || (kind === 'other' && file.type === 'application/pdf')) return pdfToPages(file, onStatus);
  if (kind === 'zip') return hwpxToPages(file, onStatus);
  if (kind === 'ole' || ext === 'hwp') throw new Error(`${file.name}: ${HWP_MESSAGE}`);
  if (ext === 'hwpx') throw new Error(`${file.name}: 한글(HWPX) 파일을 읽을 수 없습니다. PDF로 저장해서 올려 주세요.`);
  if (file.type.startsWith('image/')) return [await fileToInlineData(file)];
  throw new Error(`${file.name}: 사진(JPG·PNG), PDF, 한글(HWPX) 파일만 올릴 수 있습니다.`);
}
