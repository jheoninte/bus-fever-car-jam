import UIKit
import StoreKit

@MainActor
final class StoreKitService {
    private let store: LocalSaveStore
    private let gate: NativePresentationGate
    private let pauseGame: @MainActor () async -> Void
    private let resumeGame: @MainActor () -> Void
    private let changed: @MainActor () -> Void
    private var products: [String: Product] = [:]
    private var verified: [String: StoreKit.Transaction] = [:]
    private var starterContentEligible: Set<String> = []
    private var observer: Task<Void, Never>?

    init(store: LocalSaveStore, gate: NativePresentationGate, pauseGame: @escaping @MainActor () async -> Void,
         resumeGame: @escaping @MainActor () -> Void, changed: @escaping @MainActor () -> Void) {
        self.store = store
        self.gate = gate
        self.pauseGame = pauseGame
        self.resumeGame = resumeGame
        self.changed = changed
    }

    deinit { observer?.cancel() }

    func start() {
        guard observer == nil else { return }
        observer = Task { @MainActor [weak self] in
            for await result in StoreKit.Transaction.updates {
                guard !Task.isCancelled else { return }
                // Keep unfinished transactions in StoreKit until the native atomic grant is committed.
                // Revoked/unverified updates cannot be used to mint rewards.
                if let transaction = self?.accept(result) { self?.verified[String(transaction.id)] = transaction }
                else { self?.verified.removeAll() }
                self?.changed()
            }
        }
    }

    private func matchesCatalog(_ product: Product) -> Bool {
        guard let definition = PurchaseCatalog.products[product.id] else { return false }
        return definition.kind == .consumable ? product.type == .consumable : product.type == .nonConsumable
    }

