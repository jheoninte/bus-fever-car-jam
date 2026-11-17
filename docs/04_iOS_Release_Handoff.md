# iOS Release Handoff

현재 결과물은 HTML5 게임, Swift/WKWebView 호스트·로컬 저장, UMP/ATT·AdMob·StoreKit 2 구매 검증/원자적 지급·iCloud 백업/진행 선택 소스와 Xcode 프로젝트입니다. Windows 정적·JS 검사까지 완료했으며 Swift 컴파일/XCTest/기기 실행은 미검증입니다. Release/Archive는 차단되어 있으며 Mac에서 빌드만 하면 출시되는 상태가 아닙니다.

## 준비된 부분

- Schema v3 저장과 기존 `bus_fever_save_v2` 저장 키 호환.
- 네이티브 없는 환경에서도 로컬 게임 저장. 구매·광고·ATT 승인은 시뮬레이션하지 않음.
- StoreKit verified 거래만 네이티브 카탈로그로 지급. 비공개 원장/잔액을 원자 저장한 뒤 finish하고, 미완료 거래와 환불/권한 철회를 시작/재개/업데이트에서 재조회. [결제 인계와 한계](15_StoreKit_and_Purchase_Journal.md).
- iCloud는 기기별 KVS head·계정 경계·clock으로 백업하며 충돌 시 사용자가 경제 snapshot을 선택하고 구매 ID를 합침. 웹 timestamp 선택은 우회. 전송 접수와 원격 저장 완료를 구분. [정책/한계](16_iCloud_Save_and_Conflicts.md).
- Phaser를 로컬에 포함하고 원본 무결성·라이선스·빌드 자산 경로 검사. 부활 대기열을 결정적으로 복구하고 광고 중 입력과 이전 판의 응답을 차단. [검증 기록](09_Offline_and_Gameplay_QA.md).
- [iOS 템플릿](../ios/README.md), [네이티브 계약](07_iOS_Native_Bridge_Blueprint.md), [QA 시나리오](08_App_Review_QA_Matrix.md).
- 공유 엔진·순차 솔버·20개 명시적 레벨과 한국어 튜토리얼·기호 설정. 모든 레벨의 부스터 없는 해답을 재생 검증. [범위와 한계](10_Level_Verification.md).
- 해답이 검증된 셔플/VIP 후보에만 차감, 진행 중 퍼즐 복원과 미래 스키마 쓰기 차단. [검증/저장 정책](11_Resume_and_Boosters_QA.md).
- 무료 힌트와 차량 강조 표시, 물음표 실제 색 미사용, 호환 배치별 다음 수 검증과 로컬 Worker. [범위와 기기 검증 항목](12_Hints_and_Hidden_Colors_QA.md).
- Swift 호스트·원자적 로컬 저장·Xcode 앱/테스트 타깃·자산 패키징. [현재 상태와 Mac 명령](13_iOS_Host_and_Local_Save.md).
- UMP → ATT → 광고 초기화, SDK 보상/닫힘 콜백, 개인정보 선택 재열기, 고정 SPM 버전. [광고 구현과 Mac QA](14_iOS_Consent_and_Ads.md).

## 출시까지 남은 작업

1. 작성된 Swift 호스트를 Mac에서 컴파일·28개 XCTest·WKWebView 실기기 검증. StoreKit 정상/미검증/보류/중단 복구/환불을 StoreKit Testing과 Sandbox/TestFlight에서 확인.
2. 운영 Bundle ID, Apple 서명/iCloud 권한, App Store Connect 상품, AdMob 앱/광고 단위 입력.
3. UMP 메시지·대상 연령·광고 설정 확정과 iPhone 동의/광고 callback 검증. iCloud 계정 변경·외부 변경·두 기기 지연/충돌/재설치 QA.
4. iCloud 진행 선택에서 구매 원장 합집합·단일 잔액 사용·복구 파일을 확인. 서버 없는 미전송/동시 오프라인의 무손실 보장 한계, 8슬롯·80KiB 한도와 복구 관리/지원 UX 검토.
5. 20레벨의 사람 대상 난이도·숨겨진 색 공정성, VIP/셔플과 저장 재개의 실기기 조합 QA, WKWebView 로컬 자산 로딩, 레이아웃·성능 점검. 현재 해답 검증은 내부 색을 아는 순차 정책이며 사람의 승률을 뜻하지 않음.
6. 개인정보처리방침/지원 URL, 스토어 메타데이터, Privacy Manifest/데이터 공개, 광고 콘텐츠 등급을 실제 앱에 맞게 준비.
7. Mac/Xcode에서 컴파일, 실기기 Sandbox/TestFlight QA 실행. Windows 검증은 네이티브 동작과 App Review 통과를 보장하지 않음.
