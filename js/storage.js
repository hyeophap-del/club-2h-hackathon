// localStorage 저장 모듈. 다른 파일은 localStorage를 직접 만지지 말고 이 함수들만 사용합니다.
import { DEFAULT_SETTINGS } from './config.js';
import { uid } from './util.js';
import { deletePages, clearPages } from './archive.js';

const KEYS = { docs: 'docs', tasks: 'tasks', settings: 'settings' };

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    alert('저장 공간이 부족하거나 저장할 수 없습니다. 설정에서 백업 후 오래된 데이터를 지워 주세요.');
    console.error(err);
    return false;
  }
}

// ----- 문서 -----
export function getDocs() {
  return read(KEYS.docs, []);
}

export function getDoc(id) {
  return getDocs().find((d) => d.id === id);
}

export function saveDoc(doc) {
  const newDoc = { id: uid(), createdAt: new Date().toISOString(), ...doc };
  write(KEYS.docs, [newDoc, ...getDocs()]);
  return newDoc;
}

// 같은 문서(같은 사진)를 이미 올렸는지
export function findDocByHash(hash) {
  return hash ? getDocs().find((d) => d.hash === hash) : undefined;
}

export function updateDoc(id, patch) {
  write(KEYS.docs, getDocs().map((d) => (d.id === id ? { ...d, ...patch } : d)));
}

export function deleteDoc(id) {
  write(KEYS.docs, getDocs().filter((d) => d.id !== id));
  write(KEYS.tasks, getTasks().filter((t) => t.docId !== id));
  deletePages(id);
}

// ----- 할 일 -----
// task: {id, docId, title, description, dueDate, dueTime, sourceText, done, reminders:[{at, notified}]}
export function getTasks() {
  return read(KEYS.tasks, []);
}

export function saveTask(task) {
  const newTask = { id: uid(), done: false, reminders: [], ...task };
  write(KEYS.tasks, [...getTasks(), newTask]);
  return newTask;
}

export function saveTasks(tasks) {
  const created = tasks.map((t) => ({ id: uid(), done: false, reminders: [], ...t }));
  write(KEYS.tasks, [...getTasks(), ...created]);
  return created;
}

export function updateTask(id, patch) {
  const tasks = getTasks().map((t) => (t.id === id ? { ...t, ...patch } : t));
  write(KEYS.tasks, tasks);
}

export function deleteTask(id) {
  write(KEYS.tasks, getTasks().filter((t) => t.id !== id));
}

export function getTasksByDate(dateKey) {
  return getTasks().filter((t) => t.dueDate === dateKey);
}

// ----- 설정 -----
export function getSettings() {
  return { ...DEFAULT_SETTINGS, ...read(KEYS.settings, {}) };
}

export function saveSettings(patch) {
  write(KEYS.settings, { ...getSettings(), ...patch });
}

// ----- 백업 -----
export function exportAll() {
  // API 키는 백업 파일에 넣지 않음
  const { apiKey, kakaoJsKey, kakaoRestKey, ...settings } = getSettings();
  return { version: 1, exportedAt: new Date().toISOString(), docs: getDocs(), tasks: getTasks(), settings };
}

export function importAll(data) {
  if (!data || !Array.isArray(data.docs) || !Array.isArray(data.tasks)) {
    throw new Error('올바른 백업 파일이 아닙니다.');
  }
  write(KEYS.docs, data.docs);
  write(KEYS.tasks, data.tasks);
  if (data.settings) saveSettings(data.settings);
}

// 준비물 체크 (task.itemsDone: 체크한 준비물 이름 목록)
export function toggleItem(taskId, item) {
  const t = getTasks().find((x) => x.id === taskId);
  if (!t) return;
  const done = new Set(t.itemsDone || []);
  done.has(item) ? done.delete(item) : done.add(item);
  updateTask(taskId, { itemsDone: [...done] });
}

export function clearAll() {
  clearPages();
  localStorage.removeItem(KEYS.docs);
  localStorage.removeItem(KEYS.tasks);
}
