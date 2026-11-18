// 문서 보관함: 스캔한 페이지 이미지를 IndexedDB에 저장합니다.
// (localStorage는 5MB 한계라 이미지는 여기에 따로 둡니다)
const DB_NAME = 'doc-assistant';
const STORE = 'pages';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result.result ?? result);
    t.onerror = () => reject(t.error);
  });
}

// pages: Blob[] (JPEG)
export async function savePages(docId, blobs) {
  try {
    await tx('readwrite', (s) => s.put(blobs, docId));
    return true;
  } catch (err) {
    console.warn('보관함 저장 실패', err);
    return false;
  }
}

export async function getPages(docId) {
  try {
    return (await tx('readonly', (s) => s.get(docId))) || [];
  } catch {
    return [];
  }
}

export async function deletePages(docId) {
  try {
    await tx('readwrite', (s) => s.delete(docId));
  } catch { /* 무시 */ }
}

export async function clearPages() {
  try {
    await tx('readwrite', (s) => s.clear());
  } catch { /* 무시 */ }
}

export function canvasToBlob(canvas, quality = 0.85) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}
