# StoreKit 2 검증·구매 원장과 Mac 인계

2026-11-17. StoreKit 2를 호출하는 Swift 소스, 네이티브 원자적 지급, 복원/환불 경로를 작성했습니다. 후속 [iCloud 인계](16_iCloud_Save_and_Conflicts.md)에 백업/충돌 선택과 완료된 스타터 복원 보완을 추가했습니다. **Windows에서 JS 회귀·프로젝트 구조·웹 화면·자산 패키지만 검사했습니다. Swift 컴파일, 28개 XCTest, StoreKit Testing, Sandbox/TestFlight 결제는 아직 실행하지 않았습니다.**

## 검증과 상품

`StoreKitService.swift`는 Apple의 `VerificationResult.verified`만 채택합니다. StoreKit이 거래 JWS 서명을 검증하며 앱이 문자열을 디코딩하거나 웹의 성공 플래그를 신뢰해 검증을 대신하지 않습니다. 상품 allowlist, Bundle ID, 상품 타입, 구매 수량, revocationDate와 isUpgraded를 추가 확인합니다. Release의 iOS 16 이상에서는 production/sandbox만 허용하며 Xcode 환경 거래는 거부합니다. iOS 15에는 이 environment 속성이 없어 해당 추가 검사를 적용하지 않습니다.

| 상품 ID | 타입 | 네이티브 지급 |
| --- | --- | --- |
| `com.busfever.removeads` | 비소모성 | 강제 전면 광고 제거 |
| `com.busfever.starterbundle` | 비소모성 | 코인 600·셔플 5·VIP 3, 영구 보상 배율 |
| `com.busfever.coinpack.small` | 소모성 | 코인 1,200 × 구매 수량 |
| `com.busfever.coinpack.medium` | 소모성 | 코인 3,500 × 구매 수량 |

`PurchaseCatalog.swift`에 타입과 지급량을 고정했습니다. Node 검사가 웹 카탈로그와의 일치를 확인합니다. 가격은 Product.displayPrice만 사용하며 상품/가격 조회 실패 시 구매 버튼을 비활성화합니다. 플레이 UI 설치 이후 가격을 조회하므로 상품 네트워크가 퍼즐 시작을 막지 않습니다.

## 지급과 중단 복구

1. 웹에서 현재 판을 먼저 저장하고 결제 중 퍼즐/입력을 정지합니다. 광고·동의·결제·사용자 복원은 `NativePresentationGate`의 단일 lease를 공유합니다.
2. purchase 결과 및 Transaction.updates/unfinished의 verified 거래를 네이티브 메모리에 보관합니다. JS에는 상품 ID와 거래 ID만 전달합니다.
3. 웹은 일반 저장을 완료한 다음 commitPurchase를 호출합니다. 네이티브가 검증 캐시와 현재 비소모성 소유권을 재확인합니다.
4. LocalSaveStore actor가 카탈로그의 지급량, 공개 deliveredTransactions, 비공개 `_nativeIAP`, nativePurchaseRevision을 **동일한 save.json 원자 교체**로 저장합니다. 웹이 보상량이나 소유 목록을 지정할 수 없습니다.
5. 웹은 반환된 경제 상태만 반영합니다. 진행 중 stage/round를 되감지 않습니다. 네이티브 commit 응답이 유실돼 예외가 나면 같은 ID로 한 번 재시도합니다.
6. 검증 거래와 비공개 영구 원장이 모두 확인된 경우에만 finish합니다. 지급 전 실패/종료는 StoreKit unfinished로 재전달되며, 지급 후 finish 전 종료는 같은 거래를 추가 지급하지 않고 finish를 재시도합니다.

일반 웹 저장은 nativePurchaseRevision 불일치, 공개 원장 추가/삭제/상품 변경, 영구 혜택 조작, `_nativeIAP` 전달을 거부합니다. 비공개 원장은 loadSave 응답에서 제거합니다. 공개 레거시 원장만 존재하는 ID를 네이티브 지급 증거로 취급하지 않습니다. 저장 파일은 최대 512KiB이며 원장을 자동 삭제하거나 잘라내지 않습니다. 용량 초과/쓰기 실패는 거래를 미완료 상태로 남깁니다. 장기 원장 성장에 대한 저장 전략은 출시 전 추가 검토 대상입니다.

앱 초기화부터 업데이트를 관찰하며 `busfever-purchases-changed`, 시작, 포그라운드 복귀에서 구매를 재조회합니다. 웹은 안전한 시점까지 요청을 합쳐 처리합니다. Ask to Buy pending은 승인 전 지급하지 않습니다. StoreKit의 unfinished가 내구성 있는 대기 원본이며 메모리 캐시 자체를 영구 결제 증거로 사용하지 않습니다.

## 복원·환불과 남은 한계

완전히 검증된 currentEntitlements만 영구 권한의 기준으로 사용합니다. 빈 목록이면 혜택을 제거하고, 검증이 불완전하면 빈 소유권으로 오인해 제거하지 않습니다. removeads 철회는 전면 광고 제거를 해제하고 스타터 철회는 보상 배율과 소유 표시를 해제합니다. 이미 받은 재화와 거래 기록은 유지합니다. 소모성 환불에 따른 잔액 회수 정책은 구현하지 않았습니다.

자동 복구는 조용한 조회이며 **사용자가 구매 복원을 눌렀을 때만 AppStore.sync**를 호출합니다. 현재 소유 중인 비소모성 거래가 비공개 원장에 없으면 네이티브 commit 대상으로 전달합니다. 완료된 스타터 복원은 영구 혜택만 줍니다. 스타터의 일회성 재화는 새 구매 성공/unfinished이며 같은 원장에 지급 기록이 없을 때만 주므로 완료 복원이나 같은 원장의 환불/재구매에서 반복 획득하지 않습니다.

