# 📄 문서 비서 — 찍으면, 그날의 할 일이 정리됩니다

가정통신문·체험학습 안내(학부모), 과제·장학 공지(대학생)를 **사진으로 찍거나 파일로 올리면**
AI가 읽고 요약한 뒤 **할 일·마감일·장소·준비물**을 뽑아 캘린더에 넣고,
**그날 날씨**와 **출발 시각**까지 계산해 알람으로 알려주는 웹 앱입니다.
순수 HTML / CSS / JavaScript로 만들었고 서버가 필요 없습니다.

- 🎤 **아이디어 소개**: `pitch.html`
- 📱 **휴대폰 화면 시연**: `demo.html` (휴대폰 모양 테두리 + 화면 이동 버튼)
- 🧪 **키 없이 체험**: `upload.html?demo=parent`, `upload.html?demo=student`
- 🔎 **키 없이 간단 분석**: Gemini 키가 없으면 내 사진도 브라우저 안의 글자 인식(Tesseract) + 날짜 규칙으로 날짜 위주 분석
- 💡 **아이디어·방향성 정리**: `IDEAS.md`

## 실행 방법
`file://`로 직접 열면 모듈(`type="module"`)이 동작하지 않으므로 로컬 서버로 엽니다.

- VS Code: **Live Server** 확장 설치 → `index.html` 우클릭 → *Open with Live Server*
- 또는 터미널: `npx serve .` 후 표시된 주소로 접속

키가 없어도 홈의 **학부모 예시 / 대학생 예시** 버튼으로 전체 흐름을 체험할 수 있습니다.
실제 문서를 분석하려면 **설정**에서 키를 넣으세요.
키 없이 내 사진을 올리면 **간단 분석**(글자 인식 + 날짜 찾기)으로 진행되고, Gemini가 붐비거나 무료 한도를 넘었을 때도
"키 없이 간단 분석으로 계속" 버튼으로 이어 갈 수 있습니다. (날짜 위주라 할 일 이름·종류는 직접 확인해야 합니다)

### Gemini API 키 (문서 분석)
1. https://aistudio.google.com/apikey → *Create API key*
2. 웹의 **설정 → Gemini API 키**에 붙여넣고 저장 (모델 이름도 설정에서 바꿀 수 있음)

### 카카오 키 (장소 검색 · 이동 시간)
1. https://developers.kakao.com/console/app → 애플리케이션 추가
2. *JavaScript 키*와 *REST API 키*를 **설정 → 카카오**에 저장
3. **플랫폼 → Web**에 사이트 도메인 등록: `http://localhost:5500`, `http://127.0.0.1:5500`, 배포 주소
4. **카카오맵** 사용 설정 켜기

> ⚠️ **API 키를 코드나 커밋에 절대 넣지 마세요.** 키는 각자 브라우저(localStorage)에만 저장되고 백업 파일에도 들어가지 않습니다.
> ⚠️ 무료 Gemini는 입력 내용이 Google 서비스 개선에 쓰일 수 있으니 민감한 개인정보 문서는 올리지 마세요.

## 구조: 메인 에이전트 1개 + 역할 4개
AI(Gemini)는 문서 한 건당 **한 번만** 호출합니다. 날씨·길찾기·문서 펴기는 정해진 계산과 API로 충분해서 AI가 필요 없습니다.
LLM 에이전트 4개가 각자 AI를 부르면 무료 사용량이 4배로 들고, 느려지고, 실패 지점이 늘어납니다.

```
사진(최대 5장) ─▶ 메인 에이전트 (js/agents/orchestrator.js)
                   │
                   ├─ ② analyzeAgent : Gemini 1회 → 문서 종류, 요약, 할 일, 날짜, 장소, 준비물,
                   │                   회신·납부·연락처, 대학생 과제 단계 계획, 페이지별 모서리·흐림
                   │    └ (키 없음·한도 초과) localAnalyzer : OpenCV 테두리 → Tesseract 글자 인식 → 날짜 규칙(js/dates.js)
                   │                                          → 같은 모양의 결과(할 일은 모두 '확인 필요' 표시)
                   ├─ ① scanAgent    : 모서리로 원근 보정(모서리가 없으면 OpenCV로 찾기) → 컬러/회색조/흑백 → JPG / PDF(여러 장) → 문서함 보관
                   ├─ ④ routeAgent   : 카카오 장소 검색 → 자동차/도보 소요시간 → 출발 시각 → 출발 알람
                   └─ ③ weatherAgent : Open-Meteo(무료) → 그날·그 장소 날씨 → 우산 자동 추가, 옷차림
```

