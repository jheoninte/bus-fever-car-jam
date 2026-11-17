# iOS Native Bridge Contract

이 문서는 구현 계약입니다. 현재 Swift 호스트·로컬 저장·UMP/ATT·AdMob·StoreKit 2 연결 소스를 작성했으며 실제 SDK/기기 검증 완료를 뜻하지 않습니다. 설정과 JS bootstrap은 [ios 폴더](../ios/README.md), 광고 구현 범위는 [광고 인계](14_iOS_Consent_and_Ads.md), 결제는 [구매 원장 인계](15_StoreKit_and_Purchase_Journal.md)에 있습니다.

## 초기화

`WKScriptMessageHandlerWithReply`를 page content world의 `busFeverNative`로 등록하고 bootstrap을 `.atDocumentStart`, main-frame-only로 주입한 후 로컬 웹 번들을 로드합니다. 일반 WKScriptMessageHandler는 Promise 응답 계약을 만족하지 않습니다. 요청마다 정확히 한 번 reply하고 잘못된 action/인자를 오류로 거부합니다. 외부 프레임 및 탐색을 허용하지 않습니다.

`initialize`는 광고 SDK를 초기화하지 않습니다. 저장 로드·구매 복구 경로·게임 UI 설치 후 `configureAds`를 비동기로 호출합니다. 네이티브가 UMP 갱신 → 필요 폼 → ATT → Mobile Ads 초기화 순서를 직렬화합니다. 광고 네트워크 응답이 오프라인 퍼즐 시작을 막지 않습니다. 폼/ATT/광고 표시 중에는 퍼즐과 입력을 정지합니다.

현재 initialize는 로컬 저장·StoreKit 리스너·iCloud 계정/캐시 조회를 준비합니다. nativeAds·att·privacyOptions·nativeIap·nativePurchaseDelivery·restorePurchases·localReceiptValidation·cloudSave·nativeCloudSave는 true입니다. JS는 메서드 존재 여부와 이 응답을 함께 확인합니다. iCloud 미로그인/계정 변경/충돌은 별도 상태로 표시합니다. 광고 제거 여부도 네이티브 currentEntitlements의 verified 거래로 재확인합니다. 광고/동의/결제/사용자 복원/iCloud 선택은 하나의 네이티브 표시 lease를 공유합니다.

## Promise 메서드

| 메서드 | 결과와 책임 |
|---|---|
| `initialize()` | 준비 완료. SDK 오류를 숨겨 성공 처리하지 않음 |
| `loadSave(key)` | 로컬 영구 snapshot 또는 null |
| `saveSave(key,data)` | 일반 게임 snapshot 저장. nativePurchaseRevision 불일치·웹의 원장/영구 권한 변경을 거부; 구매 지급은 commitPurchase 전용 |
| `loadCloudSave(key)` | 현재 nativeCloudSave 경로는 null. 원시 백업은 웹의 timestamp 병합에 넣지 않음 |
| `syncCloudSave(key,data)` | `{queued:boolean}`. data 인자는 신뢰하지 않고 실제 네이티브 파일을 백업. 원격 내구성 보장 아님 |
| `getCloudSaveStatus()` | `{state,connected}`. 계정 토큰/비공개 원장은 노출하지 않음 |
| `manageCloudSave()` | 네이티브 계정 연결/진행 선택 후 `{changed,requiresReload,reason?}`. requiresReload이면 이전 화면 저장 없이 다시 로드 |
| `getTrackingAuthorizationStatus()` | authorized / denied / restricted / not_determined |
| `requestTrackingAuthorization()` | `{status,prompted:boolean}`. OS 상태를 반환; 미지원/비활성 시 가짜 승인 금지 |
| `configureAds()` | UMP 갱신/필요 폼 → ATT → SDK 초기화 후 `{canRequestAds,trackingStatus,prompted}`. 실패/중복/비활성에서는 false |
| `getPrivacyOptionsStatus()` | `{requirement:required/not_required/unknown,canRequestAds}` |
| `showPrivacyOptions()` | 사용자 입력으로만 호출. `{presented,canRequestAds,reason}`. 캐시 광고 폐기 후 필요 폼 표시, 선택 후 configureAds로 재확인 |
| `getProducts()` | `[{id,localizedPrice}]`, 실제 StoreKit 표시 가격 |
| `purchaseProduct(productId)` | verified 구매만 `{success:true,productId,transactionId}`. 취소/pending/실패는 `{success:false,status}` |
| `verifyTransaction(productId,transactionId)` | `{verified:true,productId,transactionId}`. 검증된 실제 거래를 찾아 ID·타입·철회 상태·앱 환경을 검사 |
| `getPendingTransactions()` | verified unfinished 및 현재 소유 중이지만 네이티브 원장에 없는 비소모성 거래를 `[{success:true,productId,transactionId}]`로 전달 |
| `commitPurchase(productId,transactionId)` | 네이티브 검증 캐시·권한을 재확인하고 보상/원장/리비전을 같은 파일에 저장 후 `{persisted:true,productId,transactionId,duplicate,snapshot}` |
| `getEntitlements()` | `{verified:true,productIds,snapshot}`. 완전한 검증 결과로 영구 권한 추가/제거; 검증 불완전 시 false, 저장이 없으면 snapshot은 null |
| `finishTransaction(transactionId)` | 지급이 영구 저장된 거래에만 finish 후 `{finished:true}` |
| `verifyProductOwnership(productId)` | 비소모성만 currentEntitlements로 확인해 `{verified,productId,transactionId}` |
| `restorePurchases({userInitiated})` | 네이티브는 `{success,productIds}`; JS 래퍼는 성공 시 비소모성 ID 배열로 정규화. true일 때만 AppStore.sync 호출 |
| `showRewardedAd(placement)` | 실제 reward callback 수신 뒤 광고가 닫혀야 `{completed:true}`, 중복/실패/미완료는 false |
| `showInterstitialAd(placement)` | 실제 표시 성공 후 `{shown:true}`. 광고 제거 권한 재확인 |
| `logEvent(name,payload)` | 허용된 비민감 이벤트만 처리, 오프라인 허용 |

