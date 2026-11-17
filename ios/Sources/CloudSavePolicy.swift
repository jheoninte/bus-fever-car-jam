import Foundation

enum CloudSaveError: Error {
    case invalidRecord, capacity, accountChanged, conflict, unavailable
}

// Vector clocks compare causal history; wall-clock timestamps never select an economy.
struct CloudClock: Codable, Equatable {
    var version = 1
    var counters: [String: Int] = [:]

    func validate() throws {
        guard version == 1, counters.count <= 16,
              counters.allSatisfy({ UUID(uuidString: $0.key) != nil && $0.value > 0 && $0.value < 9_007_199_254_740_991 }) else {
            throw CloudSaveError.invalidRecord
        }
    }

    func contains(_ other: CloudClock) -> Bool {
        other.counters.allSatisfy { (counters[$0.key] ?? 0) >= $0.value }
    }

    mutating func join(_ other: CloudClock) throws {
        for (device, counter) in other.counters { counters[device] = max(counters[device] ?? 0, counter) }
        try validate()
    }

    mutating func tick(_ writer: String) throws {
        counters[writer] = (counters[writer] ?? 0) + 1
        try validate()
    }
}

struct CloudRecord: Codable {
    static let prefix = "busfever.cloud.v1."
    static let maximumDevices = 8
    // Eight base64-encoded records plus plist overhead fit below the 1 MiB KVS quota.
    static let maximumPayloadBytes = 80 * 1024
    static let maximumRecordBytes = 112 * 1024
    var version = 1
    let writerID: String
    let payload: Data

    func encoded() throws -> Data {
        guard version == 1, UUID(uuidString: writerID) != nil, payload.count <= Self.maximumPayloadBytes else { throw CloudSaveError.capacity }
        let data = try JSONEncoder().encode(self)
        guard data.count <= Self.maximumRecordBytes else { throw CloudSaveError.capacity }
        return data
    }
}

struct CloudSummary {
    let clock: CloudClock
    let stage: Int
    let coins: Int
    let shuffles: Int
    let vip: Int
}
