import UIKit
import AppTrackingTransparency
import GoogleMobileAds
import UserMessagingPlatform
import StoreKit

@MainActor
final class AdsConsentService {
    private weak var presenter: UIViewController?
    private let gate: NativePresentationGate
    private let pauseGame: @MainActor () async -> Void
    private let resumeGame: @MainActor () -> Void
    private(set) var isBusy = false
    private var consentUpdated = false
    private var configured = false
    private var trackingAtConfiguration = ""
    private var generation = 0
    private var rewarded: (ad: RewardedAd, loaded: Date)?
    private var interstitial: (ad: InterstitialAd, loaded: Date)?
    private var rewardedLoad: Task<Void, Never>?
    private var interstitialLoad: Task<Void, Never>?
    private var presentation: AdPresentation?
    private var lastInterstitialClosedAt: Date?
    private static var sdkStart: Task<Void, Never>?

    init(presenter: UIViewController, gate: NativePresentationGate, pauseGame: @escaping @MainActor () async -> Void, resumeGame: @escaping @MainActor () -> Void) {
        self.presenter = presenter
        self.gate = gate
        self.pauseGame = pauseGame
        self.resumeGame = resumeGame
    }

    static var trackingStatus: String {
        switch ATTrackingManager.trackingAuthorizationStatus {
        case .authorized: return "authorized"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "not_determined"
        @unknown default: return "not_determined"
        }
    }

    var privacyStatus: [String: Any] {
        let requirement = ConsentInformation.shared.privacyOptionsRequirementStatus
        let value = requirement == .required ? "required" : requirement == .notRequired ? "not_required" : "unknown"
        return ["requirement": value, "canRequestAds": requestsAllowed]
    }

    private var requestsAllowed: Bool {
        configured && ConsentInformation.shared.canRequestAds && trackingAtConfiguration == Self.trackingStatus
    }

    private var canPresent: Bool {
        guard let presenter = presenter else { return false }
        return UIApplication.shared.applicationState == .active && presenter.viewIfLoaded?.window != nil &&
            presenter.presentedViewController == nil && !presenter.isBeingDismissed
    }