**iCloud 소스는 [별도 정책](16_iCloud_Save_and_Conflicts.md)으로 연결했습니다.** 원장을 포함한 기기별 백업과 명시적 진행 선택을 사용하며 웹의 timestamp 병합을 우회합니다. finish된 소모성은 StoreKit 복원만으로 잔액을 되살릴 수 없습니다. iCloud 지연/실패·앱 삭제 전 미전송과 서버 없는 동시 오프라인 플레이에는 무손실 보장 한계가 있습니다. 완료된 스타터 복원에는 재화를 주지 않지만 강제로 원장/미완료 거래 이력을 삭제하는 모든 경우의 중복 방지까지 보장하지는 않습니다.

StoreKit 서명 검증은 게임 파일 전체의 보안 경계가 아닙니다. 비공개 원장은 웹 API에서 숨긴 로컬 데이터이며 암호학적 봉인이나 탈옥/후킹의 완전한 차단을 제공하지 않습니다. 웹이 갱신하는 일반 플레이 잔액까지 서버 권위로 검증하지 않습니다. 이 구현을 크랙 방지 보증으로 안내하지 않습니다.

## 검증 기록과 Mac 순서

Windows에서 `npm run check`와 `npm run prepare:ios`를 통과했습니다. 검사에는 네이티브 지급 전용 경로, 저장/commit 실패 시 미finish, 거래 재전달, 상품 불일치, commit 응답 유실 재시도/저장 직렬화, 권한 철회와 현재 판 보존이 포함됩니다. 이 검사는 JS 모의 브리지 및 소스/프로젝트 구조 검사이며 실제 Swift 실행이 아닙니다. 현재 번들은 25개 자산입니다.

390×844 브라우저에서 상점의 iOS 구매 비활성화, iOS 전용 복원 안내, 코인 120 유지와 닫기를 확인했습니다. [상점 화면](qa/storekit-web-restore-390x844.jpg). 실제 네이티브 가격·결제 UI는 이 검사에 포함되지 않습니다.

Mac에서 다음을 실행합니다. 상품 4개를 위 ID/타입으로 Xcode StoreKit Configuration에 생성해 Debug Scheme에 연결합니다. 저장소에 `.storekit` 파일은 아직 없습니다. 실제 App Store Connect 가격/상품 현지화와 Sandbox 계정을 별도로 설정해야 합니다.

```bash
npm run check
npm run prepare:ios
xcodebuild -resolvePackageDependencies -project ios/BusFever.xcodeproj -scheme BusFever
open ios/BusFever.xcodeproj
```

[호스트 인계](13_iOS_Host_and_Local_Save.md)의 xcodebuild test 명령으로 현재 28개 XCTest를 실행합니다. 구매 원장 관련 9개는 원자적 지급/재실행 중복, 오래된 웹 저장 거부, 웹 원장/권한 위조 거부, 환불/재구매, 레거시 원장 구분, 잘못된 거래/미래 schema, 빈 소유권의 최초 revision, 표시 lease 배타성, 완료된 스타터 복원 무재화를 검사합니다. XCTest 통과와 실제 StoreKit 검증은 별도입니다.

| Mac/기기 시나리오 | 확인할 결과 |
| --- | --- |
| 컴파일·SPM resolve·28개 XCTest | Swift API/동시성 진단 및 네이티브 저장/표시 경계 확인 |
| 4상품·실제 현지화 가격·상품 조회 오류 | 타입/가격 일치, 조회 실패 시 판매 비활성화 |
| 정상·취소·pending/Ask to Buy·unverified | verified만 지급, 승인 업데이트 회수, 나머지 무지급 |
| 지급 전 종료·원자 저장 직후 finish 전 종료 | 재실행 후 누락/중복 없음, 동일 ID finish 재시도 |
| 잠금·쓰기 실패·용량 초과·미래 schema | 기존 저장 보존, 미finish, 복구 안내 |
| 복원 연타·네트워크 오류·다른 계정 | 사용자 동작에만 sync, 검증 실패를 소유권 없음으로 오인하지 않음 |
| 비소모성 환불·철회·재구매 | 영구 혜택 제거/복구, 같은 원장 안에서 스타터 재화 반복 지급 없음 |
| 결제 중 광고/동의 요청·홈 이동·WebContent 종료 | 창 중첩/오래된 화면 지급/재고 롤백 없음 |
| Sandbox·TestFlight | App Store 실제 서명/환경/상품/재전달 확인; Xcode 로컬 테스트와 구분 |
| 재설치·다른 기기·iCloud 계정 변경 | iCloud 인계의 두 기기/계정/지연/충돌 QA 별도 통과 필요 |

Release/Archive는 네이티브 컴파일·결제/광고/iCloud QA, 운영 ID·개인정보·연령 설정이 남아 계속 차단합니다.

## Apple 근거

- [VerificationResult](https://developer.apple.com/documentation/storekit/verificationresult), [Transaction](https://developer.apple.com/documentation/storekit/transaction)
- [unfinished](https://developer.apple.com/documentation/storekit/transaction/unfinished), [updates](https://developer.apple.com/documentation/storekit/transaction/updates), [currentEntitlements](https://developer.apple.com/documentation/storekit/transaction/currententitlements)
- [finish](https://developer.apple.com/documentation/storekit/transaction/finish()), [AppStore.sync](https://developer.apple.com/documentation/storekit/appstore/sync())
