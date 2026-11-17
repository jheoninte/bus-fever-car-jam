# UMP·ATT·AdMob 구현과 검증 범위

2026-11-17. **실제 Google SDK를 호출하는 Swift 소스를 작성했습니다. Windows에서 Swift 컴파일·SDK 실행·XCTest·iPhone 광고 표시는 하지 않았습니다.** 앱 출시 완료나 심사 통과를 뜻하지 않습니다.

## SDK와 프로젝트

SPM exactVersion으로 Google Mobile Ads **13.13.0**, UMP **3.1.0**을 연결했습니다. 프로젝트 재생성 스크립트가 패키지·제품·링크 참조를 생성합니다. UMP 제품명은 `GoogleUserMessagingPlatform`, Swift 모듈은 `UserMessagingPlatform`입니다. GMA가 요구하는 UMP 범위 `1.1.0..<4.0.0` 안에 고정했습니다. 별도 mediation adapter는 없습니다. Mac 최초 Resolve와 Xcode의 실제 프로젝트 파싱은 미검증입니다.

공식 태그의 Package.swift와 배포 바이너리 헤더를 확인했으며, 다운로드한 아카이브의 SHA-256은 패키지 정의와 일치했습니다. SDK 바이너리 자체는 저장소/웹 번들에 넣지 않았습니다.

| SDK | 공식 바이너리 SHA-256 |
| --- | --- |
| GMA 13.13.0 | `9721b8258709181c07ccb886f1acb60d2675e56992f70ef0780161ef2cee555b` |
| UMP 3.1.0 | `90fe6bf3b0f4ce0d0199628c0871de58b6f673375148b98d52348aecc86db231` |

Debug는 Google 테스트 광고 단위, Release는 운영 ID 자리표시자입니다. 운영 빌드에서는 샘플 광고 단위를 거부합니다. 잘못된 앱 ID/광고 단위는 초기화 성공으로 반환하지 않습니다. `GADDelayAppMeasurementInit`를 설정하고 허용된 경로 전에는 Mobile Ads 시작/광고 요청을 호출하지 않습니다. Google 공식 quick-start의 SKAdNetwork **50개**를 대조·반영했습니다. SDK/파트너 변경 시 다시 확인해야 합니다.

## 동의·추적·개인정보 선택

게임 저장을 읽고 UI와 플레이를 시작한 뒤 광고 설정을 비동기로 요청합니다. UMP 정보 갱신 네트워크를 기다리는 동안 퍼즐 시작을 막지 않습니다. 폼/ATT 표시 전 체크포인트를 저장하고 씬·DOM 입력을 멈추며, 모든 창이 닫히고 앱이 활성화됐을 때 재개합니다. SDK 초기화 네트워크를 기다리는 동안에는 플레이를 재개합니다.

1. 매 앱 실행의 첫 설정에서 UMP `requestConsentInfoUpdate` 실행. 갱신 오류는 자체 저장값으로 동의를 추정하지 않고 광고를 비활성화합니다. 게임은 계속 가능하고 상점에서 다시 시도할 수 있습니다.
2. `loadAndPresentIfRequired` 완료와 `canRequestAds`를 확인합니다.
3. 앱이 활성 상태이고 다른 창이 없을 때 ATT가 `not_determined`이면 `ATTrackingManager.requestTrackingAuthorization`을 호출합니다. 이미 허용/거부/제한이면 재요청하지 않습니다. `prompted`는 OS 요청 API 호출 여부이며 실제 창 노출을 보장하는 계측값은 아닙니다.
4. UMP가 광고 요청을 허용하면 ATT 결과와 관계없이 SDK를 시작합니다. ATT 거부를 GDPR 동의나 광고 전체 거부로 해석하지 않으며 개인화 가능 여부를 직접 추정하지 않습니다. UMP 저장값과 OS 권한 처리는 SDK가 따릅니다. SDK 초기화는 프로세스 내 한 번입니다.

**ATT 시스템 요청은 이 앱이 소유합니다.** AdMob에서 GDPR/지역별 개인정보 메시지는 설정하되, UMP IDFA 설명 메시지를 동시에 켜지 않는 구성을 전제로 합니다. UMP가 ATT를 소유하는 방식으로 바꾸려면 이 앱의 직접 요청도 함께 변경해야 합니다.

