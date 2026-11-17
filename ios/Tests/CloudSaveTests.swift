import XCTest
@testable import BusFever

final class CloudSaveTests: XCTestCase {
    private let writerA = "00000000-0000-4000-8000-000000000001"
    private let writerB = "00000000-0000-4000-8000-000000000002"

    private func makeStore(_ writer: String) async throws -> (URL, LocalSaveStore) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = LocalSaveStore(directory: directory)
        try await store.configureCloudWriter(writer)
        let data = try JSONSerialization.data(withJSONObject: ["schemaVersion": 3, "stage": 4, "score": 100,
            "updatedAt": 100, "shufflesLeft": 2, "vipLeft": 1,
            "round": ["stage": 4], "meta": ["coins": 120, "deliveredTransactions": [String: String]()]])
        try await store.save(data)
        _ = try await store.reconcileEntitlements([])
        return (directory, store)
    }

    private func exported(_ store: LocalSaveStore) async throws -> Data {
        let data = try await store.cloudExport()
        return try XCTUnwrap(data)
    }

    private func object(_ data: Data) throws -> [String: Any] {
        try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testConcurrentClocksRequireSelectionAndJoinDominatesBoth() throws {
        let a = CloudClock(counters: [writerA: 4])
        let b = CloudClock(counters: [writerB: 9])
        XCTAssertFalse(a.contains(b))
        XCTAssertFalse(b.contains(a))
        var joined = a
        try joined.join(b)
        try joined.tick(writerA)
        XCTAssertTrue(joined.contains(a))
        XCTAssertTrue(joined.contains(b))
        XCTAssertEqual(joined.counters[writerA], 5)
        XCTAssertThrowsError(try CloudClock(counters: ["bad": 1]).validate())
    }

    func testPrivateCloudMetadataNeverCrossesWebSaveBoundary() async throws {
        let (directory, store) = try await makeStore(writerA)
        defer { try? FileManager.default.removeItem(at: directory) }
        let raw = try await exported(store)
        XCTAssertNotNil(try object(raw)["_nativeCloud"])
        let publicData = try await store.load()
        var snapshot = try object(XCTUnwrap(publicData))
        XCTAssertNil(snapshot["_nativeCloud"])
        XCTAssertNil(snapshot["_nativeIAP"])
        snapshot["_nativeCloud"] = ["version": 1]
        do { try await store.save(JSONSerialization.data(withJSONObject: snapshot)); XCTFail("Web supplied cloud clock accepted") }
        catch SaveStoreError.invalidSnapshot { }
    }

    func testSelectedEconomyAndRoundKeepUnionOfPurchaseIDsWithoutAddingBalances() async throws {
        let (dirA, a) = try await makeStore(writerA)
        let (dirB, b) = try await makeStore(writerB)
        defer { try? FileManager.default.removeItem(at: dirA); try? FileManager.default.removeItem(at: dirB) }
        _ = try await a.commitPurchase(.init(transactionID: "201", productID: "com.busfever.coinpack.small", quantity: 1), ownedProducts: [])
        _ = try await b.commitPurchase(.init(transactionID: "202", productID: PurchaseCatalog.starter, quantity: 1), ownedProducts: [PurchaseCatalog.starter])
        let local = try await exported(a)
        let remote = try await exported(b)
        try await a.importCloud(remote, observed: [remote], expectedLocal: local)
        let loaded = try await a.load()
        let selected = try object(XCTUnwrap(loaded))
        let meta = try XCTUnwrap(selected["meta"] as? [String: Any])
        XCTAssertEqual(meta["coins"] as? Int, 720, "A choice selects one balance, never sums two economies")
        XCTAssertEqual(meta["starterBundleOwned"] as? Bool, false, "Cloud is not a verified entitlement")
        XCTAssertEqual((selected["round"] as? [String: Any])?["stage"] as? Int, 4)
        let deliveredA = try await a.hasDelivered("201", productID: "com.busfever.coinpack.small")
        let deliveredB = try await a.hasDelivered("202", productID: PurchaseCatalog.starter)
        XCTAssertTrue(deliveredA); XCTAssertTrue(deliveredB)
        let duplicate = try await a.commitPurchase(.init(transactionID: "201", productID: "com.busfever.coinpack.small", quantity: 1), ownedProducts: [])
        XCTAssertTrue(duplicate.duplicate)
        let merged = try await exported(a)
        let mergedClock = try await a.inspectCloud(merged).clock
        let remoteClock = try await b.inspectCloud(remote).clock
        XCTAssertTrue(mergedClock.contains(remoteClock))
        let recovery = dirA.appendingPathComponent("CloudRecovery")
        XCTAssertFalse(try FileManager.default.contentsOfDirectory(atPath: recovery.path).isEmpty)
    }

    func testChangedLocalSnapshotRejectsAnOpenCloudSelection() async throws {
        let (directory, store) = try await makeStore(writerA)
        defer { try? FileManager.default.removeItem(at: directory) }
        let before = try await exported(store)
        let data = try await store.load()
        var newer = try object(XCTUnwrap(data))
        newer["score"] = 200
        try await store.save(JSONSerialization.data(withJSONObject: newer))
        let actual = try await exported(store)
        do { try await store.importCloud(before, observed: [before], expectedLocal: before); XCTFail("Stale selection applied") }
        catch CloudSaveError.conflict { }
        let after = try await exported(store)
        XCTAssertEqual(after, actual)
    }

    func testFutureAndMalformedCloudDataNeverReplaceLocalSave() async throws {
        let (directory, store) = try await makeStore(writerA)
        defer { try? FileManager.default.removeItem(at: directory) }
        let before = try await exported(store)
        for bad in [Data("{\"schemaVersion\":99}".utf8), Data("{}".utf8)] {
            do { try await store.importCloud(bad, observed: [bad], expectedLocal: before); XCTFail("Invalid cloud data applied") }
            catch { }
        }
        let after = try await exported(store)
        XCTAssertEqual(after, before)
    }

    func testConflictingPurchaseFactsNeverReplaceLocalSave() async throws {
        let (dirA, a) = try await makeStore(writerA)
        let (dirB, b) = try await makeStore(writerB)
        defer { try? FileManager.default.removeItem(at: dirA); try? FileManager.default.removeItem(at: dirB) }
        _ = try await a.commitPurchase(.init(transactionID: "203", productID: "com.busfever.coinpack.small", quantity: 1), ownedProducts: [])
        _ = try await b.commitPurchase(.init(transactionID: "203", productID: "com.busfever.coinpack.medium", quantity: 1), ownedProducts: [])
        let local = try await exported(a)
        let remote = try await exported(b)
        do { try await a.importCloud(remote, observed: [remote], expectedLocal: local); XCTFail("Conflicting facts applied") }
        catch CloudSaveError.invalidRecord { }
        let after = try await exported(a)
        XCTAssertEqual(after, local)
    }

    func testCloudCapacityFailsWithoutTruncatingLocalJournal() async throws {
        let (directory, store) = try await makeStore(writerA)
        defer { try? FileManager.default.removeItem(at: directory) }
        let data = try await store.load()
        var snapshot = try object(XCTUnwrap(data))
        snapshot["padding"] = String(repeating: "x", count: CloudRecord.maximumPayloadBytes)
        try await store.save(JSONSerialization.data(withJSONObject: snapshot))
        do { _ = try await store.cloudExport(); XCTFail("Oversized cloud record accepted") }
        catch CloudSaveError.capacity { }
        let loaded = try await store.load()
        XCTAssertEqual(try object(XCTUnwrap(loaded))["padding"] as? String, snapshot["padding"] as? String)
    }

    func testNoExportBeforeNativeJournalInitialization() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalSaveStore(directory: directory)
        try await store.configureCloudWriter(writerA)
        try await store.save(JSONSerialization.data(withJSONObject: ["schemaVersion": 3, "stage": 1, "score": 0,
            "updatedAt": 100, "shufflesLeft": 2, "vipLeft": 1, "meta": ["coins": 120]]))
        let data = try await store.cloudExport()
        XCTAssertNil(data)
    }
}
