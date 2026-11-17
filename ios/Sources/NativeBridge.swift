import Foundation
import WebKit

@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let store: LocalSaveStore
    private let ads: AdsConsentService
    private let purchases: StoreKitService
    private let cloud: CloudSaveService
    private weak var webView: WKWebView?
    private var entryURL: URL?

    init(store: LocalSaveStore, ads: AdsConsentService, purchases: StoreKitService, cloud: CloudSaveService) {
        self.store = store; self.ads = ads; self.purchases = purchases; self.cloud = cloud
    }

    func attach(to webView: WKWebView, entryURL: URL) {
        self.webView = webView
        self.entryURL = entryURL
    }

    static func isGamePage(_ url: URL?, entry: URL) -> Bool {
        guard let url = url else { return false }
        return url.scheme == "http" && url.host == "localhost" && url.port == entry.port &&
            url.path == entry.path && url.query == nil && url.fragment == nil && url.user == nil && url.password == nil
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let entry = entryURL, message.name == "busFeverNative", message.frameInfo.isMainFrame,
              let attached = webView, message.webView === attached,
              Self.isGamePage(attached.url, entry: entry), Self.isGamePage(message.frameInfo.request.url, entry: entry),
              message.frameInfo.securityOrigin.protocol == "http", message.frameInfo.securityOrigin.host == "localhost",
              message.frameInfo.securityOrigin.port == entry.port,
              let body = message.body as? [String: Any], let action = body["action"] as? String,
              let encoded = try? JSONSerialization.data(withJSONObject: body), encoded.count <= LocalSaveStore.maximumBytes + 4096 else {
            replyHandler(nil, "invalid_native_request")
            return
        }
        Task { @MainActor in
            do { replyHandler(try await self.route(action, body: body), nil) }
            catch SaveStoreError.futureSchema { replyHandler(nil, "future_save_schema") }
            catch SaveStoreError.staleSnapshot { replyHandler(nil, "stale_save_snapshot") }
            catch SaveStoreError.stalePurchaseRevision { replyHandler(nil, "stale_purchase_revision") }
            catch SaveStoreError.invalidSnapshot { replyHandler(nil, "invalid_save_snapshot") }
            catch { replyHandler(nil, "native_operation_failed") }
        }
    }

    private func requireKey(_ body: [String: Any]) throws {
        guard body["key"] as? String == NativeConstants.saveKey else { throw HostError.invalidRequest }
    }

    private func requireProduct(_ body: [String: Any]) throws -> String {
        guard let productID = body["productId"] as? String, NativeConstants.productIDs.contains(productID) else { throw HostError.invalidRequest }
        return productID
    }

    private func requireTransaction(_ body: [String: Any]) throws -> String {
        guard let transactionID = body["transactionId"] as? String, !transactionID.isEmpty,
              transactionID.count <= 64, transactionID.allSatisfy({ $0.isASCII && $0.isNumber }) else { throw HostError.invalidRequest }
        return transactionID
    }

    // Cloud records are read/applied by native code. JS cannot upload an arbitrary journal.
    private func route(_ action: String, body: [String: Any]) async throws -> Any {
        switch action {
        case "initialize":
            try await store.prepare()
            purchases.start()
            await cloud.start()
            return ["ready": true, "capabilities": ["nativeAds": true, "privacyOptions": true, "nativeIap": true,
                "nativePurchaseDelivery": true, "restorePurchases": true,
                "att": true, "cloudSave": true, "nativeCloudSave": true, "localReceiptValidation": true]] as [String: Any]
        case "loadSave":
            try requireKey(body)
            if let data = try await store.load() { return try JSONSerialization.jsonObject(with: data) }
            return NSNull()
        case "saveSave":
            try requireKey(body)
            guard let snapshot = body["data"] as? [String: Any] else { throw HostError.invalidRequest }
            let data = try JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys])
            try await store.save(data)
            _ = await cloud.localDidChange()
            return ["persisted": true]
        case "loadCloudSave":
            try requireKey(body)
            // Native startup may restore an empty install; never return a raw cloud record
            // to the legacy web timestamp merger. Live changes require explicit selection.
            return NSNull()
        case "syncCloudSave":
            try requireKey(body)
            return ["queued": await cloud.localDidChange(), "source": "native"] as [String: Any]
        case "getCloudSaveStatus":
            await cloud.refresh()
            return cloud.status
        case "manageCloudSave":
            return await cloud.manage()
        case "getTrackingAuthorizationStatus":
            return AdsConsentService.trackingStatus
        case "requestTrackingAuthorization":
            return await ads.requestTrackingAuthorization()
        case "configureAds":
            return await ads.configure()
        case "getPrivacyOptionsStatus":
            return ads.privacyStatus
        case "showPrivacyOptions":
            return await ads.showPrivacyOptions()
        case "getProducts":
            return try await purchases.getProducts()
        case "purchaseProduct":
            return await purchases.purchase(try requireProduct(body))
        case "verifyTransaction":
            return purchases.verify(productID: try requireProduct(body), transactionID: try requireTransaction(body))
        case "commitPurchase":
            let result = try await purchases.commit(productID: requireProduct(body), transactionID: requireTransaction(body))
            _ = await cloud.localDidChange()
            return result
        case "getEntitlements":
            let result = try await purchases.entitlements()
            _ = await cloud.localDidChange()
            return result
        case "verifyProductOwnership":
            return await purchases.verifyOwnership(try requireProduct(body))
        case "restorePurchases":
            guard let options = body["options"] as? [String: Any], let initiated = options["userInitiated"] as? Bool else { throw HostError.invalidRequest }
            return try await purchases.restore(userInitiated: initiated)
        case "getPendingTransactions":
            return try await purchases.pendingTransactions()
        case "finishTransaction":
            return try await purchases.finish(requireTransaction(body))
        case "showRewardedAd":
            guard let placement = body["placement"] as? String, ["revive", "reward_boost"].contains(placement) else { throw HostError.invalidRequest }
            return await ads.showRewarded(placement: placement)
        case "showInterstitialAd":
            guard body["placement"] as? String == "stage_clear" else { throw HostError.invalidRequest }
            return await ads.showInterstitial(placement: "stage_clear")
        case "logEvent":
            // No analytics SDK or network telemetry in the host foundation.
            return NSNull()
        default:
            throw HostError.invalidRequest
        }
    }
}
