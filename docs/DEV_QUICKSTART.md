# DEV QUICKSTART

## 목표

- 차량 상태, 슬롯 상태, 레벨 시드를 분리해 레벨/솔버/메타 개발을 병렬로 진행할 수 있게 합니다.
- 현재 HTML5 검증본을 기준으로 후속 상용 엔진에서도 같은 JSON 시드를 재사용하도록 유지합니다.

## 실행

```bash
npm run dev
```

Node.js 18 이상이면 실행할 수 있습니다. Phaser 원본과 라이선스는 저장소에 포함되어 있으며 별도 설치나 네트워크 다운로드 없이 게임을 실행합니다. HTML 파일을 직접 열지 말고 로컬 서버 또는 WKWebView 번들 호스트를 사용합니다.

## 검증과 배포 파일

```bash
npm run check
npm run validate:bundle
npm run preview
```

`check`는 소스의 플랫폼·게임플레이·레벨 구조·오프라인 자산을 검사합니다. `validate:bundle`은 `dist`를 새로 만들고 빌드된 자산 경로를 검사합니다. `preview`는 그 결과를 로컬 HTTP로 제공합니다.

## 다음 개발 순서

1. 완성된 20레벨의 초회 플레이 시간·실패 원인·물음표 공정성을 측정해 난이도를 조정합니다.
2. 실제 기기에서 무료 힌트·Worker·저장/복원·부스터/광고 조합을 검증합니다. VIP/셔플 후보 해답, 중간 저장·재개, 사용자용 힌트는 구현되었습니다. [저장 QA](11_Resume_and_Boosters_QA.md), [힌트 QA와 한계](12_Hints_and_Hidden_Colors_QA.md).
3. 작성된 Swift/WKWebView 호스트를 `npm run prepare:ios`로 패키징해 Mac에서 컴파일·28개 XCTest·기기 검증합니다. [호스트 인계](13_iOS_Host_and_Local_Save.md). 광고·StoreKit 2·iCloud 소스가 있으며 [결제 인계](15_StoreKit_and_Purchase_Journal.md), [iCloud 진행 선택/계정 경계](16_iCloud_Save_and_Conflicts.md)를 따라 검증합니다. 운영 설정·개인정보/지원 화면과 출시 자료는 후속 작업입니다.

현재는 게임과 같은 JSON·규칙을 읽는 순차 솔버로 20개 레벨의 부스터 없는 해답을 재생 검증합니다. `npm run generate:levels`는 레벨과 검증 기록을 덮어씁니다. [레벨 검증 범위](10_Level_Verification.md)를 먼저 확인합니다.

현재 구현 상태와 남은 제약은 [BACKLOG](../BACKLOG.md), [오프라인/플레이 QA](09_Offline_and_Gameplay_QA.md), [iOS 인계](04_iOS_Release_Handoff.md)를 참고합니다.