상점에 네이티브 환경에서만 `광고 개인정보 설정/선택`을 표시합니다. requirement가 required이면 UMP privacy options 폼을 열고, unknown/not_required이면 설정을 다시 확인합니다. 폼을 열기 전에 기존 광고와 로딩 세대를 폐기합니다. 이후 이전 요청의 늦은 응답도 저장하지 않습니다. 선택이 바뀌면 새 상태로 재설정한 뒤 새 광고를 요청합니다. 폼 실패에서는 이전 광고를 복원하지 않습니다.

AdMob 콘솔의 실제 메시지·국가·법적 근거·대상 연령은 아직 확정하지 않았습니다. UMP의 기본 RequestParameters를 사용하며 자체 나이 확인/아동 분류를 만들지 않았습니다. **출시 전 대상 연령과 TFUA/COPPA/광고 콘텐츠 등급 정책을 확정하고 실제 설정·코드에 반영해야 합니다.** SDK manifest는 최종 App Store 데이터 공개를 대신하지 않습니다. 앱 manifest는 조건부 추적을 true로 바꿨으며, SDK 자체 manifest와 합쳐진 Xcode 개인정보 보고서를 검토해야 합니다. 앱이 자체 추적 도메인을 정의하거나 게임 로그를 서버로 전송하지는 않습니다.

## 광고 수명과 보상

- 보상형은 사용자가 선택한 `revive`/`reward_boost`만 허용합니다. 전면은 `stage_clear`만 허용하며 세션 시작 광고는 없습니다.
- 보상형·전면·동의·개인정보·결제·사용자 복원은 네이티브의 공유 표시 lease로 하나씩 처리합니다. 웹도 요청 중 다른 전면 요청과 입력을 차단합니다.
- 광고를 미리 받고 55분이 지났거나 기기 시계가 역행하면 폐기합니다. 준비되지 않았으면 즉시 실패/건너뛰고 다음 기회를 위해 로드합니다. 로딩 완료 뒤 이미 지나간 스테이지에 자동 표시하지 않습니다.
- `AdPresentation`이 광고와 continuation을 유지하고 SDK delegate를 받습니다. **SDK reward callback + 닫힘 callback** 조합에서만 `completed:true`를 한 번 반환합니다. 닫기만 함·표시 실패·중복/늦은 callback에서는 지급하지 않습니다. 별도 mediation이 없는 Google 광고의 reward-before-dismiss 순서를 전제로 합니다.
- 게임의 기존 거래 없는 보상 지급/round 확인/저장 경로가 실제 completed 결과를 받습니다. 서버가 없으므로 AdMob 서버측 보상 검증은 제공하지 않으며, 변조 기기의 완전한 방어를 보장하지 않습니다.
- 전면 광고는 JS의 두 번 클리어마다 시도 정책에 더해 네이티브에서 마지막 광고 닫힘 후 최소 60초를 둡니다. 네이티브가 StoreKit `currentEntitlements`의 **verified·미철회·비소모성 removeads**를 다시 확인해 자동 광고를 막습니다. 스타터 번들은 광고 제거 상품이 아닙니다. 보상형은 선택 시 사용 가능합니다.
- StoreKit 구매·환불 리스너·지급 원장 소스는 [결제 인계](15_StoreKit_and_Purchase_Journal.md)에 추가됐습니다. 실제 컴파일/구매/광고 제거 기기 검증은 남아 있습니다.

## Windows에서 확인한 항목

- `npm run check`: 기존 20레벨/부활/저장/힌트 회귀 검사와 광고·개인정보 브리지 동작 검사.
- 개인정보 변경 직후 광고 비활성화, 광고 중 개인정보 요청 차단, 중복 광고 차단, 명시적 재설정, malformed 응답 무지급, ATT denied 상태에서도 SDK의 광고 허용 결과 유지.
- PBX OpenStep 구문/참조, 두 exactVersion 패키지와 제품의 앱 타깃/링크 연결, 브리지 action 일치.
- `npm run prepare:ios`: 현재 게임 자산 25개 패키지·해시 검증. 네이티브 컴파일 명령은 아닙니다.
- 브라우저 390×844/390×667에서 상점 표시·작은 화면 스크롤 후 닫기 확인. SDK 없는 웹에서는 개인정보 메뉴를 숨기고 광고 버튼을 눌러도 코인 120·셔플 2·VIP 1이 유지되는 것을 확인했습니다. 네이티브 개인정보 버튼/UMP 폼은 이 브라우저 검사 대상이 아닙니다.
- 광고 XCTest 4개가 취소·중복·실패·늦은 보상을 검사합니다. 저장/HTTP 경계 7개, 구매 원장/표시 lease/완료 복원 9개, iCloud 저장 8개를 합쳐 현재 28개이며 **Windows에서는 실행하지 않았습니다.**

