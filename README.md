# Bus Fever! Car Jam Escape

`Bus Fever! Car Jam Escape`는 Vertex AI 기획 세션을 바탕으로 정리한 continuation-ready 저장소입니다. Bus Jam, Car Jam, Color Sort 요소를 결합한 하이브리드 캐주얼 퍼즐을 HTML5에서 빠르게 검증하고, 이후 상용 레벨 엔진과 솔버/제너레이터로 확장하기 쉽도록 구성했습니다.

## 포함 내용

- `web-prototype/index.html`, `web-prototype/src`: 공유 규칙 엔진을 사용하는 버스 잼 프로토타입
- `docs/01_GDD_Core_Mechanics.md`: 코어 규칙 및 UX 요약
- `docs/02_Level_Balance_1_to_20.md`: 20레벨 수량·목표 시간·무작위 정책 결과
- `docs/03_Monetization_LiveOps.md`: 메타/수익화 구조
- `docs/04_iOS_Release_Handoff.md`: 맥에서 iOS 빌드 직전 연결할 브리지/IAP/광고 인계 문서
- `docs/05_AdMob_StoreKit_Mapping.md`: AdMob placement, StoreKit 상품 타입, 세이브 스키마 매핑
- `docs/06_iOS_Compliance_Risk_Checklist.md`: ATT, iCloud 세이브, StoreKit 2 로컬 검증 체크리스트
- `docs/07_iOS_Native_Bridge_Blueprint.md`: `Info.plist`, WKWebView, Swift 브리지 청사진
- `docs/08_App_Review_QA_Matrix.md`: App Review 직전 수동 QA 매트릭스
- `data/levels_seed.json`: 20레벨의 명시적 차량 배치와 승객 순서 (레벨 schemaVersion 2)
- `data/level-verification.json`: 부스터 없는 해답·실패 경로·고정 시드 무작위 플레이 기록
- `docs/10_Level_Verification.md`: 공유 솔버 검증 방법과 한계

## 빠른 시작

```bash
npm run dev
```

- 개발 서버는 `web-prototype/index.html`을 바로 확인할 수 있게 루트에서 서빙합니다.
- 정적 빌드는 아래 명령으로 생성합니다.

```bash
npm run build
```

- Phaser 3.80.1과 라이선스는 `web-prototype/vendor/phaser`에 포함되어 있습니다. 게임 자산을 CDN에서 받지 않으며, `check`와 `build`에도 네트워크가 필요하지 않습니다.
- 빌드 결과를 로컬에서 실행하려면 `npm run preview`를 사용합니다. HTML을 파일 탐색기에서 직접 열면 모듈/JSON 로딩이 제한될 수 있으므로 개발 서버 또는 번들을 제공하는 앱 호스트로 실행합니다.
- `npm run validate:offline`은 로컬 자산 참조와 Phaser 파일 체크섬을 검사합니다. `npm run validate:bundle`은 빌드 후 `dist`의 HTTP 자산 경로까지 검사합니다.
- 광고·구매·iCloud 같은 외부 서비스는 인터넷 연결과 실제 네이티브 연동이 필요합니다. 오프라인 대상은 기본 퍼즐 플레이와 로컬 저장입니다.

- 저장소 구조 점검은 아래 명령으로 실행합니다.

```bash
npm run check
```

- 레벨 시드/기믹 검증만 별도로 실행하려면 아래 명령을 사용합니다.

```bash
npm run validate:levels
```

20개 레벨을 실제 게임과 같은 규칙으로 풀고 해답을 재생합니다. `npm run generate:levels`는 결정적 생성 규칙으로 레벨과 검증 기록을 다시 작성합니다. 수작업 데이터 편집도 덮어쓰므로 생성 규칙을 수정할 때 사용합니다. 솔버는 순차 출차 정책이며 물음표의 내부 색을 알고 있습니다. 사람의 승률·초회 공정성은 별도 검증이 필요합니다.

## 개발 인계 문서

