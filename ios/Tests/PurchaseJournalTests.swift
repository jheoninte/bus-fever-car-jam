import XCTest
@testable import BusFever

final class PurchaseJournalTests: XCTestCase {
    private func setup() async throws -> (URL, LocalSaveStore) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = LocalSaveStore(directory: directory)
        let snapshot: [String: Any] = ["schemaVersion": 3, "updatedAt": 100, "stage": 4, "score": 900,
            "shufflesLeft": 2, "vipLeft": 1, "round": ["version": 1, "stage": 4],
            "meta": ["coins": 120, "hasNoAds": false, "hasDoubleRewards": false,
                     "starterBundleOwned": false, "deliveredTransactions": [String: String]()]]
        try await store.save(JSONSerialization.data(withJSONObject: snapshot))
        return (directory, store)
    }

    private func object(_ data: Data) throws -> [String: Any] { try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any]) }
    private func coins(_ data: Data) throws -> Int {
        let snapshot = try object(data)
        return try XCTUnwrap((snapshot["meta"] as? [String: Any])?["coins"] as? Int)
    }

    private func load(_ store: LocalSaveStore) async throws -> Data {
        let data = try await store.load()
        return try XCTUnwrap(data)
    }

    func testAtomicGrantSurvivesRelaunchAndDuplicate() async throws {
        let (directory, store) = try await setup()
        defer { try? FileManager.default.removeItem(at: directory) }
        let purchase = VerifiedPurchase(transactionID: "1001", productID: "com.busfever.coinpack.small", quantity: 1)
        let first = try await store.commitPurchase(purchase, ownedProducts: [])
        XCTAssertFalse(first.duplicate)
        XCTAssertEqual(try coins(first.snapshot), 1320)
        XCTAssertNil(try object(first.snapshot)["_nativeIAP"])
        let disk = try object(Data(contentsOf: directory.appendingPathComponent("save.json")))
        XCTAssertNotNil(disk["_nativeIAP"])
        let relaunched = LocalSaveStore(directory: directory)
        let duplicate = try await relaunched.commitPurchase(purchase, ownedProducts: [])
        XCTAssertTrue(duplicate.duplicate)
        XCTAssertEqual(try coins(duplicate.snapshot), 1320)
        let delivered = try await relaunched.hasDelivered("1001", productID: purchase.productID)
        XCTAssertTrue(delivered)
    }

    func testOldWebSnapshotCannotEraseCommittedCurrency() async throws {
        let (directory, store) = try await setup()
        defer { try? FileManager.default.removeItem(at: directory) }
        let old = try await load(store)
        let result = try await store.commitPurchase(.init(transactionID: "1002", productID: "com.busfever.coinpack.medium", quantity: 1), ownedProducts: [])
        do { try await store.save(old); XCTFail("Stale purchase revision accepted") }
        catch SaveStoreError.stalePurchaseRevision { }
        let loaded = try await load(store)
        XCTAssertEqual(try coins(loaded), 3620)
        var valid = try object(result.snapshot)
        valid["score"] = 1200
        try await store.save(JSONSerialization.data(withJSONObject: valid))
    }

    func testWebCannotForgeLedgerOrPermanentPerks() async throws {
        let (directory, store) = try await setup()
        defer { try? FileManager.default.removeItem(at: directory) }
        let loaded = try await load(store)
        for field in ["hasNoAds", "hasDoubleRewards", "deliveredTransactions", "_nativeIAP"] {
            var snapshot = try object(loaded)
            var meta = try XCTUnwrap(snapshot["meta"] as? [String: Any])
            if field == "_nativeIAP" { snapshot[field] = ["version": 1] }
            else if field == "deliveredTransactions" { meta[field] = ["999": "com.busfever.coinpack.small"] }
            else { meta[field] = true }
            snapshot["meta"] = meta
            do { try await store.save(JSONSerialization.data(withJSONObject: snapshot)); XCTFail("Forged \(field) accepted") }
            catch SaveStoreError.invalidSnapshot { }
        }
    }

    func testRefundClearsPerksWithoutDeletingJournalOrCoins() async throws {
        let (directory, store) = try await setup()
        defer { try? FileManager.default.removeItem(at: directory) }
        _ = try await store.commitPurchase(.init(transactionID: "1003", productID: PurchaseCatalog.starter, quantity: 1), ownedProducts: [PurchaseCatalog.starter])
        let revokedData = try await store.reconcileEntitlements([])
        let revoked = try XCTUnwrap(revokedData)
        let meta = try XCTUnwrap(try object(revoked)["meta"] as? [String: Any])
        XCTAssertEqual(meta["starterBundleOwned"] as? Bool, false)
        XCTAssertEqual(meta["hasDoubleRewards"] as? Bool, false)
        XCTAssertEqual(try coins(revoked), 720)
        let restored = try await store.commitPurchase(.init(transactionID: "1004", productID: PurchaseCatalog.starter, quantity: 1), ownedProducts: [PurchaseCatalog.starter])
        XCTAssertEqual(try coins(restored.snapshot), 720, "Repurchase cannot farm starter consumables")
        XCTAssertEqual((try object(restored.snapshot)["meta"] as? [String: Any])?["starterBundleOwned"] as? Bool, true)
        let delivered = try await store.hasDelivered("1003", productID: PurchaseCatalog.starter)
        XCTAssertTrue(delivered)
    }

    func testLegacyPublicLedgerIsNotNativeDeliveryProof() async throws {
        let (directory, store) = try await setup()
        defer { try? FileManager.default.removeItem(at: directory) }
        let loaded = try await load(store)
        var snapshot = try object(loaded)
        var meta = try XCTUnwrap(snapshot["meta"] as? [String: Any])
        meta["deliveredTransactions"] = ["1005": "com.busfever.coinpack.small"]
        snapshot["meta"] = meta
        try JSONSerialization.data(withJSONObject: snapshot).write(to: directory.appendingPathComponent("save.json"))
        let delivered = try await store.hasDelivered("1005", productID: "com.busfever.coinpack.small")
        XCTAssertFalse(delivered)
    }

    func testInvalidPurchaseAndFutureSchemaNeverCommit() async throws {
        let (directory, store) = try await setup()
        defer { try? FileManager.default.removeItem(at: directory) }
        for purchase in [VerifiedPurchase(transactionID: "bad", productID: PurchaseCatalog.starter, quantity: 1),
                         .init(transactionID: "1006", productID: PurchaseCatalog.starter, quantity: 2),
                         .init(transactionID: "1007", productID: "unknown", quantity: 1)] {
            do { _ = try await store.commitPurchase(purchase, ownedProducts: []); XCTFail("Invalid purchase accepted") }
            catch { }
        }
        // A future snapshot is a deterministic non-writable case; no journal may be added to it.
        let future = Data("{\"schemaVersion\":99}".utf8)
        try future.write(to: directory.appendingPathComponent("save.json"))
        do { _ = try await store.commitPurchase(.init(transactionID: "1008", productID: "com.busfever.coinpack.small", quantity: 1), ownedProducts: []); XCTFail("Future save replaced") }
        catch SaveStoreError.futureSchema { }
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("save.json")), future)
    }

    func testEmptyEntitlementsInitializesNativeRevisionOnce() async throws {
        let (directory, store) = try await setup()
        defer { try? FileManager.default.removeItem(at: directory) }
        let first = try await store.reconcileEntitlements([])
        let firstSnapshot = try object(XCTUnwrap(first))
        XCTAssertEqual(firstSnapshot["nativePurchaseRevision"] as? Int, 1)
        let again = try await store.reconcileEntitlements([])
        let secondSnapshot = try object(XCTUnwrap(again))
        XCTAssertEqual(secondSnapshot["nativePurchaseRevision"] as? Int, 1)
    }

    func testFinishedRestoredStarterDoesNotMintConsumableBonus() async throws {
        let (directory, store) = try await setup()
        defer { try? FileManager.default.removeItem(at: directory) }
        let result = try await store.commitPurchase(.init(transactionID: "1009", productID: PurchaseCatalog.starter,
            quantity: 1, grantStarterContents: false), ownedProducts: [PurchaseCatalog.starter])
        XCTAssertEqual(try coins(result.snapshot), 120)
        let snapshot = try object(result.snapshot)
        XCTAssertEqual(snapshot["shufflesLeft"] as? Int, 2)
        XCTAssertEqual((snapshot["meta"] as? [String: Any])?["starterBundleOwned"] as? Bool, true)
        let delivered = try await store.hasDelivered("1009", productID: PurchaseCatalog.starter)
        XCTAssertTrue(delivered)
    }

    @MainActor
    func testPaymentAndAdsCannotHoldTheSamePresentationLease() {
        let gate = NativePresentationGate()
        guard let first = gate.acquire() else { return XCTFail("First presentation blocked") }
        XCTAssertNil(gate.acquire())
        gate.release(UUID())
        XCTAssertNil(gate.acquire(), "Unrelated completion released the presenter")
        gate.release(first)
        guard let second = gate.acquire() else { return XCTFail("Lease was not released") }
        gate.release(first)
        XCTAssertNil(gate.acquire(), "Late callback released a new presentation")
        gate.release(second)
        XCTAssertNotNil(gate.acquire())
    }
}