웹 상점 검증 화면: [390×844 캡처](qa/ads-shop-web-390x844.jpg).

## Mac에서 이어서 확인

```bash
npm run check
npm run prepare:ios
xcodebuild -resolvePackageDependencies -project ios/BusFever.xcodeproj -scheme BusFever
open ios/BusFever.xcodeproj
```

개발 팀/Bundle ID를 정하고 Debug로 컴파일합니다. XCTest 명령은 [호스트 인계](13_iOS_Host_and_Local_Save.md)에 있습니다. Swift 컴파일 오류·동시성 진단·패키지 리소스 포함 여부부터 확인합니다.

실제 UMP 메시지를 테스트할 때는 본인 AdMob 앱과 연결된 테스트용 앱 ID, Google 테스트 광고 단위를 사용합니다. Debug Scheme 환경변수 `BUS_FEVER_UMP_TEST_DEVICE_IDS`에 SDK 로그의 테스트 기기 해시(쉼표로 구분)를 넣고, `BUS_FEVER_UMP_TEST_EEA=1`로 EEA를 강제할 수 있습니다. Simulator는 UMP에서 기본 테스트 기기로 취급됩니다. 이 코드는 Release에 포함되지 않습니다. 동의 리셋 코드를 제품에 넣지는 않았습니다.

| iPhone 시나리오 | 기대 결과 |
| --- | --- |
| 첫 실행/재실행, EEA·그 외 지역 | UMP 갱신 매 실행, 필요한 폼만 표시, ATT/광고 창 중첩 없음 |
| ATT 허용/거부/제한/미결정 | OS 실제 상태 반영, 이미 결정한 권한 재요청 없음, 거부 후에도 게임 가능 |
| 초기 오프라인/UMP 오류/광고 no-fill | 게임 시작 가능, 광고 무지급, 개인정보 진입점에서 재시도 가능 |
| 광고 보기 취소·끝까지 보기·표시 실패·연타 | 취소/실패 무지급, SDK 보상+닫힘 후 정확히 1회 지급 |
| 전면/보상/UMP 중 홈 이동·잠금·광고 링크 왕복 | 퍼즐/입력/체크포인트 유지, 창이 남아 있을 때 자동 재개 없음 |
| 개인정보 재열기·선택 변경·폼 오류 | 캐시/이전 로드 폐기, 새 동의 상태로만 새 광고, 오류 시 미표시 |
| removeads 검증됨·없음·철회됨 | 광고 제거 권한을 네이티브에서 확인, 강제 전면만 억제, 60초 간격 유지 |
| 앱 재실행·WebContent 프로세스 종료/재시도 | 세션 중복 초기화·이전 화면 보상·겹친 광고 없음 |
| Release/Archive | 미완료 서비스/광고 설정/실기기 QA 때문에 현재는 의도적으로 실패 |

## 공식 근거

- [GMA quick-start / SKAdNetwork](https://developers.google.com/admob/ios/quick-start)
- [UMP consent / privacy options](https://developers.google.com/admob/ios/privacy)
- [Privacy strategies / ATT](https://developers.google.com/admob/ios/privacy/strategies)
- [Rewarded](https://developers.google.com/admob/ios/rewarded), [Interstitial](https://developers.google.com/admob/ios/interstitial)
- [데이터 공개 지침](https://developers.google.com/admob/ios/privacy/data-disclosure): 열람 당시 본문 기준은 13.12.0이므로 최종 13.13.0 SDK manifest와 함께 검토해야 합니다.
- [고정 GMA 패키지](https://github.com/googleads/swift-package-manager-google-mobile-ads/blob/13.13.0/Package.swift), [고정 UMP 패키지](https://github.com/googleads/swift-package-manager-google-user-messaging-platform/blob/3.1.0/Package.swift)
