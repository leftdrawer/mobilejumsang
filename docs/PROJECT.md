# 휴대점상 (mobilejumsang) — 프로젝트 개요

> 이 문서는 앱(index.html) 개발자를 위한 진입점이다. 처음 이 저장소를 여는 사람(사람이든 AI든)은 여기부터 읽는다.
> 전체 협업 규약은 저장소 바깥 상위 문서 `../../README.md`, 블렌더 렌더 이력은 `../../docs/첫화면-렌더.md`, 법식은 `../../docs/법식과-화면.md`에 있다. `../../CLAUDE.md`는 Claude 전용 규칙이고 위 문서들을 가리킨다.

## 한 줄 요약

무구(巫具)를 휴대전화에서 쓰는 점상(占床) 웹앱. 설치형 PWA. Three.js + Rapier 물리 엔진으로 3D 무구를 흔들고 던져 점을 친다.

- 배포 주소: https://leftdrawer.github.io/mobilejumsang/ (GitHub Pages)
- 저장소: https://github.com/leftdrawer/mobilejumsang.git
- 사용자: 은호당님 (부천 은호당, 이북·황해도 만연당 신줄의 박수무당). 호칭 "은호당님", 존댓말.

## 누가 무엇을 하나

이 프로젝트는 두 AI가 나눠 맡는다.

| 담당 | 영역 | 작업 위치 |
|------|------|-----------|
| **Kiro** | 앱 로직 (index.html 안의 앱 스크립트) | `repo/` 클론, `main` 브랜치 |
| **Claude** | 블렌더 실사 렌더, 에셋 제작, 물리 블록 초안 | `claude/` 클론, `claude/*` 브랜치 + `blender/` |