## 기능
| 구분 | 기능 |
|---|---|
| ① 문서 인식 | PDF는 글자 레이어를 바로 읽고(글자 없는 스캔 PDF는 Gemini로), 한글 HWPX 문서도 글자를 바로 읽음 (구형 HWP는 HWPX·PDF로 저장 안내), 기울어진 사진 자동 펴기(AI 모서리, 없으면 OpenCV 테두리 찾기), 모서리 손으로 조정, 스캔 모드(컬러·회색조·흑백), 여러 장 → PDF 한 파일, JPG 저장, 흐린 사진 경고 |
| 키 없이 | Gemini 키가 없거나 한도 초과 시 간단 분석: 브라우저 안 글자 인식(한국어+영어) → 날짜·시간·마감/행사/기간 분류, 상대 날짜("내일", "다음 주 수요일"), 문의 전화번호 (사진·HWPX·글자 있는 PDF, 스캔 PDF 제외) |
| ② 분석 | 문서 종류·대상(학부모/대학생) 자동 판별, 요약, 할 일 종류(참석/마감/회신/납부/준비), 근거 문장, 불확실한 항목 노란 표시, 사진·PDF·글자 페이지(HWPX/PDF 글자) 함께 분석, 문서 속 지시문 무시(프롬프트 주입 방어), 코드 검증(날짜·시간 형식, 날짜와 요일 불일치·너무 먼 날짜 경고), 영수증처럼 할 일이 없는 문서도 처리, 90초 응답 시간 제한 |
| 학부모 | 회신서·동의서 감지 → 회신 할 일 자동 생성, 납부 정보(금액·계좌 복사), 문의처 전화 연결 |
| 대학생 | 마감에서 거꾸로 세운 단계 계획(조사 → 초안 → 검토)을 캘린더에 함께 등록 |
| ③ 날씨 | 홈의 오늘 날씨(내 위치 지역 이름 표시, 앞으로 6시간), 할 일 날짜·장소·시각의 예보, 미세먼지·초미세먼지(환경부 기준 등급), 자외선, 비 오면 우산·미세먼지 나쁘면 마스크를 준비물에 추가, 옷차림 조언 |
| ④ 이동 | 장소 검색, 소요시간, 출발 시각, 출발 10분 전·출발 알람, 당일 아침 재계산, 대중교통 길찾기 링크 |
| 알림 | 하루 전·당일 아침·1시간 전 알람, 매일 아침 브리핑, 화면 내 알림, `.ics` 내보내기(웹을 닫아도 휴대폰 알람) |
| 관리 | 오늘·내일 브리핑 카드(준비물 체크리스트), 월간 캘린더, 문서함 검색·필터, 중복 문서 감지, 백업/복원, 일정 시간 겹침 경고(홈·캘린더, 이동 시간 포함) |
| 접근성 | 요약 언어 선택(쉬운 한국어, English, 中文, Tiếng Việt), PWA 설치, 다크 모드, 휴대폰 하단 탭 바 |

## 한계 (알고 쓰기)
- 서버가 없어서 **탭이 닫혀 있으면 알림이 오지 않습니다** → `.ics`로 휴대폰 캘린더에 넣으면 휴대폰이 알람을 울립니다.
- 데이터는 이 브라우저에만 저장됩니다(할 일: localStorage, 스캔 이미지: IndexedDB). 기기 이동은 백업 파일로.
- 소요시간은 **자동차 기준**(카카오모빌리티)이며 가까우면 도보 기준입니다. 대중교통은 카카오맵 링크로 확인합니다.
- 날씨 예보는 16일 이내 날짜만 표시됩니다.
- 아이폰은 홈 화면에 추가(PWA)해야 알림을 받을 수 있습니다.
- 키 없는 간단 분석은 처음 한 번 글자 인식 데이터(수 MB)와 OpenCV(약 10MB)를 내려받습니다. 날짜만 규칙으로 찾으므로 장소·준비물·회신·납부는 채우지 않습니다.

