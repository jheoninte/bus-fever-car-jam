# Bus Fever! Car Jam Escape

`Bus Fever! Car Jam Escape`는 Vertex AI 기획 세션을 바탕으로 정리한 continuation-ready 저장소입니다. Bus Jam, Car Jam, Color Sort 요소를 결합한 하이브리드 캐주얼 퍼즐을 HTML5에서 빠르게 검증하고, 이후 상용 레벨 엔진과 솔버/제너레이터로 확장하기 쉽도록 구성했습니다.

## 포함 내용

- `web-prototype/index.html`: 단일 파일 버스 잼 프로토타입
- `docs/01_GDD_Core_Mechanics.md`: 코어 규칙 및 UX 요약
- `docs/02_Level_Balance_1_to_20.md`: 초반 레벨 밸런스 메모
- `docs/03_Monetization_LiveOps.md`: 메타/수익화 구조
- `data/levels_seed.json`: 시드 레벨 예시 데이터
## 빠른 시작

```bash
npm install
npm run dev
```

- 개발 서버는 `web-prototype/index.html`을 바로 확인할 수 있게 루트에서 서빙합니다.
- 정적 빌드는 아래 명령으로 생성합니다.

```bash
npm run build
```

- 저장소 구조 점검은 아래 명령으로 실행합니다.

```bash
npm run check
```

## 개발 인계 문서

- `docs/DEV_QUICKSTART.md`: 다음 개발자/에이전트가 바로 이어서 작업하기 위한 실행 가이드
- `BACKLOG.md`: 우선순위 기준 후속 구현 작업 목록

