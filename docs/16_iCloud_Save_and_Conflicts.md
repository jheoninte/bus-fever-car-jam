# iCloud 백업·계정 경계·진행 선택

2026-11-17. NSUbiquitousKeyValueStore 연결 소스와 네이티브 진행 선택을 작성했습니다. **Windows에서는 JS/프로젝트/패키징 검사만 실행했습니다. Swift 컴파일·28개 XCTest·실제 iCloud 계정/두 기기 동기화는 Mac과 iPhone에서 검증해야 합니다.** Release/Archive 차단은 유지합니다.

## 저장과 전달

로컬 save.json이 플레이의 원본입니다. CloudSaveService가 JS 인자가 아닌 LocalSaveStore의 실제 디스크 snapshot을 읽어 iCloud KVS에 Data로 요청합니다. Schema v3, round, 재화/재고와 비공개 구매 원장을 함께 백업합니다. 원장 초기화 전 데이터는 업로드하지 않습니다. 클라우드의 영구 구매 플래그는 StoreKit의 서명된 권한 증거로 사용하지 않습니다.

기기마다 임의 writer UUID로 `busfever.cloud.v1.<UUID>` 키를 사용합니다. 서로 다른 기기의 백업이 같은 키를 덮지 않습니다. 로컬 `_nativeCloud`에는 writer별 변경 횟수를 담은 vector clock을 저장합니다. 일반 저장/구매/권한 변경과 clock은 같은 원자적 파일 교체로 반영합니다. 웹의 loadSave/구매 snapshot에서는 `_nativeCloud`와 `_nativeIAP`를 제거하며 일반 웹 저장으로 이 둘을 지정할 수 없습니다.

백업 요청은 활성 상태에서 최대 약 60초에 한 번으로 묶고 비활성 상태에서 저장할 때 즉시 시도합니다. 네트워크 완료를 기다리지 않으며 퍼즐은 오프라인에서도 실행합니다. `queued:true`와 “iCloud 백업 요청됨”은 KVS 로컬 캐시에 요청을 반영했다는 뜻입니다. **원격 서버 도착, 다른 기기 반영 또는 재설치 후 복구를 보장하지 않습니다.** synchronize 반환값을 업로드 완료 증거로 쓰지 않습니다. OS 지연/오프라인/강제 종료로 최근 변경이 클라우드에 없을 수 있습니다.

## 충돌과 복구

updatedAt으로 잔액을 고르지 않습니다. 한 clock이 다른 기기들의 이력을 모두 포함하는 경우에만 자기 백업 슬롯을 자동 갱신합니다. 아직 관찰하지 못한 다른 기기의 이력이 있으면 업로드를 보류하고 상점에 “iCloud 진행 선택 필요”를 표시합니다. 외부 변경 알림으로 진행 중인 퍼즐을 즉시 교체하지 않습니다.

상점의 iCloud 버튼은 네이티브 확인 창을 엽니다. 현재 기기와 인과적으로 최신인 백업들의 스테이지·코인·셔플·VIP를 보여 줍니다. 선택 시 다음 규칙을 적용합니다.

1. **선택한 snapshot 하나의 잔액과 round**를 사용합니다. 다른 진행의 남은 재화(구매한 재화 포함)는 합산하지 않는다고 적용 전에 안내합니다.
2. 관찰한 모든 snapshot의 구매 지급 ID·상품·수량을 합칩니다. 같은 ID의 내용이 다르면 전체 적용을 거부합니다. 이것은 중복 지급 방지용이며 iCloud 데이터를 결제 서명 증거로 취급하는 것이 아닙니다.
3. 모든 clock을 합치고 현재 writer를 증가시킵니다. 구매 리비전도 증가시켜 이전 웹 화면의 늦은 저장을 거부합니다. 다른 기기의 잘못된 시계가 저장을 막지 않도록 가져온 updatedAt은 현재 기기 시각으로 재설정합니다.
4. 영구 혜택은 일단 해제하고 재시작 후 StoreKit currentEntitlements로 다시 확인합니다. 선택 전에 로컬/관찰 백업 원본을 Application Support/BusFever/CloudRecovery 아래 UUID 폴더에 보관한 뒤 원자 교체합니다.
5. 화면을 다시 로드해 선택한 round를 복원합니다. 선택 창이 열린 동안 로컬 또는 원격 snapshot이 바뀌면 적용을 거부하고 재선택합니다.

