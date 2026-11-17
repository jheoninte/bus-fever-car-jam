import Foundation
import CoreFoundation

enum SaveStoreError: Error {
    case invalidSnapshot, futureSchema, staleSnapshot, stalePurchaseRevision
}

enum NativeConstants {
    static let saveKey = "bus_fever_save_v2"
    static let productIDs = Set(PurchaseCatalog.products.keys)
}

// One actor, one complete snapshot: inventory, round and delivery ledger commit in the same atomic replacement.
actor LocalSaveStore {
    static let supportedSchema = 3
    static let maximumBytes = 512 * 1024
    private let directory: URL
    private let fileURL: URL
    private var cloudWriter: String?

    init(directory: URL) {
        self.directory = directory
        self.fileURL = directory.appendingPathComponent("save.json")
    }

    static func applicationStore() throws -> LocalSaveStore {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return LocalSaveStore(directory: support.appendingPathComponent("BusFever", isDirectory: true))
    }

    static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
              number.doubleValue.isFinite, number.doubleValue >= 0,
              number.doubleValue <= 9_007_199_254_740_991,
              number.doubleValue.rounded(.towardZero) == number.doubleValue else { return nil }
        return number.intValue
    }

    private func decode(_ data: Data) throws -> [String: Any] {
        guard data.count <= Self.maximumBytes,
              let snapshot = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let schema = Self.integer(snapshot["schemaVersion"]), schema > 0 else { throw SaveStoreError.invalidSnapshot }
        // Preserve and surface future snapshots even when their remaining fields use a different shape.
        if schema > Self.supportedSchema { return snapshot }
        guard let stage = Self.integer(snapshot["stage"]), stage > 0,
              Self.integer(snapshot["score"]) != nil,
              Self.integer(snapshot["updatedAt"]) != nil,
              Self.integer(snapshot["shufflesLeft"]) != nil,
              Self.integer(snapshot["vipLeft"]) != nil,
              let meta = snapshot["meta"] as? [String: Any], Self.integer(meta["coins"]) != nil else { throw SaveStoreError.invalidSnapshot }
        if let rawLedger = meta["deliveredTransactions"] {
            guard let ledger = rawLedger as? [String: String], ledger.allSatisfy({ !$0.key.isEmpty && NativeConstants.productIDs.contains($0.value) }) else {
                throw SaveStoreError.invalidSnapshot
            }
        }
        return snapshot
    }

    func prepare() throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        _ = try load()
    }

    func load() throws -> Data? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        let data = try Data(contentsOf: fileURL)
        var snapshot = try decode(data)
        if snapshot["_nativeIAP"] != nil { _ = try journal(in: snapshot) }
        snapshot.removeValue(forKey: "_nativeIAP")
        snapshot.removeValue(forKey: "_nativeCloud")
        return try JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys])
    }

    func save(_ data: Data) throws {
        var incoming = try decode(data)
        guard incoming["_nativeIAP"] == nil, incoming["_nativeCloud"] == nil else { throw SaveStoreError.invalidSnapshot }
        if let revision = incoming["nativePurchaseRevision"], Self.integer(revision) == nil { throw SaveStoreError.invalidSnapshot }
        guard let schema = Self.integer(incoming["schemaVersion"]), schema <= Self.supportedSchema else { throw SaveStoreError.futureSchema }
        let existing = try diskSnapshot()
        let trusted = try journal(in: existing ?? [:])
        guard (Self.integer(incoming["nativePurchaseRevision"]) ?? 0) == trusted.revision else { throw SaveStoreError.stalePurchaseRevision }
        let oldLedger = (existing?["meta"] as? [String: Any])?["deliveredTransactions"] as? [String: String] ?? [:]
        let newLedger = (incoming["meta"] as? [String: Any])?["deliveredTransactions"] as? [String: String] ?? [:]
        // Web snapshots cannot manufacture, delete or relabel a delivered transaction.
        guard oldLedger.allSatisfy({ newLedger[$0.key] == $0.value }), oldLedger == newLedger else { throw SaveStoreError.invalidSnapshot }
        try validatePerks(incoming, owned: trusted.ownedProducts)
        if let existing = existing {
            guard (Self.integer(incoming["updatedAt"]) ?? 0) >= (Self.integer(existing["updatedAt"]) ?? 0) else { throw SaveStoreError.staleSnapshot }
        }
        if let raw = existing?["_nativeIAP"] { incoming["_nativeIAP"] = raw }
        if let raw = existing?["_nativeCloud"] { incoming["_nativeCloud"] = raw }
        try write(incoming)
    }

    private func diskSnapshot() throws -> [String: Any]? {
        guard FileManager.default.fileExists(atPath: fileURL.path) else { return nil }
        let snapshot = try decode(Data(contentsOf: fileURL))
        guard (Self.integer(snapshot["schemaVersion"]) ?? 0) <= Self.supportedSchema else { throw SaveStoreError.futureSchema }
        return snapshot
    }

    private func journal(in snapshot: [String: Any]) throws -> PurchaseJournal {
        guard let raw = snapshot["_nativeIAP"] else { return PurchaseJournal() }
        let data = try JSONSerialization.data(withJSONObject: raw)
        let journal = try JSONDecoder().decode(PurchaseJournal.self, from: data)
        guard journal.version == 1, journal.revision >= 0, journal.revision < 9_007_199_254_740_991,
              Self.integer(snapshot["nativePurchaseRevision"]) == journal.revision,
              journal.ownedProducts.allSatisfy({ PurchaseCatalog.products[$0]?.kind == .nonConsumable }) else { throw SaveStoreError.invalidSnapshot }
        let publicLedger = (snapshot["meta"] as? [String: Any])?["deliveredTransactions"] as? [String: String] ?? [:]
        guard journal.delivered.allSatisfy({ UInt64($0.key) != nil && publicLedger[$0.key] == $0.value.productID &&
            PurchaseCatalog.products[$0.value.productID] != nil && (1...100).contains($0.value.quantity) }) else { throw SaveStoreError.invalidSnapshot }
        return journal
    }

    private func validatePerks(_ snapshot: [String: Any], owned: Set<String>) throws {
        let meta = snapshot["meta"] as? [String: Any] ?? [:]
        guard (meta["hasNoAds"] as? Bool ?? false) == owned.contains(PurchaseCatalog.removeAds),
              (meta["hasDoubleRewards"] as? Bool ?? false) == owned.contains(PurchaseCatalog.starter),
              (meta["starterBundleOwned"] as? Bool ?? false) == owned.contains(PurchaseCatalog.starter) else { throw SaveStoreError.invalidSnapshot }
    }

    private func applyPerks(_ owned: Set<String>, to meta: inout [String: Any]) {
        meta["hasNoAds"] = owned.contains(PurchaseCatalog.removeAds)
        meta["hasDoubleRewards"] = owned.contains(PurchaseCatalog.starter)
        meta["starterBundleOwned"] = owned.contains(PurchaseCatalog.starter)
    }

    private func seal(_ snapshot: inout [String: Any], journal: PurchaseJournal) throws {
        snapshot["nativePurchaseRevision"] = journal.revision
        snapshot["_nativeIAP"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(journal))
        snapshot["updatedAt"] = max(Self.integer(snapshot["updatedAt"]) ?? 0, Int(Date().timeIntervalSince1970 * 1000))
    }

    // Both callers pass native StoreKit-verified facts, never client-supplied amounts/ownership.
    func commitPurchase(_ purchase: VerifiedPurchase, ownedProducts: Set<String>) throws -> (snapshot: Data, duplicate: Bool) {
        guard UInt64(purchase.transactionID) != nil, let product = PurchaseCatalog.products[purchase.productID],
              (1...100).contains(purchase.quantity), product.kind == .consumable || purchase.quantity == 1,
              ownedProducts.allSatisfy({ PurchaseCatalog.products[$0]?.kind == .nonConsumable }),
              product.kind == .consumable || ownedProducts.contains(purchase.productID),
              var snapshot = try diskSnapshot() else { throw SaveStoreError.invalidSnapshot }
        var journal = try journal(in: snapshot)
        let record = DeliveredPurchase(productID: purchase.productID, quantity: purchase.quantity)
        if let previous = journal.delivered[purchase.transactionID] {
            guard previous == record else { throw SaveStoreError.invalidSnapshot }
            return (try publicData(snapshot), true)
        }
        var meta = snapshot["meta"] as? [String: Any] ?? [:]
        // Starter consumables are once per saved journal, including refund/repurchase cycles.
        let alreadyGrantedStarter = journal.delivered.values.contains { $0.productID == PurchaseCatalog.starter }
        if purchase.productID != PurchaseCatalog.starter || (!alreadyGrantedStarter && purchase.grantStarterContents) {
            func add(_ value: Any?, _ amount: Int) throws -> Int {
                guard let initial = Self.integer(value), initial <= 9_007_199_254_740_991 - amount else { throw SaveStoreError.invalidSnapshot }
                return initial + amount
            }
            meta["coins"] = try add(meta["coins"], product.coins * purchase.quantity)
            snapshot["shufflesLeft"] = try add(snapshot["shufflesLeft"], product.shuffles * purchase.quantity)
            snapshot["vipLeft"] = try add(snapshot["vipLeft"], product.vip * purchase.quantity)
        }
        var publicLedger = meta["deliveredTransactions"] as? [String: String] ?? [:]
        if let old = publicLedger[purchase.transactionID], old != purchase.productID { throw SaveStoreError.invalidSnapshot }
        publicLedger[purchase.transactionID] = purchase.productID
        meta["deliveredTransactions"] = publicLedger
        meta["lastReceiptVerificationAt"] = Int(Date().timeIntervalSince1970 * 1000)
        applyPerks(ownedProducts, to: &meta)
        snapshot["meta"] = meta
        journal.delivered[purchase.transactionID] = record
        journal.ownedProducts = ownedProducts
        journal.revision += 1
        try seal(&snapshot, journal: journal)
        try write(snapshot)
        return (try publicData(snapshot), false)
    }

    func reconcileEntitlements(_ ownedProducts: Set<String>) throws -> Data? {
        guard ownedProducts.allSatisfy({ PurchaseCatalog.products[$0]?.kind == .nonConsumable }) else { throw SaveStoreError.invalidSnapshot }
        guard var snapshot = try diskSnapshot() else { return nil }
        var journal = try journal(in: snapshot)
        var meta = snapshot["meta"] as? [String: Any] ?? [:]
        let old = try JSONSerialization.data(withJSONObject: meta, options: [.sortedKeys])
        applyPerks(ownedProducts, to: &meta)
        if snapshot["_nativeIAP"] != nil, journal.ownedProducts == ownedProducts,
           old == (try JSONSerialization.data(withJSONObject: meta, options: [.sortedKeys])) {
            return try publicData(snapshot)
        }
        meta["deliveredTransactions"] = meta["deliveredTransactions"] as? [String: String] ?? [:]
        snapshot["meta"] = meta
        journal.ownedProducts = ownedProducts
        journal.revision += 1
        try seal(&snapshot, journal: journal)
        try write(snapshot)
        return try publicData(snapshot)
    }

    func hasDelivered(_ transactionID: String, productID: String) throws -> Bool {
        guard let snapshot = try diskSnapshot() else { return false }
        return try journal(in: snapshot).delivered[transactionID]?.productID == productID
    }

    private func publicData(_ snapshot: [String: Any]) throws -> Data {
        var result = snapshot
        result.removeValue(forKey: "_nativeIAP")
        result.removeValue(forKey: "_nativeCloud")
        return try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
    }

    private func write(_ snapshot: [String: Any]) throws {
        var snapshot = snapshot
        if let writer = cloudWriter {
            var clock = try cloudClock(in: snapshot)
            try clock.tick(writer)
            snapshot["_nativeCloud"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(clock))
        }
        let data = try JSONSerialization.data(withJSONObject: snapshot, options: [.sortedKeys])
        _ = try decode(data)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        #if os(iOS)
        try data.write(to: fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        #else
        try data.write(to: fileURL, options: .atomic)
        #endif
    }

    private func cloudClock(in snapshot: [String: Any]) throws -> CloudClock {
        guard let raw = snapshot["_nativeCloud"] else { return CloudClock() }
        let clock = try JSONDecoder().decode(CloudClock.self, from: JSONSerialization.data(withJSONObject: raw))
        try clock.validate()
        return clock
    }

    func configureCloudWriter(_ writer: String) throws {
        guard UUID(uuidString: writer) != nil else { throw CloudSaveError.invalidRecord }
        cloudWriter = writer
    }

    func cloudExport() throws -> Data? {
        guard let snapshot = try diskSnapshot(), cloudWriter != nil, snapshot["_nativeIAP"] != nil else { return nil }
        _ = try journal(in: snapshot)
        let clock = try cloudClock(in: snapshot)
        if clock.counters.isEmpty {
            // write() initializes and advances the configured writer's durable clock.
            try write(snapshot)
        }
        let data = try Data(contentsOf: fileURL)
        guard data.count <= CloudRecord.maximumPayloadBytes else { throw CloudSaveError.capacity }
        return data
    }

    func inspectCloud(_ data: Data) throws -> CloudSummary {
        guard data.count <= CloudRecord.maximumPayloadBytes else { throw CloudSaveError.capacity }
        let snapshot = try decode(data)
        guard Self.integer(snapshot["schemaVersion"]) == Self.supportedSchema,
              snapshot["_nativeIAP"] != nil, snapshot["_nativeCloud"] != nil else { throw CloudSaveError.invalidRecord }
        _ = try journal(in: snapshot)
        let clock = try cloudClock(in: snapshot)
        guard !clock.counters.isEmpty else { throw CloudSaveError.invalidRecord }
        return CloudSummary(clock: clock, stage: Self.integer(snapshot["stage"])!,
            coins: Self.integer((snapshot["meta"] as? [String: Any])?["coins"])!,
            shuffles: Self.integer(snapshot["shufflesLeft"])!, vip: Self.integer(snapshot["vipLeft"])!)
    }

    func resetCloudHistory() throws {
        guard var snapshot = try diskSnapshot() else { return }
        snapshot.removeValue(forKey: "_nativeCloud")
        var journal = try journal(in: snapshot)
        journal.revision += 1
        try seal(&snapshot, journal: journal)
        try write(snapshot)
    }

    // A native, user-confirmed selection chooses ONE economy. All observed purchase IDs
    // are retained for duplicate suppression; balances are never added or max-merged.
    func importCloud(_ selected: Data, observed: [Data], expectedLocal: Data?) throws {
        guard cloudWriter != nil else { throw CloudSaveError.invalidRecord }
        let actual = try cloudExport()
        guard actual == expectedLocal else { throw CloudSaveError.conflict }
        _ = try inspectCloud(selected)
        var snapshot = try decode(selected)
        var combined = PurchaseJournal()
        var clock = CloudClock()
        var publicLedger: [String: String] = [:]
        let all = observed + (actual.map { [$0] } ?? []) + [selected]
        for data in all {
            _ = try inspectCloud(data)
            let source = try decode(data)
            let sourceJournal = try journal(in: source)
            combined.revision = max(combined.revision, sourceJournal.revision)
            for (id, record) in sourceJournal.delivered {
                if let previous = combined.delivered[id], previous != record { throw CloudSaveError.invalidRecord }
                combined.delivered[id] = record
            }
            for (id, product) in (source["meta"] as? [String: Any])?["deliveredTransactions"] as? [String: String] ?? [:] {
                if let previous = publicLedger[id], previous != product { throw CloudSaveError.invalidRecord }
                publicLedger[id] = product
            }
            try clock.join(cloudClock(in: source))
        }
        combined.revision += 1
        // iCloud is not a signed StoreKit entitlement. Reverify permanent perks locally.
        combined.ownedProducts = []
        var meta = snapshot["meta"] as? [String: Any] ?? [:]
        meta["deliveredTransactions"] = publicLedger
        applyPerks([], to: &meta)
        snapshot["meta"] = meta
        snapshot["_nativeCloud"] = try JSONSerialization.jsonObject(with: JSONEncoder().encode(clock))
        try seal(&snapshot, journal: combined)
        // Causal history, not a different device's wall clock, controls cloud ordering.
        snapshot["updatedAt"] = Int(Date().timeIntervalSince1970 * 1000)
        // Preserve the pre-selection copies before any replacement; never auto-delete them.
        let backups = directory.appendingPathComponent("CloudRecovery/\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: backups, withIntermediateDirectories: true)
        for (index, data) in all.enumerated() {
            try data.write(to: backups.appendingPathComponent("\(index).json"), options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
        try write(snapshot)
    }
}
