# iOS 호스트·로컬 저장 구현과 Mac 인계

## 현재 상태 (2026-11-17)

Swift 호스트 소스와 Xcode 프로젝트를 작성했습니다. Windows에서 프로젝트 파일 구문/참조·브리지 계약·자산 패키지를 검사했으며, **Swift 컴파일·XCTest·WKWebView 실행은 아직 하지 않았습니다.** 이 PC에는 Swift/Xcode가 없습니다.

| 항목 | 작성한 내용 | 남은 확인 |
| --- | --- | --- |
| 앱 진입점 | UIKit AppDelegate와 게임 ViewController | Xcode 빌드·실행 |
| 웹 게임 로딩 | 앱 내부 loopback HTTP와 해시 검증 자산 | iPhone의 localhost/ATS/모듈/Worker |
| 브리지 | main-frame-only Promise bootstrap·요청 검증·전체 action 라우트 | WKWebView 메시지 왕복 |
| 로컬 저장 | actor 직렬화·원자적 파일 교체·미래/오래된 저장 거부·원장 삭제 방지 | 기기 강제 종료·잠금·용량 부족 |
| 백그라운드 | OS background task 안에서 JS의 네이티브 저장 Promise 대기 | 실제 OS 종료·시간 만료 |
| 광고 | UMP/ATT·AdMob SDK 연결 소스·SPM 의존성, [광고 인계](14_iOS_Consent_and_Ads.md) | Mac 컴파일·동의 메시지 설정·실기기 |
| IAP | StoreKit 2 검증·원자적 지급 원장·복원/철회, [결제 인계](15_StoreKit_and_Purchase_Journal.md) | Mac 컴파일·StoreKit/Sandbox 기기 QA |
| iCloud | KVS 기기별 head·계정 경계·clock·원장 보존·사용자 진행 선택, [인계](16_iCloud_Save_and_Conflicts.md) | Mac 컴파일·두 계정/두 기기·quota QA |
| ATT | UMP 후 활성 상태에서 OS 요청, 이미 결정된 상태는 재요청하지 않음 | iPhone 허용/거부/제한/창 중첩 QA |

## 실행 파일과 데이터

- `ios/Sources/AppDelegate.swift`: 창과 호스트 생성, 비활성화 시 체크포인트.
- `GameViewController.swift`: bootstrap 주입, 게임 화면만 탐색 허용, 팝업 차단, 오류/프로세스 종료 시 수동 재시도 화면.
- `BundleAssetStore.swift`: manifest의 경로·크기·MIME·SHA-256 확인 후 메모리 자산 맵 구성.
- `LoopbackHTTPServer.swift`: **127.0.0.1에만 바인딩**하며 게임 URL은 `http://localhost:<임의 포트>/<임의 세션 토큰>/web-prototype/index.html`입니다. NSAllowsLocalNetworking을 사용하고 전역 ATS 허용 예외는 두지 않습니다. GET/HEAD만 허용하고 소스/Worker/JSON에 맞는 MIME을 반환합니다. 요청 헤더 16KB·연결 24개·연결 시간 8초를 제한합니다.
- `NativeBridge.swift`: 연결된 WKWebView와 main frame, securityOrigin, 포트·세션 경로·정확한 게임 페이지, action·인자·payload 크기를 확인합니다. 응답은 요청마다 한 번입니다. 파일 경로는 웹이 정할 수 없습니다.
- `LocalSaveStore.swift`: Application Support/BusFever/save.json에 Schema v3 전체 snapshot을 저장합니다. 웹의 `bus_fever_save_v2` 키와 연결되며 인벤토리·round·거래 기록을 같은 파일로 원자 교체합니다. 최대 512KB, 정수 범위/기본 구조, 낮아진 updatedAt, 미래 schema, 기존 원장 항목 삭제/변경을 검사합니다. 파일 손상 시 자동 초기화하지 않습니다.

StoreKitService가 Apple `.verified` 거래만 받아 네이티브 PurchaseCatalog의 보상량으로 지급합니다. 같은 파일의 비공개 `_nativeIAP` 원장과 잔액을 함께 저장하고 공개 snapshot에서는 비공개 원장을 제거합니다. 일반 웹 저장은 nativePurchaseRevision 일치와 기존 원장/영구 권한을 확인합니다. 이 경로는 StoreKit 서명을 검증하지만 게임 저장 전체의 위변조나 탈옥을 완전히 막지는 않습니다. 자세한 범위와 복구 절차는 [결제 인계](15_StoreKit_and_Purchase_Journal.md)를 따릅니다.

웹뷰는 nonPersistent 데이터 저장소를 사용합니다. 임의 포트/토큰으로 바뀌는 웹 origin에 진행을 의존하지 않고 네이티브 파일이 다음 실행의 저장 원본이 됩니다. 앱 비활성화 시 `BusFeverLifecycle.checkpoint()`가 퍼즐 씬을 일시 정지하고 저장 Promise를 반환합니다. 호스트는 `callAsyncJavaScript`로 이를 기다리고 앱 활성화 때 씬을 재개합니다. OS의 background task 만료 이후 내구성은 보장하지 않습니다.

