// 예시 체험 모드: API 키·인터넷 없이도 전체 흐름을 보여주기 위한 예시 문서와 미리 만든 분석 결과.
// 예시 "사진"은 캔버스로 직접 그립니다(기울어진 종이를 찍은 것처럼). 날짜는 오늘 기준으로 계산합니다.
import { toDateKey } from './util.js';

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toDateKey(d);
}
function md(key) {
  const [, m, d] = key.split('-').map(Number);
  return `${m}월 ${d}일`;
}

const SAMPLES = {
  parent: () => {
    const trip = addDays(3), reply = addDays(1);
    return {
      paper: {
        heading: '2학년 현장체험학습 안내',
        org: '○○초등학교',
        lines: [
          '학부모님 안녕하십니까.',
          '2학년 현장체험학습을 아래와 같이 실시하오니',
          '자녀가 참여할 수 있도록 협조 부탁드립니다.',
          '',
          `■ 일시: ${md(trip)} 오전 9시 (현장 집합)`,
          '■ 장소: 국립과천과학관 정문',
          '■ 준비물: 도시락, 물, 돗자리, 편한 운동화',
          '■ 체험비: 15,000원 (스쿨뱅킹 자동 출금)',
          '',
          `※ 참가 동의서를 ${md(reply)}까지 담임 선생님께`,
          '   제출해 주시기 바랍니다.',
          '',
          '문의: 2학년 교무실 02-123-4567',
        ],
      },
      result: {
        doc_type: 'school_notice',
        audience: 'parent',
        title: '2학년 현장체험학습 안내',
        summary: `2학년이 ${md(trip)} 국립과천과학관으로 현장체험학습을 갑니다. 오전 9시까지 과학관 정문으로 직접 데려다줘야 합니다. 체험비 15,000원은 스쿨뱅킹으로 빠져나가고, 참가 동의서는 ${md(reply)}까지 내야 합니다.`,
        key_points: ['오전 9시 현장 집합 (학교 아님)', '도시락·물·돗자리·운동화 준비', '체험비 15,000원 스쿨뱅킹 출금', `참가 동의서 ${md(reply)}까지 제출`],
        reply: { due_date: reply, method: '담임 선생님께 제출', what: '현장체험학습 참가 동의서' },
        payment: { amount: '15,000원', bank: null, account: null, holder: null, due_date: trip, method: '스쿨뱅킹 자동 출금' },
        contacts: [{ name: '2학년 교무실', phone: '02-123-4567' }],
        tasks: [
          {
            kind: 'event', title: '현장체험학습 데려다주기', description: '국립과천과학관 정문에 오전 9시까지 집합',
            due_date: trip, due_time: '09:00', location: '국립과천과학관', items: ['도시락', '물', '돗자리', '편한 운동화'],
            confidence: 'high', steps: [], source_text: `일시: ${md(trip)} 오전 9시 (현장 집합)`,
            demoPlace: { name: '국립과천과학관', address: '경기 과천시 상하벌로 110', lat: 37.4363, lng: 127.0052 },
          },
          {
            kind: 'reply', title: '참가 동의서 제출하기', description: '서명해서 담임 선생님께 제출',
            due_date: reply, due_time: null, location: null, items: ['참가 동의서(서명)'],
            confidence: 'high', steps: [], source_text: `참가 동의서를 ${md(reply)}까지 담임 선생님께 제출해 주시기 바랍니다.`,
          },
          {
            kind: 'payment', title: '체험비 잔액 확인하기', description: '스쿨뱅킹 계좌에 15,000원 이상 있는지 확인',
            due_date: addDays(2), due_time: null, location: null, items: [],
            confidence: 'low', steps: [], source_text: '체험비: 15,000원 (스쿨뱅킹 자동 출금)',
          },
        ],
      },
    };
  },

  student: () => {
    const due = addDays(9), talk = addDays(5);
    return {
      paper: {
        heading: '[자료구조] 과제 3 공지',
        org: '컴퓨터공학과',
        lines: [
          '과제 3: 해시 테이블 구현 및 성능 비교 보고서',
          '',
          `■ 제출 기한: ${md(due)} 23:59 (LMS 업로드)`,
          '■ 제출물: 소스코드(zip) + 보고서(PDF, 5쪽 이내)',
          '■ 지각 제출: 하루당 10% 감점',
          '',
          '■ 진로 특강 (출석 인정)',
          `   ${md(talk)} 오후 2시, 코엑스 컨퍼런스룸`,
          '   학생증 지참',
          '',
          '질문은 조교 메일 또는 연구실로 연락 바랍니다.',
          '조교실 02-987-6543',
        ],
      },
      result: {
        doc_type: 'university_assignment',
        audience: 'student',
        title: '자료구조 과제 3 · 진로 특강 공지',
        summary: `자료구조 과제 3은 해시 테이블을 구현하고 성능 비교 보고서를 쓰는 과제로, ${md(due)} 23:59까지 LMS에 내야 합니다. 늦으면 하루에 10%씩 깎입니다. ${md(talk)} 오후 2시 코엑스 진로 특강에 가면 출석이 인정됩니다.`,
        key_points: ['소스코드(zip) + 보고서(PDF 5쪽 이내)', '지각 시 하루 10% 감점', '진로 특강 출석 인정, 학생증 필요'],
        reply: null,
        payment: null,
        contacts: [{ name: '조교실', phone: '02-987-6543' }],
        tasks: [
          {
            kind: 'deadline', title: '자료구조 과제 3 제출', description: '소스코드 zip + 보고서 PDF(5쪽 이내) LMS 업로드',
            due_date: due, due_time: '23:59', location: null, items: ['소스코드 zip', '보고서 PDF'],
            confidence: 'high',
            steps: [
              { title: '해시 테이블 구현 완료', date: addDays(3) },
              { title: '성능 측정 실험', date: addDays(5) },
              { title: '보고서 초안 작성', date: addDays(7) },
              { title: '최종 검토 후 제출', date: addDays(8) },
            ],
            source_text: `제출 기한: ${md(due)} 23:59 (LMS 업로드)`,
          },
          {
            kind: 'event', title: '진로 특강 참석', description: '출석 인정, 학생증 지참',
            due_date: talk, due_time: '14:00', location: '코엑스', items: ['학생증'],
            confidence: 'high', steps: [], source_text: `${md(talk)} 오후 2시, 코엑스 컨퍼런스룸`,
            demoPlace: { name: '코엑스', address: '서울 강남구 영동대로 513', lat: 37.5116, lng: 127.0595 },
          },
        ],
      },
    };
  },
};

