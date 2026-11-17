# AdMob + StoreKit Mapping

## StoreKit 상품

| 상품 ID | 타입 | 지급 |
|---|---|---|
| `com.busfever.removeads` | Non-consumable | 자동 전면 광고 제거 |
| `com.busfever.starterbundle` | Non-consumable | 코인 600, 셔플 5, VIP 3, 보상 2배 |
| `com.busfever.coinpack.small` | Consumable | 코인 1200 |
| `com.busfever.coinpack.medium` | Consumable | 코인 3500 |

실제 가격 표시는 StoreKit Product.displayPrice를 브리지의 localizedPrice로 전달합니다. 상품/가격이 없으면 판매를 비활성화합니다. 소모성은 currentEntitlements/복원 목록에 넣지 않으며 구매 결과·미완료 거래를 검증하여 전달합니다. [네이티브 지급 원장](15_StoreKit_and_Purchase_Journal.md)과 [iCloud 보존/진행 선택](16_iCloud_Save_and_Conflicts.md) 소스가 있습니다. 완료된 스타터 복원은 영구 혜택만 주며 일회성 재화는 새/미완료 거래에서만 지급합니다.

## AdMob 배치

| placement | 형식 | 조건 | 광고 단위 설정 |
|---|---|---|---|
| `session_start` | 비활성 | 시작 직후 자동 광고 없음 | 없음 |
| `stage_clear` | Interstitial | 2회 클리어마다 후보, 광고 제거 시 차단 | `ADMOB_INTERSTITIAL_ID` |
| `revive` | Rewarded | 실패 후 사용자가 선택, 스테이지당 1회 | `ADMOB_REWARDED_ID` |
| `reward_boost` | Rewarded | 사용자가 보상 버튼 선택 | `ADMOB_REWARDED_ID` |

Debug 테스트 ID와 Release 자리표시자는 `ios/Config`에 분리되어 있습니다. 네이티브에서 placement 허용 목록과 광고 제거 권한을 다시 확인하고, 한 번에 한 광고만 표시합니다. SDK reward callback과 닫힘이 모두 확인돼야 완료를 반환하며 닫기만 함/no-fill/에러는 보상하지 않습니다. 광고를 준비하지 못하면 게임은 계속됩니다.

UMP 동의를 갱신하고 필요한 폼을 처리한 후 canRequestAds로 초기화/요청 여부를 결정합니다. ATT는 별도 추적 권한이며 거부가 광고 전체 금지를 뜻하지 않습니다. 비개인화·제한적 광고 가능 여부는 UMP, 연령 설정, SDK 정책까지 함께 적용합니다. 설정에서 개인정보 선택을 다시 열 진입점도 구현합니다.

## Schema v3

`schemaVersion`, `updatedAt`, `stage`, `score`, `shufflesLeft`, `vipLeft`, `meta`와 선택적 `round`를 저장합니다. `round`는 레벨 일치 확인·차량 상태·잔여 승객·부활 사용을 포함하는 진행 중 퍼즐입니다. `meta.deliveredTransactions`는 거래 ID → 상품 ID 기록이며 잔액과 같은 원자적 쓰기에 포함합니다. 기존 `lastCloudSyncAt` 필드는 호환용이며 원격 저장 완료 증거로 사용하지 않습니다. [저장 정책](11_Resume_and_Boosters_QA.md).

네이티브 저장에는 nativePurchaseRevision과 웹에 노출하지 않는 `_nativeIAP` 원장이 추가됩니다. 일반 웹 저장은 원장/영구 혜택을 변경할 수 없으며 구매 지급은 검증된 네이티브 commit 전용입니다. 클라우드 병합에는 이 원장의 별도 보존 전략이 필요합니다.
