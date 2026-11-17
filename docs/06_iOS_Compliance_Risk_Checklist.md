# iOS Compliance + Risk Checklist

## ATT / 개인정보

- 추적을 하는 경우 ATT를 요청합니다. AdMob 사용 자체가 모든 앱의 ATT 프롬프트를 의무화하는 것은 아닙니다.
- 실제 OS 상태를 조회하고 앱이 active이며 다른 동의 창이 없을 때만 요청합니다. denied/restricted면 재요청하지 않습니다.
- 허용에 대한 재화 보상이나 거부에 대한 게임 기능 제한을 두지 않습니다. 사용 목적 문구와 실제 SDK 데이터 처리가 일치해야 합니다.
- UMP와 ATT는 별도입니다. native initialize에서 광고 SDK를 먼저 시작하지 않고 configureAds가 동의 처리를 책임집니다.

## iCloud

- 같은 Apple 계정, iCloud 사용 설정, 올바른 entitlements가 필요하며 동기화는 지연되거나 실패할 수 있습니다. 재설치 복구를 보장한다고 안내하지 않습니다.
- `NSUbiquitousKeyValueStore.synchronize()` 반환값은 원격 업로드 완료가 아닙니다. 브리지는 `{queued:true}`만 반환합니다.
- 로컬 저장을 먼저 원자적으로 완료하고, KVS quota 및 외부 변경 알림을 처리합니다. 단일 값/전체 용량 제한을 고려해 거래 원장이 커지면 별도 영구 저장 전략이 필요합니다.
- [네이티브 iCloud](16_iCloud_Save_and_Conflicts.md)는 기기별 head와 vector clock을 쓰며 웹 timestamp 병합을 우회합니다. 외부 데이터를 진행 중인 판에 자동 덮어쓰지 않습니다. 계정 변경 후 명시적 재연결 전에는 업로드를 중단합니다.
- 동시 오프라인 경제는 명시적으로 snapshot 하나를 선택하고 구매 ID는 합칩니다. 잔액 무손실 합산을 보장하지 않으며 iCloud 미전송/지연·8슬롯/80KiB 한계가 있습니다. 재설치/계정/두 기기 QA와 복구 관리 UX가 남아 있습니다.

## StoreKit 2

- StoreKit이 검증한 `.verified(transaction)`만 사용합니다. 직접 JWS 문자열을 파싱한 것으로 검증을 대체하지 않습니다. `.unverified`, 상품/거래 ID 불일치, 환불·취소 거래를 거부합니다.
- 소모성은 구매 결과 및 unfinished/updates에서 복구합니다. currentEntitlements는 비소모성 권한 확인에 사용합니다.
- 보상과 거래 ID를 함께 영구 저장한 후 finish합니다. 중단 시 같은 ID를 다시 지급하지 않고 저장 확인 후 finish를 재시도합니다.
- [네이티브 카탈로그/비공개 원장](15_StoreKit_and_Purchase_Journal.md)이 상품/지급량과 원자 저장을 책임지고 웹 저장의 리비전/원장/영구 혜택 변경을 검사합니다. 파일 전체를 암호학적으로 봉인하지 않으며 탈옥·후킹 완전 차단을 보장할 수 없습니다.
- 앱 시작은 조용한 권한 조회, 사용자의 복원 버튼에만 AppStore.sync를 연결합니다. 업데이트 리스너와 완전히 검증된 currentEntitlements로 환불·권한 철회를 반영하는 소스가 있으며 Mac 기기 QA가 남아 있습니다.

이 문서는 심사 통과 보증이 아닙니다. 실제 구현, SDK 정책과 데이터 공개, 실기기 QA로 확인합니다.