- **index.html은 Kiro만 편집한다.** Claude는 `blender/`와 자기 브랜치에서만 작업하고, 완성된 블록을 넘겨주면 Kiro가 머지한다.
- 상위 작업 폴더 구조 (`c:\AI Projects\mobilejumsang\`):
  - `repo/` — Kiro 클론 (이 폴더)
  - `claude/` — Claude 클론
  - `blender/` — 블렌더 장면 파일·렌더 결과 (Claude 영역)
  - `README.md` — 상위 폴더 문서 입구 (꼭 지킬 것, 문서 고치는 규칙)
  - `docs/` — 법식과-화면, 개발-안내, 첫화면-렌더(블렌더 판별 이력), 할일
  - `CLAUDE.md` — Claude 전용 작업 규칙

## 저장소 구성 (repo/)

파일 7개가 전부다.

- `index.html` (약 6.27MB, 약 6,080줄, CRLF·BOM 없음) — 앱 전체. Three.js·Rapier IIFE 번들 + 앱 스크립트 + 모든 에셋(base64 인라인).
- `manifest.webmanifest` — standalone, orientation portrait.
- `sw.js` — 서비스 워커. 캐시 우선 + 뒤에서 새 판 받기(stale-while-revalidate). 뒤에서 받은 index.html 이 캐시본과 다르면(SHA-256) 열린 화면에 알린다. 캐시 이름 `hyudae-jeomsang` 고정.
- `icon-*.png` (4개) — 홈 화면 아이콘 (은호당님 제작).
- `docs/` — 이 문서 폴더.

새 판은 올린 뒤 **두 번째로 열 때** 보인다(서비스 워커 구조상 정상). 이를 보완해, 첫 번째로 열 때 뒤에서 받은 판이 다르면 첫 화면 아래에 "새 판을 받았습니다. 짚으면 바꿉니다" 알림이 뜨고, 짚으면 다시 열려 새 판이 나온다(684a464). 점을 치는 중·무구 화면·처음 설치·오프라인일 때는 뜨지 않고, 저절로 새로고침하지 않는다. 이 알림은 알림 기능이 든 sw.js 가 기기에 깔린 뒤에 올라온 판부터 보인다. 구조는 `APP_ARCHITECTURE.md` "새 판 알림".

## 무구와 점법 (구현된 것)

첫 화면은 블렌더 실사 렌더 이미지(`#homeimg`)이고, 무구 자리를 짚으면 해당 화면으로 넘어간다.

| 무구 | 화면 키 | 점법 | 담당 구현 |
|------|---------|------|-----------|
| 오방기 (旗) | `flag` | 기를 뽑아 색·신줄을 본다 | 초기(claude.ai) |
| 엽전 | `coin` | 상평통보 7닢을 던져 홀짝·앞뒤를 본다 | 초기 |
| 요미산 (쌀) | `rice` | 명주실/화상점으로 쌀알 수를 본다 | 초기 |
| 주역괘 | `yijing` | 육효 피젯을 돌려 64괘를 얻는다 | **Kiro** |
| 산통 (算筒) | `santong` | 통을 흔들어 산가지 하나를 뽑고 첨시를 본다 | **Kiro** (v1.1.0, 첨시·법식 감수 전) |

각 점법의 세부 법식·주의사항은 `../../docs/법식과-화면.md`에 있다(`../../CLAUDE.md`의 "화면과 법식" 절이 여기로 옮겼다). **법식·무속 관행은 짐작으로 채우지 않고 은호당님께 묻는다.**

## 버전 규칙

- 버전은 **한 곳**에서 고친다: `APP_VERSION` 상수 (index.html 앱 스크립트 안).
- `<div class="ver">` 표기는 JS가 `APP_VERSION`으로 덮어쓴다. 스크립트 실패 시 이 정적 값이 보이므로 **둘 다** 같이 올린다.
- 자리 규칙: 버그 수정 = 끝자리, 기능 추가 = 가운데, 정식 = 1.0. 현재 1.3.x 라인(배포된 판 v1.3.0). 지금 판은 `CHANGELOG.md` 맨 위 항목을 본다.
- 배포할 때마다 `CHANGELOG.md`에 항목을 추가한다.

## 작업 흐름 (매 변경마다)

1. index.html 수정 (정확한 문자열 치환).
2. 문법 검증 — 앱 스크립트를 떼어 `node --check` (아래 참고).
3. 로컬 확인 — `python -m http.server 8080` 띄우고 브라우저로 본다.
4. 은호당님 확인 (Kiro는 3D를 직접 못 보므로 스크린샷 의존).
5. 배포 시 `APP_VERSION`과 `.ver` 둘 다 올리고, `CHANGELOG.md` 갱신, 커밋·`git push origin main`.

## index.html 다룰 때 주의

- 에셋이 한 줄짜리 거대한 base64다. **파일을 통째로 출력하지 말 것.** 긴 줄(300자↑)을 걸러 본다.
- 앱 스크립트는 마지막 `(async function main()` ~ 다음 `</script>` 사이(네 번째 `<script>`). 맨 마지막 `<script>`는 서비스 워커 등록이다.
- 문법 검사: 그 범위를 `.mjs`로 떼어 `node --check`. `<script`/`</script>` 태그는 각 5개여야 한다.

```powershell
# repo\ 에서 실행
$raw=[System.IO.File]::ReadAllText("$PWD\index.html",[System.Text.Encoding]::UTF8)
$start=$raw.LastIndexOf("(async function main()")
$rest=$raw.Substring($start); $end=$rest.IndexOf("</script>")
$code=$rest.Substring(0,$end)
$out=Join-Path $env:TEMP "app_check.mjs"
[System.IO.File]::WriteAllText($out,$code,(New-Object System.Text.UTF8Encoding($false)))
node --check $out
```

- PowerShell 콘솔은 한글 UTF-8 표시가 깨진다(파일 자체는 정상). 내용 확인은 grep/read 도구가 정확하다.

## 관련 문서

- `CHANGELOG.md` — 버전·커밋 이력 (시간순).
- `APP_ARCHITECTURE.md` — index.html 앱 코드 구조 (상수·함수·화면별 구현 위치).
- `../../README.md` — 전체 협업 규약, 문서 안내.
- `../../docs/첫화면-렌더.md` — 블렌더 렌더 판별 이력(23~26판 = v1.2.1~v1.2.4 포함).
- `../../docs/법식과-화면.md` — 법식 세부.