## 패키징

```bash
npm run check
npm run prepare:ios
```

`prepare:ios`는 정적 빌드를 검사한 뒤 `build/ios/WebBundle`을 재생성합니다. 게임 코드·디자인 CSS·Phaser/라이선스·레벨 JSON 28개 자산과 manifest를 포함합니다. 문서·Git 데이터·검증용 해답 리포트는 앱 자산에 넣지 않습니다. 패키지의 실제 파일 집합/해시와 현재 소스가 일치하는지 검사합니다. 이 명령은 iOS 앱 컴파일 명령이 아닙니다.

Xcode 프로젝트는 해당 폴더를 **folder reference**로 포함합니다. 프로젝트를 열기 전에 prepare:ios를 실행해야 합니다. 생성 폴더는 Git에서 제외하므로 Mac에 저장소를 가져가면 다시 생성합니다.

`npm run ios:project`는 dependency 없이 결정적인 PBX 프로젝트와 shared scheme을 다시 만듭니다. PBX/scheme을 직접 편집하면 재생성할 때 사라지므로 영구 변경은 `scripts/generate-ios-project.mjs` 또는 xcconfig에 반영합니다. 초기 Bundle ID는 `com.busfever.carjam`이며 실제 출시 식별자로 교체해야 합니다.

## Mac에서 최초 확인

현재 Xcode와 iOS Simulator가 설치된 Mac에서 다음을 실행합니다.

```bash
npm run check
npm run prepare:ios
open ios/BusFever.xcodeproj
xcodebuild -list -project ios/BusFever.xcodeproj
xcrun simctl list devices available
```

Xcode에서 BusFever scheme·Debug·사용 가능한 iPhone Simulator를 선택해 Run합니다. CLI 테스트는 실제 Simulator UUID를 넣어 실행합니다.

```bash
xcodebuild -project ios/BusFever.xcodeproj -scheme BusFever -configuration Debug \
  -destination 'platform=iOS Simulator,id=SIMULATOR_UDID' \
  -derivedDataPath build/DerivedData CODE_SIGNING_ALLOWED=NO test
```

28개 XCTest가 작성돼 있습니다. 저장/HTTP 경계 7개, 광고 콜백 4개, 구매 원장/리비전/환불/공유 표시 lease/완료된 스타터 복원 9개, iCloud clock/원장 병합/저장 경계 8개입니다. StoreKit/iCloud 네트워크를 모사하는 테스트는 아니며 Windows에서 실행된 테스트 수로 세지 않습니다.

실기기는 개발 팀·고유 Bundle ID·서명과 iCloud KVS 권한 설정이 필요합니다. 기본값은 iOS 15 이상·iPhone·세로 화면입니다. 앱 아이콘·iPad 정책·운영 SDK/스토어 설정은 아직 출시 준비 작업입니다.

## 수동 기기 QA

1. 인터넷이 없는 상태에서 첫 실행, 모듈/JSON/Phaser/힌트 Worker 로딩과 플레이.
2. 일부 탑승·셔플/VIP 직후·실패/부활·클리어 직후 비활성화 및 강제 종료, 재실행 후 round/재고/코인 일치.
3. 웹 콘텐츠 프로세스 종료 또는 로딩 실패 후 재시도, 이전 화면의 늦은 callback이 새 화면을 덮지 않음.
4. 손상/미래 저장 보존, 파일 보호/잠금·용량 부족에서 무지급/미finish, 같은 snapshot의 중복 반영 없음.
5. 외부 URL·iframe·팝업에서 브리지 호출 거부. localhost ATS 허용과 loopback 전용 바인딩 유지.
6. 상품이 로드돼야 실제 가격과 구매 버튼 활성화. [결제 QA](15_StoreKit_and_Purchase_Journal.md), [광고 QA](14_iOS_Consent_and_Ads.md), [iCloud 계정/진행 선택 QA](16_iCloud_Save_and_Conflicts.md)를 수행.

## 출시 차단과 다음 단계

Release/Archive는 Xcode의 **Check Release Readiness** 단계에서 의도적으로 차단합니다. 광고 개인정보/대상 연령·운영 설정과 StoreKit/광고/iCloud 네이티브 컴파일·기기 검증이 남아 있습니다. 운영 ID 검사도 별도로 통과해야 합니다. 확인을 마친 뒤 해당 차단을 실제 준비 상태 검사로 교체합니다.

PrivacyInfo.xcprivacy는 동의/ATT 후 조건부 광고 추적을 명시하며 SDK가 자체 수집 manifest를 포함합니다. 최종 Xcode 통합 보고서·App Store 데이터 공개는 별도로 검토해야 합니다. 서비스 소스의 작성 상태와 기기 검증 완료를 구분합니다.
