import XCTest
@testable import BusFever

final class LocalSaveStoreTests: XCTestCase {
    private func temporaryDirectory() throws -> URL {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func snapshot(time: Int = 100, ledger: [String: String] = [:]) throws -> Data {
        try JSONSerialization.data(withJSONObject: [
            "schemaVersion": 3, "updatedAt": time, "stage": 4, "score": 900,
            "shufflesLeft": 2, "vipLeft": 1,
            "meta": ["coins": 120, "deliveredTransactions": ledger],
            "round": ["version": 1, "stage": 4]
        ], options: .sortedKeys)
    }

    func testRoundAndInventoryPersistAcrossNewStoreInstance() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalSaveStore(directory: directory)
        try await store.prepare()
        let empty = try await store.load()
        XCTAssertNil(empty)
        let data = try snapshot()
        try await store.save(data)
        let relaunched = LocalSaveStore(directory: directory)
        let loaded = try await relaunched.load()
        XCTAssertEqual(loaded, data)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: directory.path), ["save.json"])
    }

    func testOlderSnapshotAndDroppedLedgerCannotOverwrite() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let store = LocalSaveStore(directory: directory)
        let data = try snapshot(time: 200, ledger: ["101": "com.busfever.coinpack.small"])
        // A legacy file can contain an old public ledger, but it is never purchase proof.
        try data.write(to: directory.appendingPathComponent("save.json"))
        do { try await store.save(snapshot(time: 100, ledger: ["101": "com.busfever.coinpack.small"])); XCTFail("Older data was accepted") }
        catch SaveStoreError.staleSnapshot { }
        do { try await store.save(snapshot(time: 300)); XCTFail("Ledger deletion was accepted") }
        catch SaveStoreError.invalidSnapshot { }
        let loaded = try await store.load()
        XCTAssertEqual(loaded, data)
        do { try await store.save(snapshot(time: 300, ledger: ["101": "com.busfever.coinpack.small", "102": "com.busfever.coinpack.medium"])); XCTFail("Forged addition was accepted") }
        catch SaveStoreError.invalidSnapshot { }
        let newer = try snapshot(time: 300, ledger: ["101": "com.busfever.coinpack.small"])
        try await store.save(newer)
        let latest = try await store.load()
        XCTAssertEqual(latest, newer)
    }

    func testFutureSchemaIsReturnedButNeverReplaced() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let future = Data("{\"schemaVersion\":99,\"futureField\":true}".utf8)
        try future.write(to: directory.appendingPathComponent("save.json"))
        let store = LocalSaveStore(directory: directory)
        try await store.prepare()
        let loaded = try await store.load()
        XCTAssertEqual(loaded, future)
        do { try await store.save(snapshot()); XCTFail("Future data was replaced") }
        catch SaveStoreError.futureSchema { }
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("save.json")), future)
    }

    func testCorruptFileAndInvalidNumbersAreNotOverwritten() async throws {
        let directory = try temporaryDirectory()
        defer { try? FileManager.default.removeItem(at: directory) }
        let corrupt = Data("broken-json".utf8)
        try corrupt.write(to: directory.appendingPathComponent("save.json"))
        let store = LocalSaveStore(directory: directory)
        do { try await store.save(snapshot()); XCTFail("Corrupt file was replaced") }
        catch { }
        XCTAssertEqual(try Data(contentsOf: directory.appendingPathComponent("save.json")), corrupt)
        XCTAssertNil(LocalSaveStore.integer(true))
        XCTAssertNil(LocalSaveStore.integer(-1))
        XCTAssertNil(LocalSaveStore.integer(1.5))
        XCTAssertNil(LocalSaveStore.integer(Double.infinity))
        XCTAssertEqual(LocalSaveStore.integer(1234), 1234)
    }
}
