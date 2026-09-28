# 앱 코드 구조 (index.html)

> index.html 앱 스크립트의 구조를 정리한다. 코드를 고치기 전에 이 문서로 해당 화면의 상수·함수·연결 지점을 먼저 파악한다.
> 라인 번호는 변경으로 밀리므로 참고용이다. 실제 위치는 grep으로 확인한다.

## 전체 구조

index.html은 하나의 큰 파일이다.

1. `<style>` — CSS.
2. HTML 본문 — `#app`, `#gl`(WebGL canvas), `#homeimg`, `.head`, `.ver`, `.back`, 버튼 등.
3. 라이브러리 `<script>` — Three.js, Rapier IIFE 번들 (base64/미니파이).
4. 에셋 `<script>` — 원단 `CLOTH`, 글꼴 `@font-face`, 서명·지도·홈 렌더 PNG 등 거대한 base64 상수.
5. **앱 스크립트** — 마지막 `<script>` ~ `</script>`. `(async function main(){ ... })()`로 시작·끝. **여기가 Kiro의 주 편집 영역.**

`<script`/`</script>` 태그는 각 5개다.

## 화면 전환 뼈대

- **`setScreen(s)`** — 화면 키(`home`/`flag`/`coin`/`rice`/`yijing`/`santong`/`sinkal`)를 받아 씬 그룹 가시성을 토글하고 카메라를 옮긴다: `cam.position.set(...CAMS[s].pos); cam.lookAt(...CAMS[s].look)`.
- **`CAMS`** — 화면별 카메라 위치·시선. 예: `CAMS.santong = {pos:[0,0.070,0.250], look:[0,0.020,0]}`.
- **`buildUI()`** — 현재 `screen`에 맞춰 UI(제목·안내·결과·버튼)를 다시 그린다. 첫머리에서 씬 그룹 가시성도 토글한다. 화면별 분기(`if(screen==='...')`)로 나뉜다.
- **`draw()`** — 한 프레임 렌더. **WebGL은 크기가 바뀌면 버퍼가 지워지므로 `layout()` 뒤 반드시 `draw()`.**
- **`T(canvas, srgb)`** — CanvasTexture 헬퍼 (main 초반 정의).

새 화면을 더할 때 건드리는 공용 코드: `CAMS.<키>`, `setScreen`의 그룹 토글 1줄, `buildUI`의 분기, 씬 그룹 `g<이름>`, pointerdown 분기, 첫 화면 진입점.

## 첫 화면 (home) — Claude 영역

- `#homeimg` — 블렌더 렌더 WebP(base64), `#gl` 위·UI 아래에 cover로 깐다. buildUI 첫 줄에서 home일 때만 보이게.
- **`HOME_HOT`** — 무구별 화면 비율 상자(렌더 기준 0~1, 왼쪽 위 원점). 렌더 교체 시 `blender/update_home.py`가 이미지와 함께 교체.
- **`homeHit(e)`** — 짚은 지점이 어느 무구인지 판정. 손가락이 든 후보 중 상자 중심 정규화 거리가 최소인 무구 선택(1차 실제 상자, 2차 여유 2%·최소 9%). `HOME_HOT_ORDER`는 미사용(남아 있음).
- 3D 첫 화면(`gHome`)은 코드에 남아 이미지 아래 가려짐(EDIT_UI 켜면 이미지 숨고 되살아남).

## 주역괘 (yijing) — Kiro

- 씬 그룹 `gYijing`. 세로축을 Y축 회전으로 바꾼 6개 육효 막대(피젯).
- **`startYijing()`** — 진입·대기(여러 번 호출 안전). **`spinYijing()`** — 튕겨 돌리고 멈춰 판정.
- **`YJ64`** — 64괘 KingWen 순서 데이터. **`YJ_TEXT`** — 괘별 한자 괘명 + 풀이(Kiro 초안, 은호당님 감수 대상).
- 한자 글꼴 **Iansui**(芫荽, OFL) 71자 서브셋 woff2를 base64로 인라인, `@font-face font-display:swap`.
- 동효 없음(64괘 균등 1/64).

## 산통 (santong) — Kiro (개발 중)

패턴: 독립 블록 `gSantong` + 런타임 상태 변수 + buildUI 토글. `setScreen`은 안 건드림.

### 상수
- `TUBE_R=0.026, TUBE_H=0.100, WALL_T=0.003, ST_SR=0.0017` — 통 반지름·높이·벽두께, 산가지 반지름.
- `ST_N=64` — 산가지(첨) 개수. `NSTICK=30` — 실제로 그리는 산가지 메시 수.
- `gSantong.scale.setScalar(0.62)`, `gSantong.position.set(0,0,0.010)`.
- **`ST_GRADE`** = `['대길','상길','중길','소길','평','소흉','흉']`.
- **`ST_TEXT`** — 번호 1~64 → `[등급, 한 줄 첨시]`. 등급 분포: 대길6·상길10·중길14·소길12·평12·소흉6·흉4 (합 64, 길함 우세). **Kiro 초안, 은호당님 감수 대상.**