## 파일 구조
```
index.html        홈: 오늘 날씨, 브리핑, 다가오는/놓친 할 일, 최근 문서
upload.html       업로드(여러 장) → 분석 → 문서 펴기·저장 → 할 일 확인 → 저장 (예시 모드 포함)
calendar.html     월간 캘린더, 종류별 색, 준비물 체크, .ics 내보내기
docs.html         문서함: 검색·필터, 스캔 이미지, PDF 다시 받기
settings.html     키, 요약 언어, 출발지, 알림·아침 브리핑, 설치, 백업
pitch.html        아이디어 소개 페이지
demo.html         휴대폰 테두리 시연 페이지 + 화면 이동·데이터 초기화
sw.js, manifest.webmanifest, icon.svg   PWA(설치·오프라인·알림 클릭)
css/style.css     공통 스타일 (다크 모드, 모바일 하단 탭)
js/config.js      모델명, 언어, 기본 설정
js/util.js        날짜·이스케이프 도우미
js/storage.js     localStorage 저장 (다른 파일은 이것만 사용)
js/archive.js     IndexedDB 스캔 이미지 보관
js/image.js       이미지 압축, 흐림 측정, 중복 지문
js/intake.js      파일 받기: 사진 / PDF 글자 레이어(pdf.js) / 한글 HWPX 글자(JSZip) → 분석용 페이지
js/cornerEditor.js  모서리 끌어서 조정
js/calendar.js    달력 그리기
js/notify.js      알람 계산·발송, 아침 브리핑
js/ics.js         .ics 내보내기
js/demo.js        예시 문서(캔버스로 그린 사진) + 미리 만든 분석 결과
js/nav.js         공통 메뉴, 마감 배너, 서비스 워커 등록
js/agents/orchestrator.js   메인 에이전트
js/agents/analyzeAgent.js   ② Gemini 호출·프롬프트·스키마 (규칙은 systemInstruction, 문서 내용은 데이터로만)
js/agents/validateResult.js ② 분석 결과 코드 검증 (날짜·시간 형식, 요일 불일치, 너무 먼 날짜)
js/agents/scanAgent.js      ① 원근 보정·PDF
js/agents/weatherAgent.js   ③ 날씨·조언
js/agents/routeAgent.js     ④ 장소·소요시간·출발 시각
js/agents/localAnalyzer.js  ② 키 없는 간단 분석 (Tesseract 글자 인식 + 날짜 규칙, 같은 결과 모양)
js/dates.js       규칙 기반 한국어 날짜 분석기 (마감/행사/기간/만료/발행, 상대 날짜, 시간)
js/schedule.js    일정 시간 겹침 찾기 (출발~시작+1시간 가정, 업로드 화면용 conflictsWithExisting)
tests/dates.test.js  날짜 분석기 테스트 (Node)
tests/validate.test.js  분석 결과 검증 테스트 (Node 또는 브라우저)
tests/schedule.test.js  시간 겹침 테스트 (Node)
package.json      Node 테스트용 ("type": "module"만 지정, 빌드 없음)
```

### 날짜 분석기 테스트
Node 18 이상에서 저장소 루트에서 실행합니다 (설치할 패키지 없음).
```
node tests/dates.test.js     # 또는 npm test
node tests/validate.test.js  # 분석 결과 검증: 요일 불일치, 없는 날짜·틀린 시간, 문서 속 지시문, 영수증(할 일 0개)
```

### 만든 사람
키 없는 간단 분석(글자 인식·날짜 분석), OpenCV 테두리 찾기, 회색조·흑백 스캔 모드는
팀원 leokiller6646의 `dw` 브랜치 구현을 옮겨 온 것입니다.
문서 속 지시문 방어, 분석 결과 코드 검증(요일 불일치 등), 응답 시간 제한은 팀원 may0ne2e의 `sex-extract` 브랜치 구현을 참고/이식했습니다.
PDF 글자 레이어·한글(HWPX) 글자 읽기는 팀원 may0ne2e의 `sex-extract` 브랜치 구현을 참고/이식했습니다.
일정 시간 겹침 경고는 팀원 may0ne2e의 `sex-extract` 브랜치 구현을 참고/이식했습니다.

## 데이터 형식
```js
// localStorage
docs:  [{ id, title, summary, keyPoints[], docType, audience, reply, payment, contacts[], hash, demo, pageCount, createdAt }]
tasks: [{ id, docId, group, kind: 'event'|'deadline'|'reply'|'payment'|'prep'|'step',
          title, description, dueDate: 'YYYY-MM-DD', dueTime: 'HH:MM'|null,
          location, place: {name, address, lat, lng}|null, travel: {minutes, basis, departAt, mapLink}|null,
          items[], itemsDone[], sourceText, done, reminders: [{ at, notified, label? }] }]
// 분석 결과(화면용) tasks[]에는 confidence: 'high'|'low', warning: string|null(코드 검증 경고)이 붙습니다
settings: { apiKey, model, language, remindDayBefore, remindMorningOf, morningHour, morningBriefing,
            kakaoJsKey, kakaoRestKey, home, travelBuffer }
// IndexedDB 'doc-assistant' / 'pages' : docId → JPEG Blob[]
```

## 배포 (GitHub Pages)
저장소 *Settings → Pages → Branch: main / (root)* → `https://<계정>.github.io/<저장소>/`
배포 주소를 카카오 개발자 콘솔의 Web 플랫폼에도 등록하세요.
