// 문서 네 모서리를 손가락/마우스로 끌어서 조정하는 편집기
export function createCornerEditor(container, img, corners) {
  const canvas = document.createElement('canvas');
  canvas.className = 'corner-canvas';
  container.innerHTML = '';
  container.appendChild(canvas);

  const W = img.naturalWidth, H = img.naturalHeight;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  let pts = corners.map((p) => ({ ...p }));
  let dragging = -1;
  const handle = Math.max(W, H) * 0.025;

  function draw() {
    ctx.drawImage(img, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 3; i >= 0; i--) ctx.lineTo(pts[i].x, pts[i].y); // 반대 방향으로 그려 구멍 뚫기
    ctx.fill('evenodd');
    ctx.strokeStyle = '#4f46e5';
    ctx.lineWidth = handle / 4;
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
    ctx.stroke();
    for (const p of pts) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, handle, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(79,70,229,0.85)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    }
  }

  function toImage(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const p = toImage(e);
    let best = -1, bestD = Infinity;
    pts.forEach((q, i) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (bestD < handle * 4) {
      dragging = best;
      canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (dragging < 0) return;
    const p = toImage(e);
    pts[dragging] = { x: Math.min(Math.max(p.x, 0), W), y: Math.min(Math.max(p.y, 0), H) };
    draw();
  });
  const stop = () => { dragging = -1; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointercancel', stop);

  draw();
  return { getCorners: () => pts.map((p) => ({ ...p })) };
}