빈 설치에서 KVS 캐시에 단일 최신 head가 이미 도착해 있으면 초기 웹 로드 전에 복구합니다. 설치 후 늦게 도착한 데이터는 자동 적용하지 않고 상점에서 선택합니다. 여러 head가 있으면 빈 설치에서도 사용자가 선택합니다. 같은 계정에서 구기기를 동기화한 후 새 기기의 백업을 선택하는 순서가 필요합니다.

복구용 파일은 자동 삭제하지 않습니다. 현재 게임 안에 과거 CloudRecovery 파일을 다시 선택하는 메뉴는 없습니다. Mac의 Xcode Devices and Simulators에서 앱 컨테이너를 다운로드해 지원/개발자가 보존본을 점검할 수 있습니다. 백업 슬롯 정리·복구 파일 관리 UX는 후속 출시 점검 항목입니다.

## 계정과 제한

계정 식별용 ubiquityIdentityToken은 **로컬 cloud-identity.json에만 보관**하고 JS, KVS, 로그로 보내지 않습니다. 이 파일은 OS 백업 제외 대상으로 지정해 기기 복원 시 writer 슬롯을 복제하지 않도록 했습니다. Apple의 opaque token을 비교하며 문자열이나 계정 이메일을 만들지 않습니다.

로그아웃 시 업로드를 멈춥니다. 저장된 토큰과 현재 계정이 다르면 자동 연결하지 않습니다. 사용자가 상점에서 현재 계정으로 진행을 연결한다는 안내를 확인해야 하며, 이후에도 진행 선택을 취소할 수 있습니다. 기존 오프라인 저장이 처음 iCloud에 연결될 때도 명시적인 연결이 필요합니다. 토큰 변경은 조회/선택 후와 KVS 쓰기 직전에 재확인합니다. 계정 전환 중 로컬 진행은 유지하며 다른 계정으로 자동 업로드하지 않습니다. iCloud 계정과 App Store 구매 계정은 별개이므로 결제 혜택은 항상 StoreKit에서 재확인합니다.

Apple KVS는 전체 1MiB/최대 1,024키 제한이 있습니다. 이 구현은 **최대 8기기 슬롯, raw snapshot 80KiB, 인코딩 record 112KiB, clock 16 writer**로 더 작게 제한합니다. 8기기 슬롯은 자동 삭제/재사용하지 않습니다. 9번째 기기나 큰 거래 원장에서는 백업이 중단되고 로컬 저장·구매 원장을 보존합니다. 파일/원장을 잘라서 성공 처리하지 않습니다. quota 알림, 잘못된 envelope/schema/원장, 충돌한 거래 사실은 동기화를 보류합니다.

서버 없는 동시 오프라인 경제를 자동으로 무손실 병합하지 않습니다. 다른 기기에서 아직 도착하지 않은 구매/소비를 알아낼 수 없으며 선택하지 않은 진행의 잔액을 자동 보상하지 않습니다. 로컬 파일/클라우드 경제 전체를 암호학적으로 봉인하지 않아 탈옥·후킹 완전 방어도 보장하지 않습니다. KVS는 보안 저장소가 아니므로 계정 토큰·원본 JWS·인증 정보·개인 연락처를 백업하지 않습니다.

## 스타터 복원 보완

이미 finish된 스타터 거래를 새 기기의 currentEntitlements에서 복원할 때는 **영구 혜택만 복원**합니다. 일회성 코인/부스터는 새 Product.purchase 성공 또는 검증된 unfinished 거래에만 지급하며 같은 원장에서는 한 번만 줍니다. 이 구분은 클라우드 도착 전에 완료된 구매가 복원돼 스타터 재화가 다시 생기는 것을 줄입니다. 로컬 지급 직후 클라우드 전송 전 삭제되거나 미완료 거래/원장이 강제로 삭제되는 모든 상황의 무손실 복구를 보장하지는 않습니다.