## 거래 수명

StoreKit 2 `Product.purchase()`의 `.success` 안에서도 `.verified`만 채택합니다. 웹이 요청한 상품 ID와 transaction.productID를 비교하고, transaction.id를 문자열로 전달합니다. 소모성을 currentEntitlements에서 찾지 않습니다. 구매 반환 전에 finish하지 않습니다.

`initialize`부터 `Transaction.updates`를 구독하고 verified 거래를 메모리에 보관합니다. 지급 전에는 finish하지 않아 StoreKit의 unfinished가 재실행 복구 원본이 됩니다. 별도 앱 대기열을 영구 결제 증거로 사용하지 않습니다. 업데이트는 `busfever-purchases-changed` 이벤트를 보내고 JS가 안전한 시점에 재조회합니다. 시작/재개 때도 복구하며 거래 처리 중 이벤트는 합쳐서 다음 조회로 넘깁니다.

JS는 현재 판을 먼저 저장하고 commitPurchase를 직렬 호출합니다. 네이티브 PurchaseCatalog의 보상량만 사용해 잔액/공개 원장/비공개 `_nativeIAP` 원장/nativePurchaseRevision을 한 파일로 원자 교체합니다. JS는 응답의 경제 상태만 반영해 현재 판을 되감지 않고 finish를 요청합니다. finish는 비공개 원장에 기록된 검증 거래에만 허용합니다. 저장/commit 실패면 무지급·미finish이며 응답 유실 시 같은 commit을 한 번 재시도합니다. 오래된 리비전의 일반 저장은 거부합니다.

완전히 검증된 currentEntitlements 조회는 비소모성 권한 추가와 환불/철회에 따른 제거를 모두 반영합니다. 검증 실패를 빈 소유 목록으로 취급하지 않습니다. 기존 재화와 일회성 지급 원장은 삭제하지 않습니다. 스타터 재화는 새 구매/unfinished에서만 같은 원장 안에 한 번 지급하며 완료된 구매 복원은 영구 혜택만 반영합니다. 기기 간 원장은 [iCloud 정책](16_iCloud_Save_and_Conflicts.md)에 따라 보존합니다.

## iCloud

Swift가 KVS에 기기별 head를 Data로 저장하고 quota/외부 변경/계정 알림을 처리합니다. 로컬 writer별 clock으로 인과관계를 비교하며 동시에 갈라진 경제를 자동 합산하지 않습니다. 계정 변경 후 사용자 연결 전에는 업로드하지 않습니다. 진행 선택에서는 선택한 경제와 모든 관찰 구매 ID를 원자 저장하고 화면을 다시 로드합니다. 최대 8슬롯/80KiB payload와 계정/동시 오프라인 한계는 [iCloud 인계](16_iCloud_Save_and_Conflicts.md)를 따릅니다. 무손실 결제 전달 보장은 아니며 두 기기 QA가 출시 조건입니다.
