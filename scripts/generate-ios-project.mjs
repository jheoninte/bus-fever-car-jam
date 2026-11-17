import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

// Deterministic PBX project generation: no XcodeGen, CocoaPods or npm dependency needed for the host.
const sources = ['AppDelegate', 'BundleAssetStore', 'LoopbackHTTPServer', 'PurchaseCatalog', 'CloudSavePolicy', 'LocalSaveStore', 'NativePresentationGate', 'AdOutcomeState', 'AdsConsentService', 'StoreKitService', 'CloudSaveService', 'NativeBridge', 'GameViewController'];
const tests = ['LocalSaveStoreTests', 'HostBoundaryTests', 'AdOutcomeStateTests', 'PurchaseJournalTests', 'CloudSaveTests'];
const records = [];
let counter = 0;
const id = () => (++counter).toString(16).toUpperCase().padStart(24, '0');
const quote = value => JSON.stringify(value);
const list = ids => ids.length ? `(${ids.join(', ')},)` : '()';
const object = (key, value) => { records.push(`\t\t${key} = { ${value} };`); return key; };
const project = id(), app = id(), test = id(), products = id();
const appProduct = object(id(), 'isa = PBXFileReference; explicitFileType = wrapper.application; path = BusFever.app; sourceTree = BUILT_PRODUCTS_DIR;');
const testProduct = object(id(), 'isa = PBXFileReference; explicitFileType = wrapper.cfbundle; path = BusFeverTests.xctest; sourceTree = BUILT_PRODUCTS_DIR;');
function file(path, type) { return object(id(), `isa = PBXFileReference; lastKnownFileType = ${type}; path = ${quote(path)}; sourceTree = SOURCE_ROOT;`); }
function build(fileRef) { return object(id(), `isa = PBXBuildFile; fileRef = ${fileRef};`); }
function phase(type, buildFiles) { return object(id(), `isa = ${type}; buildActionMask = 2147483647; files = ${list(buildFiles)}; runOnlyForDeploymentPostprocessing = 0;`); }
const sourceRefs = sources.map(name => file(`Sources/${name}.swift`, 'sourcecode.swift'));
const testRefs = tests.map(name => file(`Tests/${name}.swift`, 'sourcecode.swift'));
const debug = file('Config/Debug.xcconfig', 'text.xcconfig'), release = file('Config/Release.xcconfig', 'text.xcconfig');
const info = file('Config/Info.plist', 'text.plist.xml'), entitlements = file('Config/BusFever.entitlements', 'text.plist.entitlements');
const privacy = file('Config/PrivacyInfo.xcprivacy', 'text.xml');
const bundle = file('../build/ios/WebBundle', 'folder'), bootstrap = file('bridge-bootstrap.js', 'sourcecode.javascript');
const appSources = phase('PBXSourcesBuildPhase', sourceRefs.map(build));
const testSources = phase('PBXSourcesBuildPhase', testRefs.map(build));
const resources = phase('PBXResourcesBuildPhase', [bundle, bootstrap, privacy].map(build));
const sdkDefinitions = [
  ['https://github.com/googleads/swift-package-manager-google-mobile-ads.git', '13.13.0', 'GoogleMobileAds'],
  ['https://github.com/googleads/swift-package-manager-google-user-messaging-platform.git', '3.1.0', 'GoogleUserMessagingPlatform']
];
const packages = sdkDefinitions.map(([url, version]) => object(id(), `isa = XCRemoteSwiftPackageReference; repositoryURL = ${quote(url)}; requirement = { kind = exactVersion; version = ${quote(version)}; };`));
const sdkProducts = sdkDefinitions.map(([, , name], index) => object(id(), `isa = XCSwiftPackageProductDependency; package = ${packages[index]}; productName = ${name};`));
const sdkBuilds = sdkProducts.map(product => object(id(), `isa = PBXBuildFile; productRef = ${product};`));
const frameworks = phase('PBXFrameworksBuildPhase', sdkBuilds), testFrameworks = phase('PBXFrameworksBuildPhase', []);
const releaseGuard = object(id(), `isa = PBXShellScriptBuildPhase; buildActionMask = 2147483647; files = (); inputPaths = (); outputPaths = (); alwaysOutOfDate = 1; name = "Check Release Readiness"; runOnlyForDeploymentPostprocessing = 0; shellPath = /bin/sh; shellScript = ${quote('if [ "$CONFIGURATION" = "Release" ]; then\n  echo "error: Release is blocked: iCloud/StoreKit/ads compilation and device verification, privacy and release configuration remain incomplete." >&2\n  exit 1\nfi\n')};`);
const proxy = object(id(), `isa = PBXContainerItemProxy; containerPortal = ${project}; proxyType = 1; remoteGlobalIDString = ${app}; remoteInfo = BusFever;`);
const dependency = object(id(), `isa = PBXTargetDependency; target = ${app}; targetProxy = ${proxy};`);
function configuration(name, settings, base) {
  return object(id(), `isa = XCBuildConfiguration; ${base ? `baseConfigurationReference = ${base};` : ''} buildSettings = { ${Object.entries(settings).map(([k, v]) => `${k} = ${quote(v)};`).join(' ')} }; name = ${name};`);
}
function configurations(items) { return object(id(), `isa = XCConfigurationList; buildConfigurations = ${list(items)}; defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;`); }
const common = { CLANG_ENABLE_MODULES: 'YES', SWIFT_VERSION: '5.0', SDKROOT: 'iphoneos', IPHONEOS_DEPLOYMENT_TARGET: '15.0', SWIFT_STRICT_CONCURRENCY: 'targeted', ENABLE_USER_SCRIPT_SANDBOXING: 'YES' };
const projectConfigs = configurations([
  configuration('Debug', { ...common, SWIFT_OPTIMIZATION_LEVEL: '-Onone', SWIFT_ACTIVE_COMPILATION_CONDITIONS: 'DEBUG $(inherited)', ENABLE_TESTABILITY: 'YES', DEBUG_INFORMATION_FORMAT: 'dwarf' }),
  configuration('Release', { ...common, SWIFT_OPTIMIZATION_LEVEL: '-O', DEBUG_INFORMATION_FORMAT: 'dwarf-with-dsym', SWIFT_COMPILATION_MODE: 'wholemodule' })
]);
const appSettings = { PRODUCT_NAME: '$(TARGET_NAME)', PRODUCT_BUNDLE_IDENTIFIER: 'com.busfever.carjam', GENERATE_INFOPLIST_FILE: 'NO', INFOPLIST_FILE: 'Config/Info.plist', CODE_SIGN_ENTITLEMENTS: 'Config/BusFever.entitlements', CODE_SIGN_STYLE: 'Automatic', TARGETED_DEVICE_FAMILY: '1', SUPPORTED_PLATFORMS: 'iphoneos iphonesimulator', SUPPORTS_MACCATALYST: 'NO' };
appSettings.OTHER_LDFLAGS = '$(inherited) -ObjC';
const appConfigs = configurations([configuration('Debug', appSettings, debug), configuration('Release', appSettings, release)]);
const testSettings = { PRODUCT_NAME: '$(TARGET_NAME)', PRODUCT_BUNDLE_IDENTIFIER: 'com.busfever.carjam.tests', GENERATE_INFOPLIST_FILE: 'YES', TEST_HOST: '$(BUILT_PRODUCTS_DIR)/BusFever.app/BusFever', BUNDLE_LOADER: '$(TEST_HOST)', TARGETED_DEVICE_FAMILY: '1', CODE_SIGN_STYLE: 'Automatic' };
const testConfigs = configurations([configuration('Debug', testSettings), configuration('Release', testSettings)]);
object(app, `isa = PBXNativeTarget; buildConfigurationList = ${appConfigs}; buildPhases = ${list([releaseGuard, appSources, frameworks, resources])}; buildRules = (); dependencies = (); packageProductDependencies = ${list(sdkProducts)}; name = BusFever; productName = BusFever; productReference = ${appProduct}; productType = "com.apple.product-type.application";`);
object(test, `isa = PBXNativeTarget; buildConfigurationList = ${testConfigs}; buildPhases = ${list([testSources, testFrameworks])}; buildRules = (); dependencies = ${list([dependency])}; name = BusFeverTests; productName = BusFeverTests; productReference = ${testProduct}; productType = "com.apple.product-type.bundle.unit-test";`);
const group = (name, children) => object(id(), `isa = PBXGroup; name = ${quote(name)}; children = ${list(children)}; sourceTree = "<group>";`);
object(products, `isa = PBXGroup; name = Products; children = ${list([appProduct, testProduct])}; sourceTree = "<group>";`);
const mainGroup = group('BusFever', [group('Sources', sourceRefs), group('Tests', testRefs), group('Config', [debug, release, info, entitlements, privacy]), group('Resources', [bundle, bootstrap]), products]);
object(project, `isa = PBXProject; attributes = { BuildIndependentTargetsInParallel = YES; LastUpgradeCheck = 1600; }; buildConfigurationList = ${projectConfigs}; compatibilityVersion = "Xcode 14.0"; developmentRegion = ko; hasScannedForEncodings = 0; knownRegions = (ko, en, Base); mainGroup = ${mainGroup}; productRefGroup = ${products}; packageReferences = ${list(packages)}; projectDirPath = ""; projectRoot = ""; targets = ${list([app, test])};`);
const pbx = `// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {};\n\tobjectVersion = 56;\n\tobjects = {\n${records.join('\n')}\n\t};\n\trootObject = ${project};\n}\n`;
const ref = (target, name, product) => `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${target}" BuildableName="${product}" BlueprintName="${name}" ReferencedContainer="container:BusFever.xcodeproj"/>`;
const scheme = `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="1600" version="1.3">
  <BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${ref(app, 'BusFever', 'BusFever.app')}</BuildActionEntry></BuildActionEntries></BuildAction>
  <TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO">${ref(test, 'BusFeverTests', 'BusFeverTests.xctest')}</TestableReference></Testables></TestAction>
  <LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" debugServiceExtension="internal" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0">${ref(app, 'BusFever', 'BusFever.app')}</BuildableProductRunnable></LaunchAction>
  <ProfileAction buildConfiguration="Release" shouldUseLaunchSchemeArgsEnv="YES" savedToolIdentifier="" useCustomWorkingDirectory="NO" debugDocumentVersioning="YES"><BuildableProductRunnable runnableDebuggingMode="0">${ref(app, 'BusFever', 'BusFever.app')}</BuildableProductRunnable></ProfileAction>
  <AnalyzeAction buildConfiguration="Debug"/>
  <ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
`;
const outputs = [['ios/BusFever.xcodeproj/project.pbxproj', pbx], ['ios/BusFever.xcodeproj/xcshareddata/xcschemes/BusFever.xcscheme', scheme]];
for (const [relative, data] of outputs) {
  const url = new URL(`../${relative}`, import.meta.url);
  if (process.argv.includes('--check')) assert.equal(await readFile(url, 'utf8'), data, `Regenerate ${relative}`);
  else { await mkdir(new URL('./', url), { recursive: true }); await writeFile(url, data); }
}
console.log(`iOS project ${process.argv.includes('--check') ? 'reproducibility check passed' : 'generated'}. Xcode parsing/compilation requires macOS.`);