## 검사와 Mac QA

Windows: `npm run check`, `npm run prepare:ios` 통과. JS는 네이티브 cloud 경로에서 기존 timestamp merger 우회, capability 비활성 시 미호출, 상태 allowlist, 중복 관리 창/광고 중 차단, 예외 시 잠금 해제를 검사합니다. Swift 파일/프로젝트 참조도 검사하지만 **Swift 동작을 실행하는 검사는 아닙니다.**

390×844 브라우저에서 상점/닫기와 코인 120 유지를 확인했습니다. iOS 브리지가 없는 웹에서는 iCloud 관리 버튼을 숨깁니다. [웹 호환성 화면](qa/cloud-web-shop-390x844.jpg)은 네이티브 iCloud 확인 창이나 실제 동기화의 실행 증거가 아닙니다.

Swift XCTest는 기존 19개에 cloud clock/메타데이터 경계/선택과 원장 합집합/오래된 선택/잘못된 데이터/거래 충돌/용량/원장 초기화 전 백업 차단 8개, 완료된 스타터 복원의 무재화 지급 1개를 더해 28개 소스가 있습니다. 실행 명령은 [호스트 인계](13_iOS_Host_and_Local_Save.md)를 따릅니다.

| Mac/실기기 검사 | 기대 결과 |
| --- | --- |
| Debug 컴파일·28개 XCTest | Swift API/actor/동시성 진단과 네이티브 원자 저장 확인 |
| 같은 계정 두 iPhone, 온라인 순차 플레이 | 최신 백업 선택 후 round/재고/거래 ID 일치 |
| 두 기기 동시 오프라인 플레이/구매 | 양쪽 슬롯 보존, 무단 합산/덮어쓰기 없음, 명시적 진행 선택 |
| 새 설치에서 캐시가 먼저/늦게 도착 | 먼저 도착한 단일 head만 자동 복구, 늦은 데이터는 안전한 사용자 선택 |
| 로그아웃·다른 계정·선택 창 도중 전환 | 자동 업로드 중지, 원래 로컬 진행 보존, 재연결 확인 |
| 앱 잠금/종료·쓰기 실패·저장소 가득 참 | 기존 파일 보존, 잘못된 성공/finish/원장 삭제 없음 |
| quota/9번째 기기/큰 원장/미래 schema | 클라우드 중단과 안내, 로컬 데이터와 기존 백업 보존 |
| 다른 기기의 시계가 앞섬 | 가져온 진행을 현재 기기에서 계속 저장 가능 |
| 결제/광고/UMP와 선택 동시 요청 | 공유 표시 lease, 게임 입력/판 정지, 창 중첩 없음 |
| 선택 적용 직후 종료/재실행 | 원장·리비전·선택한 경제·round가 함께 복구 |
| 완료된 스타터 복원/미완료 스타터 승인 | 완료 복원은 영구 혜택만, 새/미완료 거래만 보너스 1회 |
| Device backup 복원·계정 연결·8슬롯 한도 | writer 복제 여부, 오래된 슬롯 처리와 지원 절차 검토 |

App Store 서명, 실제 팀의 KVS entitlement, iCloud 사용 설정, Sandbox/TestFlight의 서비스 조합을 확인해야 합니다. 창/백업/결제 QA가 끝나기 전 Release 차단을 해제하지 않습니다.

Apple 근거: [NSUbiquitousKeyValueStore](https://developer.apple.com/documentation/foundation/nsubiquitouskeyvaluestore), [외부 변경 알림](https://developer.apple.com/documentation/foundation/nsubiquitouskeyvaluestore/didchangeexternallynotification), [ubiquityIdentityToken](https://developer.apple.com/documentation/foundation/filemanager/ubiquityidentitytoken).
