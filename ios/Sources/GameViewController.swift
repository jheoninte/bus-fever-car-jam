import UIKit
import WebKit

@MainActor
final class GameViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var server: LoopbackHTTPServer?
    private var bridge: NativeBridge?
    private var webView: WKWebView?
    private var entryURL: URL?
    private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    private var checkpointToken = UUID()
    private let recoveryView = UIStackView()
    private let messageLabel = UILabel()
    private let retryButton = UIButton(type: .system)
    private var startupID = UUID()
    private var servicePresented = false
    private var localStore: LocalSaveStore?
    private var purchases: StoreKitService?
    private var cloud: CloudSaveService?
    private let presentationGate = NativePresentationGate()
    private lazy var ads = AdsConsentService(presenter: self, gate: presentationGate,
        pauseGame: { [weak self] in await self?.pauseForService() },
        resumeGame: { [weak self] in self?.resumeFromService() })

    private func gameStore() throws -> LocalSaveStore {
        if let store = localStore { return store }
        let store = try LocalSaveStore.applicationStore()
        localStore = store
        return store
    }

    private func pauseForService() async {
        servicePresented = true
        guard let webView = webView else { return }
        _ = try? await webView.callAsyncJavaScript("return await window.BusFeverLifecycle?.checkpoint();", arguments: [:], in: nil, in: .page)
    }

    private func resumeFromService() {
        servicePresented = false
        resumeAfterBackground()
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 0.07, green: 0.09, blue: 0.15, alpha: 1)
        recoveryView.axis = .vertical
        recoveryView.spacing = 20
        recoveryView.alignment = .center
        recoveryView.translatesAutoresizingMaskIntoConstraints = false
        messageLabel.textColor = .white
        messageLabel.numberOfLines = 0
        messageLabel.textAlignment = .center
        retryButton.setTitle("다시 시도", for: .normal)
        retryButton.addTarget(self, action: #selector(startGame), for: .touchUpInside)
        recoveryView.addArrangedSubview(messageLabel)
        recoveryView.addArrangedSubview(retryButton)
        view.addSubview(recoveryView)
        NSLayoutConstraint.activate([
            recoveryView.centerXAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerXAnchor),
            recoveryView.centerYAnchor.constraint(equalTo: view.safeAreaLayoutGuide.centerYAnchor),
            recoveryView.widthAnchor.constraint(lessThanOrEqualToConstant: 310),
            recoveryView.leadingAnchor.constraint(greaterThanOrEqualTo: view.safeAreaLayoutGuide.leadingAnchor, constant: 24),
            retryButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])
        startGame()
    }

    @objc private func startGame() {
        startupID = UUID()
        let attempt = startupID
        server?.stop()
        server = nil
        endCheckpoint(token: checkpointToken)
        webView?.navigationDelegate = nil
        webView?.uiDelegate = nil
        webView?.stopLoading()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "busFeverNative", contentWorld: .page)
        webView?.removeFromSuperview()
        webView = nil
        bridge = nil
        entryURL = nil
        showMessage("게임을 불러오고 있어요…", retry: false)
        Task { @MainActor [weak self] in
            do {
                guard let store = try self?.gameStore() else { return }
                try await store.prepare()
                guard let root = Bundle.main.url(forResource: "WebBundle", withExtension: nil),
                      let bootstrapURL = Bundle.main.url(forResource: "bridge-bootstrap", withExtension: "js") else { throw HostError.invalidBundle }
                let bootstrap = try String(contentsOf: bootstrapURL, encoding: .utf8)
                let assets = try await Task.detached(priority: .userInitiated) { try BundleAssetStore(root: root) }.value
                guard let self = self, self.startupID == attempt else { return }
                let server = LoopbackHTTPServer(store: assets)
                self.server = server
                server.onFailure = { [weak self] in
                    guard let self = self, self.startupID == attempt else { return }
                    self.showMessage("게임 연결이 중단됐어요. 다시 시도하면 저장한 지점부터 이어갑니다.", retry: true)
                }
                server.start { [weak self] result in
                    guard let self = self, self.startupID == attempt else { return }
                    switch result {
                    case .success(let entry): self.installWebView(entry: entry, bootstrap: bootstrap, store: store)
                    case .failure: self.showMessage("게임을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.", retry: true)
                    }
                }
            } catch {
                guard let self = self, self.startupID == attempt else { return }
                self.showMessage("게임 파일이나 저장 데이터를 읽지 못했어요. 앱을 업데이트하거나 다시 시도해 주세요. 기존 저장은 유지됩니다.", retry: true)
            }
        }
    }

    private func installWebView(entry: URL, bootstrap: String, store: LocalSaveStore) {
        let controller = WKUserContentController()
        if purchases == nil {
            purchases = StoreKitService(store: store, gate: presentationGate,
                pauseGame: { [weak self] in await self?.pauseForService() },
                resumeGame: { [weak self] in self?.resumeFromService() },
                changed: { [weak self] in self?.notifyPurchasesChanged() })
        }
        guard let purchases = purchases else { return }
        if cloud == nil {
            let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            cloud = CloudSaveService(store: store, gate: presentationGate, presenter: self,
                identityURL: support.appendingPathComponent("BusFever/cloud-identity.json"),
                pauseGame: { [weak self] in await self?.pauseForService() },
                resumeGame: { [weak self] in self?.resumeFromService() },
                changed: { [weak self] in self?.notifyCloudChanged() })
        }
        guard let cloud = cloud else { return }
        let bridge = NativeBridge(store: store, ads: ads, purchases: purchases, cloud: cloud)
        controller.addScriptMessageHandler(bridge, contentWorld: .page, name: "busFeverNative")
        controller.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let config = WKWebViewConfiguration()
        // The loopback port and token change between launches. Native storage is authoritative.
        config.websiteDataStore = .nonPersistent()
        config.userContentController = controller
        config.preferences.javaScriptCanOpenWindowsAutomatically = false
        config.allowsInlineMediaPlayback = true
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = view.backgroundColor
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.translatesAutoresizingMaskIntoConstraints = false
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        view.insertSubview(webView, belowSubview: recoveryView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor), webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor), webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        self.bridge = bridge
        self.webView = webView
        self.entryURL = entry
        bridge.attach(to: webView, entryURL: entry)
        webView.load(URLRequest(url: entry))
    }

    private func showMessage(_ text: String, retry: Bool) {
        messageLabel.text = text
        retryButton.isHidden = !retry
        recoveryView.isHidden = false
        webView?.isHidden = true
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let entry = entryURL, navigationAction.targetFrame?.isMainFrame == true,
              NativeBridge.isGamePage(navigationAction.request.url, entry: entry) else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        recoveryView.isHidden = true
        webView.isHidden = false
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showMessage("ゲーム 화면을 불러오지 못했어요. 다시 시도해 주세요.", retry: true)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showMessage("게임 화면 로딩이 중단됐어요. 다시 시도해 주세요.", retry: true)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        showMessage("게임 화면이 종료됐어요. 다시 시도하면 저장한 지점부터 이어갑니다.", retry: true)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    func checkpointForBackground() {
        guard let webView = webView, backgroundTask == .invalid else { return }
        let token = UUID()
        checkpointToken = token
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "Puzzle checkpoint") { [weak self] in self?.endCheckpoint(token: token) }
        // Await the native save Promise, not only JS event dispatch. OS expiration remains authoritative.
        webView.callAsyncJavaScript("return await window.BusFeverLifecycle?.checkpoint();", arguments: [:], in: nil, in: .page) { [weak self] _ in
            self?.endCheckpoint(token: token)
        }
    }

    func resumeAfterBackground() {
        guard !servicePresented, UIApplication.shared.applicationState == .active else { return }
        webView?.evaluateJavaScript("window.BusFeverLifecycle?.resume();", completionHandler: nil)
    }

    private func notifyPurchasesChanged() {
        guard let entry = entryURL, let webView = webView, NativeBridge.isGamePage(webView.url, entry: entry) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new Event('busfever-purchases-changed'));", completionHandler: nil)
    }

    private func notifyCloudChanged() {
        guard let entry = entryURL, let webView = webView, NativeBridge.isGamePage(webView.url, entry: entry) else { return }
        webView.evaluateJavaScript("window.dispatchEvent(new Event('busfever-cloud-changed'));", completionHandler: nil)
    }

    private func endCheckpoint(token: UUID) {
        guard checkpointToken == token, backgroundTask != .invalid else { return }
        let task = backgroundTask
        backgroundTask = .invalid
        UIApplication.shared.endBackgroundTask(task)
    }
}
