# 앱 코드 구조 (index.html)

> index.html 앱 스크립트의 구조를 정리한다. 코드를 고치기 전에 이 문서로 해당 화면의 상수·함수·연결 지점을 먼저 파악한다.
> 라인 번호는 변경으로 밀리므로 참고용이다. 실제 위치는 grep으로 확인한다.

## 전체 구조

index.html은 하나의 큰 파일이다(약 6,080줄, CRLF, BOM 없음). 줄 번호는 v1.2.4 + 밤샘 작업(f2b25b3) 기준.

1. `<style>` (12~176줄) — CSS. 맨 앞 13~15줄이 글꼴 `@font-face` 세 벌(base64 woff2): `Iansui`(한자), `JSE` 400·700(정속언해체, 앱 본문 글꼴, 한자 0자).
2. HTML 본문 — `#app`, `#gl`(WebGL canvas), `#homeimg`(179줄, 첫 화면 렌더 WebP base64), `.head`, `.ver`, `.back`, `#err` 등.
3. `<script>` 1 (198~204줄) — `window.__fail`·`window.onerror`. 오류를 `#err`에 띄운다.
4. `<script>` 2·3 — Three.js(205줄), Rapier(4324줄) IIFE 번들 (미니파이, 한 줄).
5. **앱 스크립트** `<script>` 4 (4326~6074줄) — `(async function main(){ ... })()`. 원단 `CLOTH` 같은 거대한 base64 상수도 이 안에 있다. **여기가 Kiro의 주 편집 영역.**
6. `<script>` 5 (6075~6080줄) — 서비스 워커 등록과 새 판 메시지 수신기(아래 "새 판 알림").

`<script`/`</script>` 태그는 각 5개다. 앱 스크립트는 "마지막 `(async function main()` ~ 다음 `</script>`"로 떼어 문법 검사한다(맨 마지막 `<script>`가 아니다).

## 글꼴

- 본문은 `JSE`(정속언해체)에 `"Noto Serif KR","Nanum Myeongjo","Batang",serif` 대체. 한자가 없어서 한자는 Iansui 가 맡는다.
- **Iansui**(芫荽, OFL) 82자 서브셋: 64괘 괘명 71자 + 산통 번호 一~十 10자 + 엽전 뒷면 `金`(b03bd7e, 이전 71자). 쓰는 곳 세 군데:
  - 주역 결과 `.verdict .yjhanja`(CSS).
  - 엽전 뒷면 `backGlyph(S,ch)` — 글꼴 목록 맨 앞이 `"Iansui"`.
  - 산통 번호판 `stDrawLabel(n)` — `bold 30px "Iansui",serif`.
- 캔버스는 글꼴을 기다리지 않으므로 `await step('엽전 새기는 중')` 다음, `coinTex(768,COIN_BACK)` 앞에서 `document.fonts.load('165px "Iansui"', COIN_BACK)`를 3초 타이머와 `Promise.race`로 기다린다(try/catch, 실패하면 기기 글꼴로 계속). 서브셋이 한 벌이라 번호판 글자도 함께 불린다.
- 서브셋을 다시 만들 때는 앱 데이터(`YJ_TEXT`·`numHanja`·`COIN_BACK`)에서 글자를 뽑아 지금 82자를 모두 포함하게 한다.

## 화면 전환 뼈대

- **`setScreen(s)`** — 화면 키(`home`/`flag`/`coin`/`rice`/`yijing`/`santong`)를 받아 씬 그룹 가시성을 토글하고 카메라를 옮긴다: `cam.position.set(...CAMS[s].pos); cam.lookAt(...CAMS[s].look)`.
- **`CAMS`** — 화면별 카메라 위치·시선. 예: `CAMS.santong = {pos:[0,0.055,0.235], look:[0,0.045,0]}`.
- **`buildUI()`** — 현재 `screen`에 맞춰 UI(제목·안내·결과·버튼)를 다시 그린다. 첫머리에서 씬 그룹 가시성도 토글한다. 화면별 분기(`if(screen==='...')`)로 나뉜다.
- **`draw()`** — 한 프레임 렌더. **WebGL은 크기가 바뀌면 버퍼가 지워지므로 `layout()` 뒤 반드시 `draw()`.**
- **`T(canvas, srgb)`** — CanvasTexture 헬퍼 (main 초반 정의).

