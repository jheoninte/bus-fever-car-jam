import UIKit

@MainActor
final class CloudSaveService {
    private struct Identity: Codable {
        var version = 1
        var writerID = UUID().uuidString
        var token: Data?
    }
    private let store: LocalSaveStore
    private let kvs: NSUbiquitousKeyValueStore
    private let gate: NativePresentationGate
    private weak var presenter: UIViewController?
    private let pauseGame: @MainActor () async -> Void
    private let resumeGame: @MainActor () -> Void
    private let changed: @MainActor () -> Void
    private let identityURL: URL
    private var identity: Identity?
    private var observers: [NSObjectProtocol] = []
    private var scheduled: Task<Void, Never>?
    private var lastAttempt = Date.distantPast
    private var busy = false
    private var connected = false
    private(set) var state = "unavailable"

    init(store: LocalSaveStore, gate: NativePresentationGate, presenter: UIViewController,
         identityURL: URL, kvs: NSUbiquitousKeyValueStore = .default,
         pauseGame: @escaping @MainActor () async -> Void, resumeGame: @escaping @MainActor () -> Void,
         changed: @escaping @MainActor () -> Void) {
        self.store = store; self.gate = gate; self.presenter = presenter; self.identityURL = identityURL
        self.kvs = kvs; self.pauseGame = pauseGame; self.resumeGame = resumeGame; self.changed = changed
    }

    deinit {
        scheduled?.cancel()
        for observer in observers { NotificationCenter.default.removeObserver(observer) }
    }

    var status: [String: Any] { ["state": state, "connected": connected] }

    private func setState(_ value: String) {
        guard state != value else { return }
        state = value; changed()
    }

    // The opaque identity token stays only in the local identity file, never in KVS/logs/JS.
    private func currentToken() -> Data? {
        guard let token = FileManager.default.ubiquityIdentityToken else { return nil }
        return try? NSKeyedArchiver.archivedData(withRootObject: token, requiringSecureCoding: false)
    }

    private func sameAccount(_ a: Data?, _ b: Data?) -> Bool {
        guard let a = a, let b = b,
              let left = (try? NSKeyedUnarchiver.unarchiveTopLevelObjectWithData(a)) as? NSObject,
              let right = (try? NSKeyedUnarchiver.unarchiveTopLevelObjectWithData(b)) as? NSObject else { return false }
        return left.isEqual(right)
    }

    private func checkAccount() -> Bool {
        guard let token = currentToken() else {
            connected = false; setState("signed_out"); return false
        }
        guard sameAccount(identity?.token, token) else {
            connected = false; setState("account_changed"); return false
        }
        connected = true
        return true
    }