    private func unitID(_ key: String) -> String? {
        guard let value = Bundle.main.object(forInfoDictionaryKey: key) as? String,
              value.range(of: #"^ca-app-pub-[0-9]{16}/[0-9]{10}$"#, options: .regularExpression) != nil else { return nil }
        #if !DEBUG
        guard !value.hasPrefix("ca-app-pub-3940256099942544/") else { return nil }
        #endif
        return value
    }

    private var hasValidAppID: Bool {
        guard let value = Bundle.main.object(forInfoDictionaryKey: "GADApplicationIdentifier") as? String,
              value.range(of: #"^ca-app-pub-[0-9]{16}~[0-9]{10}$"#, options: .regularExpression) != nil else { return false }
        #if !DEBUG
        guard !value.hasPrefix("ca-app-pub-3940256099942544~") else { return false }
        #endif
        return true
    }

    private func invalidateAds() {
        configured = false
        generation += 1
        rewarded = nil
        interstitial = nil
        // SDK requests cannot be cancelled. Generation checks discard their late responses.
        rewardedLoad = nil
        interstitialLoad = nil
    }

    private func isFresh(_ date: Date) -> Bool {
        let age = Date().timeIntervalSince(date)
        return age >= 0 && age < 55 * 60
    }

    private func waitForActivePresenter() async -> Bool {
        for _ in 0..<30 {
            if canPresent { return true }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return false
    }

    private func updateConsent() async -> Bool {
        // No invented age classification or device identifiers. Audience policy is a release prerequisite.
        let parameters = RequestParameters()
        #if DEBUG
        let environment = ProcessInfo.processInfo.environment
        let identifiers = (environment["BUS_FEVER_UMP_TEST_DEVICE_IDS"] ?? "").split(separator: ",").map(String.init)
            .filter { $0.range(of: #"^[a-fA-F0-9]{32}$"#, options: .regularExpression) != nil }
        if !identifiers.isEmpty || environment["BUS_FEVER_UMP_TEST_EEA"] == "1" {
            let debug = DebugSettings()
            debug.testDeviceIdentifiers = identifiers
            if environment["BUS_FEVER_UMP_TEST_EEA"] == "1" { debug.geography = .EEA }
            parameters.debugSettings = debug
        }
        #endif
        return await withCheckedContinuation { continuation in
            ConsentInformation.shared.requestConsentInfoUpdate(with: parameters) { error in
                continuation.resume(returning: error == nil)
            }
        }
    }

    private func gatherConsent() async -> Bool {
        guard let presenter = presenter, await waitForActivePresenter() else { return false }
        do { try await ConsentForm.loadAndPresentIfRequired(from: presenter); return true }
        catch { return false }
    }

    // This app owns the ATT system request. Do not also enable a UMP IDFA explainer message.
    // ATT permission and UMP consent are independent; ATT approval never grants GDPR consent.
    private func requestATTIfNeeded() async -> Bool {
        guard ConsentInformation.shared.canRequestAds, Self.trackingStatus == "not_determined",
              await waitForActivePresenter() else { return false }
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            ATTrackingManager.requestTrackingAuthorization { _ in continuation.resume() }
        }
        return true
    }

    func configure() async -> [String: Any] {
        guard hasValidAppID else { return ["canRequestAds": false, "reason": "invalid_app_id"] }
        guard !isBusy, canPresent, let lease = gate.acquire() else { return ["canRequestAds": false, "reason": "busy_or_inactive"] }
        isBusy = true
        defer { isBusy = false; gate.release(lease); resumeGame() }
        invalidateAds()
        if !consentUpdated {
            consentUpdated = await updateConsent()
        }
        // A failed update does not infer consent from our own cache. Retry from the privacy entry.
        guard consentUpdated else { return ["canRequestAds": false, "reason": "consent_update_failed"] }
        await pauseGame()
        guard await gatherConsent(), ConsentInformation.shared.canRequestAds else {
            return ["canRequestAds": false, "reason": "consent_unavailable"]
        }
        let prompted = await requestATTIfNeeded()
        guard await waitForActivePresenter(), ConsentInformation.shared.canRequestAds else {
            return ["canRequestAds": false, "reason": "inactive"]
        }
        guard unitID("BusFeverRewardedAdUnitID") != nil, unitID("BusFeverInterstitialAdUnitID") != nil else {
            return ["canRequestAds": false, "reason": "invalid_ad_units"]
        }
        // SDK initialization/network latency must not keep the puzzle paused after all prompts close.
        resumeGame()
        if Self.sdkStart == nil {
            Self.sdkStart = Task { @MainActor in
                await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
                    MobileAds.shared.start { _ in continuation.resume() }
                }
            }
        }
        await Self.sdkStart?.value
        trackingAtConfiguration = Self.trackingStatus
        configured = true
        preload()
        return ["canRequestAds": requestsAllowed, "trackingStatus": Self.trackingStatus, "prompted": prompted]
    }

    func requestTrackingAuthorization() async -> [String: Any] {
        // Reuse the same serialized consent pipeline. JS cannot bypass consent or stack prompts.
        let result = await configure()
        return ["status": Self.trackingStatus, "prompted": result["prompted"] as? Bool ?? false]
    }

    func showPrivacyOptions() async -> [String: Any] {
        guard !isBusy, canPresent else { return ["presented": false, "canRequestAds": requestsAllowed, "reason": "busy_or_inactive"] }
        // Unknown/failed consent: user can explicitly retry setup without restarting the game.
        guard ConsentInformation.shared.privacyOptionsRequirementStatus == .required else {
            let result = await configure()
            return ["presented": false, "canRequestAds": result["canRequestAds"] as? Bool ?? false, "reason": "consent_refreshed"]
        }
        guard let presenter = presenter else { return ["presented": false, "canRequestAds": false] }
        guard let lease = gate.acquire() else { return ["presented": false, "canRequestAds": false, "reason": "busy"] }
        isBusy = true
        await pauseGame()
        defer { isBusy = false; gate.release(lease); resumeGame() }
        invalidateAds()
        do {
            try await ConsentForm.presentPrivacyOptionsForm(from: presenter)
        } catch {
            // Discard previous creatives even on failure; retrying is explicit.
            return ["presented": false, "canRequestAds": false, "reason": "form_unavailable"]
        }
        // Reconfiguration is explicit after closing the form; no new ads or ATT prompt here.
        return ["presented": true, "canRequestAds": false, "reason": "choices_updated"]
    }

    private func preload() {
        guard requestsAllowed else { return }
        let epoch = generation
        if rewarded == nil, rewardedLoad == nil, let id = unitID("BusFeverRewardedAdUnitID") {
            rewardedLoad = Task { @MainActor [weak self] in
                let ad = try? await RewardedAd.load(with: id, request: Request())
                guard let self = self, self.generation == epoch else { return }
                self.rewardedLoad = nil
                if self.requestsAllowed, let ad = ad { self.rewarded = (ad, Date()) }
            }
        }
        if interstitial == nil, interstitialLoad == nil, let id = unitID("BusFeverInterstitialAdUnitID") {
            interstitialLoad = Task { @MainActor [weak self] in
                // Only native verified, current non-consumable entitlements suppress automatic ads.
                let noAds = await Self.ownsNoAds()
                guard let self = self, self.generation == epoch, self.requestsAllowed else { return }
                if noAds { self.interstitialLoad = nil; return }
                let ad = try? await InterstitialAd.load(with: id, request: Request())
                guard self.generation == epoch else { return }
                self.interstitialLoad = nil
                if self.requestsAllowed, let ad = ad { self.interstitial = (ad, Date()) }
            }
        }
    }

    private static func ownsNoAds() async -> Bool {
        for await result in StoreKit.Transaction.currentEntitlements {
            guard case .verified(let transaction) = result, transaction.productType == .nonConsumable,
                  transaction.productID == "com.busfever.removeads",
                  transaction.revocationDate == nil, !transaction.isUpgraded else { continue }
            return true
        }
        return false
    }

    func showRewarded(placement: String) async -> [String: Any] {
        guard ["revive", "reward_boost"].contains(placement), !isBusy, canPresent, requestsAllowed,
              let presenter = presenter else { return ["completed": false] }
        guard let cached = rewarded, isFresh(cached.loaded) else {
            rewarded = nil; preload(); return ["completed": false, "reason": "not_ready"]
        }
        guard let lease = gate.acquire() else { return ["completed": false] }
        rewarded = nil
        isBusy = true
        await pauseGame()
        defer { presentation = nil; isBusy = false; gate.release(lease); resumeGame(); preload() }
        guard canPresent, requestsAllowed else { return ["completed": false] }
        do { try cached.ad.canPresent(from: presenter) }
        catch { return ["completed": false] }
        let session = AdPresentation(ad: cached.ad)
        presentation = session
        cached.ad.fullScreenContentDelegate = session
        return await session.run { cached.ad.present(from: presenter) { session.earnedReward() } }
    }

    func showInterstitial(placement: String) async -> [String: Any] {
        guard placement == "stage_clear", !isBusy, canPresent, requestsAllowed,
              let presenter = presenter else { return ["shown": false] }
        if let closed = lastInterstitialClosedAt, Date().timeIntervalSince(closed) < 60 {
            return ["shown": false, "reason": "cooldown"]
        }
        guard let lease = gate.acquire() else { return ["shown": false] }
        // Reserve the fullscreen slot before awaiting StoreKit or checkpointing.
        isBusy = true
        await pauseGame()
        defer { presentation = nil; isBusy = false; gate.release(lease); resumeGame(); preload() }
        if await Self.ownsNoAds() { interstitial = nil; return ["shown": false, "reason": "no_ads_entitlement"] }
        guard canPresent, requestsAllowed else { return ["shown": false] }
        guard let cached = interstitial, isFresh(cached.loaded) else {
            interstitial = nil; return ["shown": false, "reason": "not_ready"]
        }
        interstitial = nil
        do { try cached.ad.canPresent(from: presenter) }
        catch { return ["shown": false] }
        let session = AdPresentation(ad: cached.ad)
        presentation = session
        cached.ad.fullScreenContentDelegate = session
        let result = await session.run { cached.ad.present(from: presenter) }
        if result["shown"] as? Bool == true { lastInterstitialClosedAt = Date() }
        return result
    }
}

@MainActor
private final class AdPresentation: NSObject, FullScreenContentDelegate {
    private var ad: AnyObject?
    private var outcome = AdOutcomeState()
    private var reply: CheckedContinuation<[String: Any], Never>?

    init(ad: AnyObject) { self.ad = ad }
    func run(present: @MainActor () -> Void) async -> [String: Any] {
        await withCheckedContinuation { continuation in
            reply = continuation
            present()
        }
    }
    func earnedReward() { outcome.recordReward() }
    func adWillPresentFullScreenContent(_ ad: FullScreenPresentingAd) { outcome.recordPresentation() }
    func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) { finish(failed: false) }
    func ad(_ ad: FullScreenPresentingAd, didFailToPresentFullScreenContentWithError error: Error) { finish(failed: true) }
    private func finish(failed: Bool) {
        guard let result = outcome.finish(failed: failed) else { return }
        let continuation = reply
        reply = nil
        ad = nil
        continuation?.resume(returning: ["completed": result.completed, "shown": result.shown])
    }
}