새 화면을 더할 때 건드리는 공용 코드: `CAMS.<키>`, `setScreen`의 그룹 토글 1줄, `buildUI`의 분기, 씬 그룹 `g<이름>`, pointerdown 분기, 첫 화면 진입점.

## 첫 화면 (home) — Claude 영역

- `#homeimg` — 블렌더 렌더 WebP(base64, 지금 home_v26), `#gl` 위·UI 아래에 cover로 깐다. buildUI 첫 줄에서 home이고 배치 조정 중이 아닐 때만 보이게.
- **`HOME_IMG_W, HOME_IMG_H`** = 3120×1440(렌더 크기).
- **`HOME_HOT`** — 무구별 화면 비율 상자(렌더 기준 0~1, 왼쪽 위 원점). 키 다섯: `roll`(오방기)·`coin`·`rice`·`santong`·`juyeok`. 값은 `blender/render/home_vNN_raw_hotspots.json`을 `blender/update_home.py`가 이미지와 함께 넣는다. **한 줄로 둔다**(update_home.py 가 `const HOME_HOT=\{.*?\};` 한 줄을 바꾼다). v1.2.3부터 오방기 손잡이가 화면 아래로 나가 `roll` 상자 y1 이 1을 넘는다(1.3596), `santong` y0 은 음수.
- **`homeHit(e)`** — 짚은 지점이 어느 무구인지 판정. 세로 화면은 눕혀 쓰므로 좌표를 돌리고, cover 배율로 렌더 비율 좌표(fx, fy)로 되돌린다. `for(const k in HOME_HOT)`로 손가락이 든 후보를 모아 상자 중심 정규화 거리가 최소인 무구 선택(1차 실제 상자, 2차 여유 2%·최소 9%). 옛 `HOME_HOT_ORDER`(작은 무구 먼저)는 v1.0.1부터 안 쓰였고 cd89da1에서 지웠다.
- 3D 첫 화면(`gHome`)은 코드에 남아 이미지 아래 가려짐(`EDIT_UI=false`, 켜면 배치 조정기가 나오고 이미지 숨고 되살아남).

## 새 판 알림 (sw.js + 앱) — Kiro (684a464, d2f6074, f2b25b3)

- **sw.js** — 캐시 우선 + 뒤에서 새로 받기. 문서 요청(`mode==='navigate'`)이고 캐시본이 있을 때만, 덮어쓰기 전 캐시본과 새로 받은 본의 SHA-256 을 비교한다. 순서는 `cache.put` → 꼬리(`?…`) 달린 항목 지우기 → 다를 때만 `postMessage({type:'hj-new-version'})`(`clients.matchAll({type:'window',includeUncontrolled:true})`). 처음 설치(캐시 없음)·오프라인·`!res.ok`·해시 같음이면 알리지 않는다. 캐시 이름 `hyudae-jeomsang` 고정.
- **수신기** — 마지막 `<script>`의 `navigator.serviceWorker` message 수신기가 `window.__hjNewVer=true`를 세우고 `window.__hjUpd`(= `updNotice`)를 부른다. 앱이 아직 준비 전이면 깃발만 남는다.
- **`updNotice()`** — 보일 조건: `__hjNewVer && __ready===true && screen==='home' && !edit` 이고 점 치는 중 아님(`mode==='fly'`·`rMode==='fly'`·`yjMode==='spin'`·`stMode==='shake'`·`flagBusy` 모두 아님). `#updnote`(`.toast.upd`, role=status, aria-live=polite) 하나를 만들어 두고 `hidden`·`.on`만 켜고 끈다. 안의 `<button type="button">` 글은 "새 판을 받았습니다. 짚으면 바꿉니다", 누르면 `location.reload()`. 저절로 새로고침하지 않는다.
- 부르는 곳: buildUI 끝, `window.__ready=true` 직후, 깃발 연출 끝(`draw(); flagBusy=false; updNotice();`, 깃발만 연출 끝에 buildUI 를 안 부르기 때문).
- CSS: `.toast.upd`는 `padding:0`, 여백은 버튼에. 버튼 `::after`(`top:0; height:max(100%,44px)`)로 누르는 자리만 아래로 44px까지 늘린다(위는 엽전 상자라 안 늘림). `.toast.upd` div 에 display 규칙이 없어 `hidden`이 먹는다.
- `toast(msg)`는 `.toast:not(.upd)`만 잡아 알림을 덮지 않는다(지금 부르는 곳 없음).
- pointerdown 은 `.upd` 안을 짚으면 무시한다.
- 남은 것: 글이 든 채로 붙인 뒤 `hidden`만 바꿔서 낭독기에 따라 안 읽힐 수 있다(낭독기 확인 전, 리뷰 F2).

