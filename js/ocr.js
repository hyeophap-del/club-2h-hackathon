/*
 * 글자 인식: Tesseract.js(한국어+영어)를 브라우저 안에서 실행한다.
 * 첫 실행 때 언어 데이터(수 MB)를 내려받고, 이후에는 같은 작업자를 재사용한다.
 */
const OCR = (() => {
  "use strict";

  let workerPromise = null;
  let progressHandler = null;

  const STAGES = {
    "loading tesseract core": "인식 엔진 불러오는 중",
    "initializing tesseract": "인식 엔진 준비 중",
    "initialized tesseract": "인식 엔진 준비 완료",
    "loading language traineddata": "한국어·영어 글자 데이터 내려받는 중",
    "loaded language traineddata": "글자 데이터 준비 완료",
    "initializing api": "인식 준비 중",
    "initialized api": "인식 준비 완료",
    "recognizing text": "글자 읽는 중",
  };

  function getWorker() {
    if (!window.Tesseract) {
      return Promise.reject(new Error("글자 인식 도구를 불러오지 못했습니다. 인터넷 연결을 확인하고 새로고침하세요."));
    }
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker(["kor", "eng"], 1, {
        logger: (m) => {
          if (progressHandler) progressHandler({ label: STAGES[m.status] || m.status, progress: m.progress || 0, stage: m.status });
        },
      }).catch((err) => { workerPromise = null; throw err; });
    }
    return workerPromise;
  }

  /** 인식 정확도를 위해 너무 작은 이미지는 키우고, 너무 큰 이미지는 줄인다. */
  function prepare(canvas) {
    const long = Math.max(canvas.width, canvas.height);
    const target = long < 1400 ? 1400 : long > 2600 ? 2600 : long;
    if (target === long) return canvas;
    const s = target / long;
    const c = document.createElement("canvas");
    c.width = Math.round(canvas.width * s);
    c.height = Math.round(canvas.height * s);
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(canvas, 0, 0, c.width, c.height);
    return c;
  }

  /** 줄 끝 공백과 연속된 빈 줄을 정리한다. 글자 사이 공백은 날짜 분석기가 알아서 허용한다. */
  function tidy(text) {
    return text
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  async function recognize(canvases, onProgress) {
    progressHandler = null;
    const list = Array.isArray(canvases) ? canvases : [canvases];
    const worker = await getWorker();
    const parts = [];
    let confSum = 0;
    for (let i = 0; i < list.length; i++) {
      progressHandler = (p) => onProgress && onProgress({
        ...p,
        label: list.length > 1 ? `${i + 1}/${list.length}쪽 ${p.label}` : p.label,
        progress: p.stage === "recognizing text" ? (i + p.progress) / list.length : p.progress,
      });
      const { data } = await worker.recognize(prepare(list[i]));
      parts.push(tidy(data.text || ""));
      confSum += data.confidence || 0;
    }
    progressHandler = null;
    return { text: parts.join("\n\n"), confidence: Math.round(confSum / list.length) };
  }

  return { recognize, warmUp: () => getWorker().catch(() => null) };
})();