// 종이를 기울여 찍은 듯한 사진을 그리고, 종이 네 모서리(0~1000 좌표)를 함께 돌려줌
function drawPhoto(paper) {
  const PW = 900, PH = 1180;
  const sheet = document.createElement('canvas');
  sheet.width = PW;
  sheet.height = PH;
  const s = sheet.getContext('2d');
  s.fillStyle = '#fbfaf5';
  s.fillRect(0, 0, PW, PH);
  s.fillStyle = '#222';
  s.textBaseline = 'top';
  s.font = '600 26px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  s.fillText(paper.org, 60, 60);
  s.font = '700 44px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  s.fillText(paper.heading, 60, 120);
  s.fillRect(60, 190, PW - 120, 3);
  s.font = '30px "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  paper.lines.forEach((line, i) => s.fillText(line, 60, 230 + i * 58));

  const W = 1200, H = 1600;
  const photo = document.createElement('canvas');
  photo.width = W;
  photo.height = H;
  const p = photo.getContext('2d');
  // 나무 책상 배경
  const grad = p.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#7a5534');
  grad.addColorStop(1, '#4e341e');
  p.fillStyle = grad;
  p.fillRect(0, 0, W, H);
  for (let i = 0; i < 40; i++) {
    p.strokeStyle = `rgba(0,0,0,${0.04 + Math.random() * 0.05})`;
    p.beginPath();
    p.moveTo(0, i * 42 + Math.random() * 10);
    p.bezierCurveTo(W / 3, i * 42 + 20, (2 * W) / 3, i * 42 - 20, W, i * 42 + Math.random() * 10);
    p.stroke();
  }

  const angle = -0.09, cx = W / 2 + 20, cy = H / 2 + 10, scale = 1.08;
  p.save();
  p.translate(cx, cy);
  p.rotate(angle);
  p.scale(scale, scale);
  p.shadowColor = 'rgba(0,0,0,0.45)';
  p.shadowBlur = 30;
  p.shadowOffsetY = 12;
  p.drawImage(sheet, -PW / 2, -PH / 2);
  p.restore();
  // 조명 그림자
  const light = p.createRadialGradient(W * 0.3, H * 0.2, 100, W * 0.5, H * 0.5, H);
  light.addColorStop(0, 'rgba(255,255,255,0.08)');
  light.addColorStop(1, 'rgba(0,0,0,0.25)');
  p.fillStyle = light;
  p.fillRect(0, 0, W, H);

  const corner = (x, y) => {
    const xs = x * scale, ys = y * scale;
    const rx = xs * Math.cos(angle) - ys * Math.sin(angle) + cx;
    const ry = xs * Math.sin(angle) + ys * Math.cos(angle) + cy;
    return { x: Math.round((rx / W) * 1000), y: Math.round((ry / H) * 1000) };
  };
  const corners = {
    top_left: corner(-PW / 2, -PH / 2),
    top_right: corner(PW / 2, -PH / 2),
    bottom_right: corner(PW / 2, PH / 2),
    bottom_left: corner(-PW / 2, PH / 2),
  };
  const dataUrl = photo.toDataURL('image/jpeg', 0.88);
  return { dataUrl, corners };
}

// 반환: { page: {mimeType, data, previewUrl, name}, result }
export function loadSample(kind) {
  const make = SAMPLES[kind];
  if (!make) return null;
  const { paper, result } = make();
  const { dataUrl, corners } = drawPhoto(paper);
  result.pages = [{ corners, blurry: false }];
  return {
    page: { mimeType: 'image/jpeg', data: dataUrl.split(',')[1], previewUrl: dataUrl, name: `예시-${kind}.jpg` },
    result,
  };
}

export const SAMPLE_LABELS = { parent: '🏫 학부모: 현장체험학습 안내', student: '🎓 대학생: 과제 공지' };