## 주역괘 (yijing) — Kiro

- 씬 그룹 `gYijing`. 세로축을 Y축 회전으로 바꾼 6개 육효 막대(피젯).
- **`startYijing()`** — 진입·대기(여러 번 호출 안전). **`spinYijing()`** — 튕겨 돌리고 멈춰 판정.
- **`YJ64`** — 64괘 KingWen 순서 데이터. **`YJ_TEXT`** — 괘별 한자 괘명 + 풀이(Kiro 초안, 은호당님 감수 대상).
- 괘명 한자는 **Iansui**(위 "글꼴", 82자 서브셋, `font-display:swap`)로 `.yjhanja`에 그린다.
- 동효 없음(64괘 균등 1/64).

## 산통 (santong) — Kiro (v1.1.0부터 배포, 첨시·법식은 은호당님 감수 전)

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
- **`shakeSantong()`** — 흔들기(SHAKE=1300ms) + 뽑기(RISE=800ms). 시작하자마자 `stMode='shake'; stResult=null; buildUI();`로 앞 결과를 지우고 "산가지가 나오는 중입니다" 안내를 띄운다(06585c1).
  - 흔들기: 통 좌우 기울임 + 산가지 잔진동.
  - 뽑기: 뽑힌 산가지가 **원래 x,z 자리에서 곧게 위로만 솟음**(`RISE_H=0.055`). 기울이지 않고 원래 부챗살 각도(rx, rz) 유지. 나머지와 나란히 서되 확실히 도드라짐.
  - done: 최종 솟은 위치를 명시적으로 고정 → 결과 화면에서도 솟은 채 유지.
- **번호판** — `gSantong.userData.label`(PlaneGeometry, CanvasTexture 64×256). `gSantong.userData.drawLabel(n)`(= `stDrawLabel`)이 한자 수를 세로로 그린다(`bold 30px "Iansui",serif`, b03bd7e 부터 서브셋에 一~十 이 있어 실제로 Iansui). `numHanja(n)`(1~64 → 한자, 十 단위). 뽑은 산가지 위쪽에 얹혀 카메라(+Z) 향함.

### 연결 지점
- `CAMS.santong = {pos:[0,0.055,0.235], look:[0,0.045,0]}`.
- buildUI 첫머리: `gSantong.visible=(screen==='santong'); if(screen!=='santong'&&stAnim){cancelAnimationFrame(stAnim);stAnim=null;}`
- 첫 화면 진입: `else if(k==='santong'){ setScreen('santong'); startSantong(); }`
- pointerdown: `if(screen==='santong'){ if(stMode==='idle'||stMode==='done') shakeSantong(); return; }`
- buildUI 분기: `} else if(screen==='santong'){` — 제목 "산통". 안내는 `stMode`별: idle "점상을 짚어 산통을 흔드십시오", shake "산가지가 나오는 중입니다", done 이면 verdict에 "제 n수 + 등급 + 첨시(yjnote 클래스)".

### 시행착오 (다시 밟지 말 것)
1. 중심을 축으로 옆으로 기울임 → 통 벽을 뚫음.
2. 통에서 완전히 빼서 기울임 → 화면 밖으로 사라짐.
3. 입구를 축으로 눕히기 → 은호당님: 위로 올라가 있고 갑자기 옆으로 기울어 어색함.
4. **현재(v1.1.1): 곧게 위로만 솟기** — 뽑힌 산가지가 원래 자리에서 수직으로 솟아 나머지와 나란히 섬. 카메라를 낮춰 통을 화면 중앙에. (은호당님 지시: "옆으로 하나가 뽑혀 수직으로 나란히 서는 연출")

## 엽전 (coin) / 오방기 (flag) / 요미산 (rice) — 초기 구현

세부는 `../../docs/법식과-화면.md` 참고(`../../CLAUDE.md`의 "화면과 법식" 절이 가리키는 곳). 요점:
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