    private func persistIdentity(_ value: Identity) throws {
        try FileManager.default.createDirectory(at: identityURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder().encode(value).write(to: identityURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var url = identityURL
        try url.setResourceValues(values)
        identity = value
    }

    func start() async {
        guard observers.isEmpty else { return }
        for name in [NSUbiquitousKeyValueStore.didChangeExternallyNotification, .NSUbiquityIdentityDidChange] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] notification in
                let reason = notification.userInfo?[NSUbiquitousKeyValueStoreChangeReasonKey] as? Int
                Task { @MainActor [weak self] in
                    guard let self = self else { return }
                    if reason == NSUbiquitousKeyValueStoreQuotaViolationChange { self.setState("quota"); return }
                    await self.refresh()
                }
            })
        }
        do {
            if FileManager.default.fileExists(atPath: identityURL.path) {
                let decoded = try JSONDecoder().decode(Identity.self, from: Data(contentsOf: identityURL))
                guard decoded.version == 1, UUID(uuidString: decoded.writerID) != nil else { throw CloudSaveError.invalidRecord }
                identity = decoded
                // A restored game save must get a new device slot, not clone this writer.
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                var url = identityURL
                try url.setResourceValues(values)
            } else {
                let existing = try await store.load()
                // An existing offline save needs an explicit account connection before upload.
                try persistIdentity(Identity(token: existing == nil ? currentToken() : nil))
            }
            guard let identity = identity else { throw CloudSaveError.invalidRecord }
            try await store.configureCloudWriter(identity.writerID)
            guard checkAccount() else { return }
            _ = kvs.synchronize() // Requests synchronization; never reports remote durability.
            let records = try await readRecords()
            // Only a genuinely empty install may adopt one cached causal head automatically.
            if try await store.load() == nil {
                let heads = try await maximal(records)
                if heads.count == 1, let record = heads.first, checkAccount() {
                    try await store.importCloud(record.payload, observed: records.map(\.payload), expectedLocal: nil)
                }
            }
            await refresh()
        } catch { setState("invalid_data") }
    }

    private func readRecords() async throws -> [CloudRecord] {
        var records: [CloudRecord] = []
        for (key, raw) in kvs.dictionaryRepresentation where key.hasPrefix(CloudRecord.prefix) {
            guard records.count < CloudRecord.maximumDevices, let data = raw as? Data,
                  data.count <= CloudRecord.maximumRecordBytes else { throw CloudSaveError.capacity }
            let record = try JSONDecoder().decode(CloudRecord.self, from: data)
            guard record.version == 1, key == CloudRecord.prefix + record.writerID else { throw CloudSaveError.invalidRecord }
            _ = try record.encoded()
            let summary = try await store.inspectCloud(record.payload)
            guard summary.clock.counters[record.writerID] != nil else { throw CloudSaveError.invalidRecord }
            records.append(record)
        }
        return records.sorted { $0.writerID < $1.writerID }
    }

    private func maximal(_ records: [CloudRecord]) async throws -> [CloudRecord] {
        var clocks: [CloudClock] = []
        for record in records { clocks.append(try await store.inspectCloud(record.payload).clock) }
        var result: [CloudRecord] = []
        for i in records.indices {
            var dominated = false
            for j in records.indices where i != j {
                if clocks[i] == clocks[j] {
                    guard records[i].payload == records[j].payload else { throw CloudSaveError.invalidRecord }
                    if j < i { dominated = true }
                } else if clocks[j].contains(clocks[i]) { dominated = true }
            }
            if !dominated { result.append(records[i]) }
        }
        return result
    }

    func refresh() async {
        guard checkAccount(), !busy else { return }
        do {
            let records = try await readRecords()
            guard checkAccount() else { return }
            guard let local = try await store.cloudExport() else {
                setState(records.isEmpty ? "ready" : "download_available"); return
            }
            let clock = try await store.inspectCloud(local).clock
            guard checkAccount() else { return }
            if records.allSatisfy({ $0.payload == local }) { setState(records.isEmpty ? "ready" : "queued"); return }
            var containsAll = true
            for record in records {
                if !clock.contains(try await store.inspectCloud(record.payload).clock) { containsAll = false }
            }
            guard checkAccount() else { return }
            setState(containsAll ? "ready" : "conflict")
        } catch CloudSaveError.capacity { setState("quota") }
        catch { setState("invalid_data") }
    }

    func localDidChange() async -> Bool {
        guard checkAccount(), state != "quota", !busy else { return false }
        let remaining = 60 - Date().timeIntervalSince(lastAttempt)
        if UIApplication.shared.applicationState == .active, remaining > 0 {
            if scheduled == nil {
                scheduled = Task { @MainActor [weak self] in
                    try? await Task.sleep(nanoseconds: UInt64(min(remaining, 60) * 1_000_000_000))
                    guard !Task.isCancelled, let self = self else { return }
                    self.scheduled = nil; _ = await self.backup()
                }
            }
            return false
        }
        scheduled?.cancel(); scheduled = nil
        return await backup()
    }

    private func backup() async -> Bool {
        guard checkAccount(), !busy, let writer = identity?.writerID else { return false }
        busy = true
        defer { busy = false }
        do {
            let records = try await readRecords()
            guard let local = try await store.cloudExport() else { return false }
            let clock = try await store.inspectCloud(local).clock
            for record in records {
                let remote = try await store.inspectCloud(record.payload).clock
                guard clock.contains(remote) else { setState("conflict"); return false }
                if clock == remote, record.payload != local { throw CloudSaveError.invalidRecord }
            }
            guard records.count < CloudRecord.maximumDevices || records.contains(where: { $0.writerID == writer }) else { throw CloudSaveError.capacity }
            let encoded = try CloudRecord(writerID: writer, payload: local).encoded()
            guard checkAccount() else { return false }
            lastAttempt = Date()
            let key = CloudRecord.prefix + writer
            if kvs.data(forKey: key) != encoded { kvs.set(encoded, forKey: key) }
            guard kvs.data(forKey: key) == encoded else { setState("quota"); return false }
            _ = kvs.synchronize()
            setState("queued")
            return true
        } catch CloudSaveError.capacity { setState("quota") }
        catch { setState("invalid_data") }
        return false
    }

    private func choose(title: String, message: String, options: [String]) async -> Int? {
        guard UIApplication.shared.applicationState == .active, let presenter = presenter,
              presenter.presentedViewController == nil else { return nil }
        return await withCheckedContinuation { continuation in
            let alert = UIAlertController(title: title, message: message, preferredStyle: .alert)
            let finish: (Int?) -> Void = { [weak presenter] answer in
                guard let presenter = presenter else { continuation.resume(returning: answer); return }
                // Do not open the next alert while the connection alert is still dismissing.
                presenter.dismiss(animated: true) { continuation.resume(returning: answer) }
            }
            for (index, option) in options.enumerated() {
                alert.addAction(UIAlertAction(title: option, style: .default) { _ in finish(index) })
            }
            alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in finish(nil) })
            presenter.present(alert, animated: true)
        }
    }

    func manage() async -> [String: Any] {
        guard !busy, let lease = gate.acquire() else { return ["changed": false, "reason": "busy"] }
        await pauseGame()
        busy = true
        scheduled?.cancel(); scheduled = nil
        var requiresReload = false
        defer { busy = false; gate.release(lease); resumeGame() }
        do {
            guard let token = currentToken() else { setState("signed_out"); return ["changed": false, "reason": state] }
            if !sameAccount(identity?.token, token) {
                let answer = await choose(title: "iCloud 백업 연결", message: "현재 iCloud 계정에 이 기기의 진행을 연결합니다. 기존 백업이 있으면 사용할 진행을 선택하고, 없으면 이 기기의 진행을 백업합니다. 다른 계정의 진행을 옮기려는 경우에만 연결해 주세요.", options: ["이 계정에 연결"])
                guard answer == 0, sameAccount(token, currentToken()) else { return ["changed": false, "reason": "cancelled"] }
                // A fresh writer prevents overwriting the prior account's device slot.
                let next = Identity(writerID: UUID().uuidString, token: token)
                try await store.configureCloudWriter(next.writerID)
                try await store.resetCloudHistory()
                requiresReload = true
                try persistIdentity(next)
            }
            guard checkAccount() else { throw CloudSaveError.accountChanged }
            _ = kvs.synchronize()
            let records = try await readRecords()
            let local = try await store.cloudExport()
            let heads = try await maximal(records)
            guard checkAccount() else { throw CloudSaveError.accountChanged }
            var candidates: [(String, Data)] = []
            if let local = local {
                let summary = try await store.inspectCloud(local)
                candidates.append(("이 기기: 스테이지 \(summary.stage) · 코인 \(summary.coins) · 셔플 \(summary.shuffles) · VIP \(summary.vip)", local))
            }
            for (index, record) in heads.enumerated() where record.payload != local {
                let summary = try await store.inspectCloud(record.payload)
                candidates.append(("백업 \(index + 1): 스테이지 \(summary.stage) · 코인 \(summary.coins) · 셔플 \(summary.shuffles) · VIP \(summary.vip)", record.payload))
            }
            guard !candidates.isEmpty else { return ["changed": false, "reason": "not_ready", "requiresReload": requiresReload] }
            let answer = await choose(title: "사용할 진행 선택", message: "선택한 진행과 잔액을 사용합니다. 다른 진행의 남은 코인·부스터(구매한 재화 포함)는 합산하지 않습니다. 구매 지급 기록은 합쳐 중복 지급을 막고 선택 전 데이터는 이 기기에 보관합니다. 적용하면 게임 화면을 다시 불러옵니다. iCloud 백업은 전송이 지연될 수 있습니다.", options: candidates.map { $0.0 })
            guard let answer = answer else { return ["changed": false, "reason": "cancelled", "requiresReload": requiresReload] }
            guard checkAccount() else { throw CloudSaveError.accountChanged }
            let latest = try await readRecords()
            guard latest.map(\.payload) == records.map(\.payload) else { throw CloudSaveError.conflict }
            guard checkAccount() else { throw CloudSaveError.accountChanged }
            try await store.importCloud(candidates[answer].1, observed: records.map(\.payload), expectedLocal: local)
            requiresReload = true
            // No KVS write occurs after a token change, even if the alert was already open.
            guard checkAccount() else { throw CloudSaveError.accountChanged }
            setState("ready")
            return ["changed": true, "requiresReload": true]
        } catch CloudSaveError.capacity { setState("quota") }
        catch CloudSaveError.conflict { setState("conflict") }
        catch { if connected { setState("invalid_data") } }
        return ["changed": false, "reason": state, "requiresReload": requiresReload]
    }
}
