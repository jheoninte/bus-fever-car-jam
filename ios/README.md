# iOS 연결 파일

Swift/WKWebView 호스트, 로컬 저장, UMP/ATT·AdMob, StoreKit 2 구매 검증·원자적 지급, iCloud 백업/진행 선택 소스와 Xcode 프로젝트가 있습니다. Windows 정적/JS 검사와 웹 화면만 확인했으며 Swift 컴파일과 실제 iOS 실행은 미검증입니다. [호스트와 Mac 실행 순서](../docs/13_iOS_Host_and_Local_Save.md), [광고 QA](../docs/14_iOS_Consent_and_Ads.md), [결제 QA](../docs/15_StoreKit_and_Purchase_Journal.md), [iCloud 정책/한계와 두 기기 QA](../docs/16_iCloud_Save_and_Conflicts.md).

1. `npm run prepare:ios` 후 Mac에서 `BusFever.xcodeproj`를 엽니다. iOS 15 이상 앱/테스트 타깃과 Debug/Release xcconfig는 연결되어 있습니다. 실제 Bundle ID와 개발 팀을 지정합니다. 프로젝트를 재생성하려면 `npm run ios:project`를 사용하며 영구 변경은 생성 스크립트에 반영합니다.
2. `Config/Info.plist`를 타깃 Info.plist로 연결하고 `GENERATE_INFOPLIST_FILE = NO`로 설정합니다. `Config/BusFever.entitlements`를 Code Signing Entitlements로 지정하고 Apple Developer 및 Xcode에서 iCloud Key-value storage를 활성화합니다. 기존 출시 앱을 이전한다면 기존 kvstore 식별자를 보존합니다.
3. SPM에 Google Mobile Ads 13.13.0·UMP 3.1.0을 정확한 버전으로 연결했습니다. Mac에서 패키지를 Resolve합니다. 공식 quick-start의 SKAdNetwork 50개 항목을 반영했습니다. 별도 mediation 파트너는 추가하지 않았습니다. SDK manifest와 Xcode 통합 개인정보 보고서, App Store 공개를 점검합니다. AdMob의 지역별 개인정보 메시지를 설정하며 ATT 시스템 요청은 앱이 소유하므로 UMP IDFA 설명 메시지는 동시에 켜지 않습니다. 대상 연령/아동 정책은 출시 전에 확정해야 합니다.
4. `npm run prepare:ios`가 `build/ios/WebBundle`을 만들며 프로젝트는 folder reference로 포함합니다. 파일 계층·해시·MIME을 검사하고 loopback localhost URL로 제공해 모듈·JSON·Worker를 로드합니다. 이 명령은 네이티브 앱 빌드가 아니며 WKWebView/ATS/Worker의 실제 동작은 Mac에서 확인합니다.
5. 호스트가 `bridge-bootstrap.js`를 `.atDocumentStart`에 main-frame-only로 주입하고 `WKScriptMessageHandlerWithReply`를 `.page` world에 등록합니다. 웹 로드 전에 연결하며 출처·프레임·게임 URL을 확인합니다.
6. [브리지 계약](../docs/07_iOS_Native_Bridge_Blueprint.md)의 구매는 StoreKitService, iCloud는 CloudSaveService에 연결했습니다. cloudSave/nativeCloudSave는 활성 경로지만 원시 클라우드 snapshot은 웹에 전달하지 않습니다. 네이티브가 계정과 구매 원장을 검증하고 진행 선택을 담당합니다. capability는 기기 검증 완료 표시가 아닙니다.
7. `npm run validate:ios`로 ID 템플릿, `npm run validate:ios:host`로 프로젝트/계약을 검사합니다. 운영 설정·Mac 컴파일·28개 XCTest·서비스 기기 QA가 남아 Xcode Release/Archive 자체를 차단합니다. 향후 ID·최종 빌드 설정·실제 서비스 준비 상태 검사로 교체합니다.
8. [수동 QA](../docs/08_App_Review_QA_Matrix.md)를 Xcode StoreKit Testing, Sandbox 기기, TestFlight에서 실행합니다. 이 저장소에는 아직 Xcode `.storekit` 파일이 없습니다. Xcode에서 동일한 상품 ID로 구성 파일을 생성합니다.

Debug는 Google 공식 테스트 광고만 사용합니다. Release의 세 ID는 운영자 AdMob 콘솔에서 발급한 값으로 입력합니다. StoreKit 상품 ID는 테스트/운영에서 동일하며 테스트 환경은 Xcode Scheme 및 계정으로 구분합니다.
