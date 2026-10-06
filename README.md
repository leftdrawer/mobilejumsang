# 휴대점상 (mobilejumsang)

무구(巫具)를 휴대전화에서 쓰는 점상(占床) 웹앱. 설치형 PWA.
Three.js + Rapier 물리 엔진으로 3D 무구를 흔들고 던져 점을 친다.

- 배포: https://leftdrawer.github.io/mobilejumsang/ (GitHub Pages)

## 구조

- `index.html` — 앱 본체 (단일 파일 진입점)
- `sw.js` — 서비스 워커 (stale-while-revalidate 캐싱)
- `manifest.webmanifest` — PWA 매니페스트
- `docs/` — 프로젝트 문서 (`PROJECT.md` 개요, `APP_ARCHITECTURE.md`, `CHANGELOG.md`)
- `blender/` — 에셋 제작물 (해당 시)

## 개발 메모

- 처음 이 저장소를 여는 사람은 `docs/PROJECT.md`부터 읽을 것.
- `index.html`이 앱 로직의 단일 진입점이다.