    private func valid(_ transaction: StoreKit.Transaction) -> Bool {
        guard let definition = PurchaseCatalog.products[transaction.productID],
              transaction.appBundleID == Bundle.main.bundleIdentifier,
              transaction.revocationDate == nil, !transaction.isUpgraded,
              (1...100).contains(transaction.purchasedQuantity) else { return false }
        if definition.kind == .consumable {
            guard transaction.productType == .consumable else { return false }
        } else {
            guard transaction.productType == .nonConsumable, transaction.purchasedQuantity == 1 else { return false }
        }
        #if !DEBUG
        if #available(iOS 16.0, *) {
            guard transaction.environment == .production || transaction.environment == .sandbox else { return false }
        }
        #endif
        return true
    }

    private func accept(_ result: VerificationResult<StoreKit.Transaction>) -> StoreKit.Transaction? {
        // Apple's StoreKit verifier validates the signed JWS. Never use unsafePayloadValue,
        // a decoded client JWS, a JS success flag, or a transaction ID alone as proof.
        guard case .verified(let transaction) = result, valid(transaction) else { return nil }
        return transaction
    }

    private func response(_ transaction: StoreKit.Transaction) -> [String: Any] {
        ["success": true, "productId": transaction.productID, "transactionId": String(transaction.id)]
    }

    private func ownership() async -> (complete: Bool, transactions: [StoreKit.Transaction]) {
        var result: [StoreKit.Transaction] = []
        var complete = true
        for await verification in StoreKit.Transaction.currentEntitlements {
            // Incomplete verification is different from an authoritative empty entitlement set.
            guard case .verified(let raw) = verification else { complete = false; continue }
            guard PurchaseCatalog.products[raw.productID] != nil else { continue }
            guard let transaction = accept(verification), transaction.productType == .nonConsumable else { complete = false; continue }
            result.append(transaction)
            verified[String(transaction.id)] = transaction
        }
        return (complete, result)
    }

    func getProducts() async throws -> [[String: Any]] {
        let fetched = try await Product.products(for: Array(NativeConstants.productIDs))
        products = Dictionary(uniqueKeysWithValues: fetched.filter(matchesCatalog).map { ($0.id, $0) })
        return products.values.sorted { $0.id < $1.id }.map { ["id": $0.id, "localizedPrice": $0.displayPrice] }
    }

    func purchase(_ productID: String) async -> [String: Any] {
        guard UIApplication.shared.applicationState == .active, let lease = gate.acquire() else {
            return ["success": false, "status": "busy_or_inactive"]
        }
        await pauseGame()
        defer { gate.release(lease); resumeGame() }
        do {
            if products[productID] == nil { _ = try await getProducts() }
            guard UIApplication.shared.applicationState == .active, let product = products[productID], matchesCatalog(product) else {
                return ["success": false, "status": "product_unavailable"]
            }
            switch try await product.purchase() {
            case .success(let verification):
                guard let transaction = accept(verification), transaction.productID == productID else {
                    return ["success": false, "status": "unverified"]
                }
                verified[String(transaction.id)] = transaction
                starterContentEligible.insert(String(transaction.id))
                return response(transaction)
            case .userCancelled: return ["success": false, "status": "cancelled"]
            case .pending: return ["success": false, "status": "pending"]
            @unknown default: return ["success": false, "status": "unknown"]
            }
        } catch { return ["success": false, "status": "failed"] }
    }

    func verify(productID: String, transactionID: String) -> [String: Any] {
        guard let transaction = verified[transactionID], transaction.productID == productID, valid(transaction) else { return ["verified": false] }
        return ["verified": true, "productId": productID, "transactionId": transactionID]
    }

    func pendingTransactions() async throws -> [[String: Any]] {
        var pending: [String: StoreKit.Transaction] = [:]
        for await verification in StoreKit.Transaction.unfinished {
            guard let transaction = accept(verification) else { continue }
            let id = String(transaction.id)
            verified[id] = transaction
            starterContentEligible.insert(id)
            pending[id] = transaction
        }
        let owned = await ownership()
        if owned.complete {
            for transaction in owned.transactions {
                let id = String(transaction.id)
                let delivered = try await store.hasDelivered(id, productID: transaction.productID)
                if !delivered { pending[id] = transaction }
            }
        }
        return pending.values.sorted { $0.purchaseDate < $1.purchaseDate }.map(response)
    }

    func commit(productID: String, transactionID: String) async throws -> [String: Any] {
        guard let transaction = verified[transactionID], transaction.productID == productID, valid(transaction) else {
            return ["persisted": false, "reason": "unverified"]
        }
        let owned = await ownership()
        guard owned.complete else { return ["persisted": false, "reason": "ownership_unverified"] }
        if transaction.productType == .nonConsumable {
            guard owned.transactions.contains(where: { $0.id == transaction.id && $0.productID == productID }) else {
                return ["persisted": false, "reason": "ownership_revoked"]
            }
        }
        // Recheck after suspension: updates may have invalidated the cached verification.
        guard let current = verified[transactionID], current.productID == productID, valid(current) else { return ["persisted": false] }
        let result = try await store.commitPurchase(.init(transactionID: transactionID, productID: productID,
            quantity: current.purchasedQuantity, grantStarterContents: starterContentEligible.contains(transactionID)),
            ownedProducts: Set(owned.transactions.map(\.productID)))
        return ["persisted": true, "productId": productID, "transactionId": transactionID, "duplicate": result.duplicate,
                "snapshot": try JSONSerialization.jsonObject(with: result.snapshot)]
    }

    func finish(_ transactionID: String) async throws -> [String: Any] {
        guard let transaction = verified[transactionID], valid(transaction),
              try await store.hasDelivered(transactionID, productID: transaction.productID) else { return ["finished": false] }
        await transaction.finish()
        verified.removeValue(forKey: transactionID)
        starterContentEligible.remove(transactionID)
        return ["finished": true]
    }

    func entitlements() async throws -> [String: Any] {
        let owned = await ownership()
        guard owned.complete else { return ["verified": false] }
        let ids = Set(owned.transactions.map(\.productID))
        let data = try await store.reconcileEntitlements(ids)
        return ["verified": true, "productIds": ids.sorted(), "snapshot": try data.map { try JSONSerialization.jsonObject(with: $0) } ?? NSNull()]
    }

    func verifyOwnership(_ productID: String) async -> [String: Any] {
        guard PurchaseCatalog.products[productID]?.kind == .nonConsumable else { return ["verified": false] }
        let owned = await ownership()
        guard owned.complete, let transaction = owned.transactions.first(where: { $0.productID == productID }) else { return ["verified": false] }
        return ["verified": true, "productId": productID, "transactionId": String(transaction.id)]
    }

    func restore(userInitiated: Bool) async throws -> [String: Any] {
        if userInitiated {
            guard UIApplication.shared.applicationState == .active, let lease = gate.acquire() else {
                return ["success": false, "status": "busy_or_inactive"]
            }
            await pauseGame()
            defer { gate.release(lease); resumeGame() }
            try await AppStore.sync()
        }
        let owned = await ownership()
        return ["success": owned.complete, "productIds": owned.complete ? owned.transactions.map(\.productID).sorted() : []]
    }
}