### 상태 변수
- `stSticks[]` — 각 원소 `{mesh, home:(Vector3 clone), rz, rx, len}`. `home.y = len/2 + WALL_T`(밑끝이 바닥에서 WALL_T).
- `stMode` — `idle`/`shake`/`done`. `stResult` — `{num, grade, note}`. `stChosen` — 뽑힌 산가지. `stAnim` — rAF 핸들.

### 함수
- **`startSantong()`** — 진입·대기. 산가지 원위치, 번호판 숨김, 통 회전 0.
- **`shakeSantong()`** — 흔들기(SHAKE=1300ms) + 뽑기(RISE=800ms).
  - 흔들기: 통 좌우 기울임 + 산가지 잔진동.
  - 뽑기: 뽑힌 산가지가 **원래 x,z 자리에서 곧게 위로만 솟음**(`RISE_H=0.055`). 기울이지 않고 원래 부챗살 각도(rx, rz) 유지. 나머지와 나란히 서되 확실히 도드라짐.
  - done: 최종 솟은 위치를 명시적으로 고정 → 결과 화면에서도 솟은 채 유지.
- **번호판** — `gSantong.userData.label`(PlaneGeometry, CanvasTexture 64×256, Iansui 글꼴). `gSantong.userData.drawLabel(n)`이 한자 수를 그린다. `numHanja(n)`(1~64 → 한자, 十 단위). 뽑은 산가지 위쪽에 얹혀 카메라(+Z) 향함.

### 연결 지점
- `CAMS.santong = {pos:[0,0.070,0.250], look:[0,0.020,0]}`.
- buildUI 첫머리: `gSantong.visible=(screen==='santong'); if(screen!=='santong'&&stAnim){cancelAnimationFrame(stAnim);stAnim=null;}`
- 첫 화면 진입: `else if(k==='santong'){ setScreen('santong'); startSantong(); }`
- pointerdown: `if(screen==='santong'){ if(stMode==='idle'||stMode==='done') shakeSantong(); return; }`
- buildUI 분기: `} else if(screen==='santong'){` — 제목 "산통", verdict에 "제 n수 + 등급 + 첨시(yjnote 클래스)".

### 시행착오 (다시 밟지 말 것)
1. 중심을 축으로 옆으로 기울임 → 통 벽을 뚫음.
2. 통에서 완전히 빼서 기울임 → 화면 밖으로 사라짐.
3. 입구를 축으로 눕히기 → 은호당님: 위로 올라가 있고 갑자기 옆으로 기울어 어색함.
4. **현재(v1.1.1): 곧게 위로만 솟기** — 뽑힌 산가지가 원래 자리에서 수직으로 솟아 나머지와 나란히 섬. 카메라를 낮춰 통을 화면 중앙에. (은호당님 지시: "옆으로 하나가 뽑혀 수직으로 나란히 서는 연출")

## 대신칼 (sinkal) — Claude 초안 → Kiro 머지

- 씬 그룹 `gSinkal`. **`startSinkal()`** / **`throwSinkal()`**. Rapier 물리로 두 자루 한 덩어리 던짐.
- 술: Verlet 끈 + 공기 저항. 판정: 칼끝 저쪽(부정 나감)/이쪽(안 나감)/옆. 판정각 ±45°/135°는 은호당님 확인 전.

## 엽전 (coin) / 오방기 (flag) / 요미산 (rice) — 초기 구현

세부는 `../../CLAUDE.md`의 "화면과 법식" 절 참고. 요점:
- 엽전: 상평통보 7닢, 포개진 닢은 둘 다 버림(은호당 법식). 홀 치우침은 법식의 산술적 결과이지 버그 아님. **확률 맞추려 법식 바꾸지 말 것.**
- 오방기: 오방기/칠방기, 지도로 신줄 선택. 원단은 받은 사진 그대로(자르거나 늘리지 않음).
- 요미산: 명주실(현수선)/화상점. 결과는 알 수·홀짝.

## 밟은 지뢰 (앱 코드)

- `homeFlags` 색인: 0~4 대나무, 그 뒤가 천. 색인 틀리면 오방기 화면 깃대까지 바뀜.
- WebGL은 크기 변경 시 버퍼 소실 → `layout()` 뒤 `draw()`. 회전 시 1.2초간 매 프레임 재그리기(`relayout`).
- `setLinvel/setAngvel`의 wakeUp을 true로 두면 제동 중 계속 깨워 정지 판정 안 남.
- Rapier 캡슐 긴 축은 Y. 쌀알은 X가 길어 충돌체를 Z축 -90° 회전.
- 브라우저 창이 가려지면 requestAnimationFrame이 멈춰 헤드리스 테스트가 로딩에서 섬 → 테스트 사본만 rAF를 setTimeout으로.

## 검증·디버그

- 로컬: `python -m http.server 8080` (repo/에서). 서비스 워커까지 돌게.
- 디버그 훅: URL에 `?debug` 또는 `#debug`일 때만 노출. `window.__api`(setScreen, drawFlags, spawnCoins/releaseCoins, flagPick, ricePick, state 등), `window.__dbg`, `window.__probe`.
- "했다·확인했다"는 도구로 실제 확인한 것만. 3D는 Kiro가 직접 못 보므로 스크린샷 의존.