- `docs/DEV_QUICKSTART.md`: 다음 개발자/에이전트가 바로 이어서 작업하기 위한 실행 가이드
- `BACKLOG.md`: 우선순위 기준 후속 구현 작업 목록
- [오프라인 실행·플레이 안정화 검증 기록](docs/09_Offline_and_Gameplay_QA.md)
- [진행 중 퍼즐 저장·재개와 VIP/셔플 검증](docs/11_Resume_and_Boosters_QA.md)
- [무료 힌트와 물음표 색 정보 보호 검증](docs/12_Hints_and_Hidden_Colors_QA.md)
- [Swift 호스트·로컬 저장 구현과 Mac 빌드 인계](docs/13_iOS_Host_and_Local_Save.md)
- [UMP·ATT·AdMob 연결과 개인정보 설정·기기 QA](docs/14_iOS_Consent_and_Ads.md)
- [StoreKit 2 검증·원자적 구매 지급·환불과 Mac QA](docs/15_StoreKit_and_Purchase_Journal.md)
- [iCloud 백업·계정 변경·진행 충돌 선택과 Mac QA](docs/16_iCloud_Save_and_Conflicts.md)
- [장난감 버스·승객 보행/탑승 연출과 화면 검증](docs/17_Toy_Station_Presentation_QA.md)
- [Gemini에 전달할 다음 레벨 설계 요청문](docs/GEMINI_LEVEL_DESIGN_REQUEST.md)

## 디버그 상태 로그

- 브라우저 콘솔에서 `window.BusFeverDebug.snapshot()`으로 현재 상태 JSON을 얻을 수 있습니다.
- `window.BusFeverDebug.printSnapshot()`은 솔버/힌트용 요약 로그를 콘솔에 출력합니다.
- 웹 빌드는 네이티브 없이 로컬 저장과 게임 플레이를 제공합니다. 실제 브리지가 없으면 구매·광고 보상·ATT 승인을 성공으로 처리하지 않습니다.

## iOS 설정과 검증

- [iOS 호스트와 실행 순서](ios/README.md): Swift/WKWebView·loopback 서버·원자적 로컬 저장, Xcode 프로젝트와 설정.
- `npm run prepare:ios`: 정적 게임 빌드 후 Xcode가 포함할 `build/ios/WebBundle`과 해시 manifest 생성·검사. Mac에서 재실행 후 `ios/BusFever.xcodeproj`를 엽니다.
- `npm run validate:ios:host`: PBX 구문/참조·프로젝트 재생성 일치·브리지 action/capability 검사. Swift 컴파일/XCTest는 실행하지 않습니다.
- `npm run validate:platform`: 구매 검증·거래 재전달·저장·ATT·광고 실패 경로와 인라인 모듈 검사.
- `npm run validate:gameplay`: 부활 후 진행 가능성, 승객 수 보존, 광고 연타·취소·이전 판 응답 처리를 검사.
- `npm run validate:resume`: 196개 진행 지점 복원, VIP/셔플 후보 해답, 손상 데이터 거부·무차감을 검사. 진행 중 퍼즐은 Schema v3의 선택적 round 필드로 저장하며 미래 스키마를 감지하면 덮어쓰기를 차단합니다.
- `npm run validate:hints`: 40개 지점의 추천·호환 색 배치별 해답, 물음표 정답 변경 시 결과 불변, Worker 취소/타임아웃/오류를 검사. 힌트는 무료이며 전체 승객 배열을 사용하지만 미공개 차량의 실제 색 필드는 읽지 않습니다.
- `npm run validate:ios`: iOS 템플릿 검사. `npm run validate:ios:release`: 운영 광고 ID 검사(현재 자리표시자가 있어 실패).
- Swift 호스트, UMP·ATT·AdMob, StoreKit 2 검증·원자적 구매 지급, iCloud 기기별 백업·진행 선택 소스를 작성했습니다. Mac 컴파일·28개 XCTest·결제/광고/iCloud 기기 QA·운영 설정이 남아 Release/Archive를 차단합니다. 남은 출시 작업은 [인계 문서](docs/04_iOS_Release_Handoff.md)에 기록합니다.
