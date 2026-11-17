import Foundation
import CryptoKit

enum HostError: Error {
    case invalidBundle, invalidRequest, unavailable
}

struct BundleAssetStore: Sendable {
    struct Manifest: Decodable {
        let version: Int
        let entry: String
        let files: [Entry]
        struct Entry: Decodable {
            let path: String
            let bytes: Int
            let sha256: String
            let mimeType: String
        }
    }
    struct Asset: Sendable {
        let data: Data
        let mimeType: String
    }
    let assets: [String: Asset]
    let entry: String

    init(root: URL) throws {
        let manifest = try JSONDecoder().decode(Manifest.self, from: Data(contentsOf: root.appendingPathComponent("manifest.json")))
        guard manifest.version == 1, manifest.entry == "web-prototype/index.html",
              !manifest.files.isEmpty, manifest.files.count <= 128 else { throw HostError.invalidBundle }
        let allowedMimes = ["text/html; charset=utf-8", "text/css; charset=utf-8", "text/javascript; charset=utf-8", "application/json; charset=utf-8", "text/plain; charset=utf-8"]
        var assets: [String: Asset] = [:]
        var totalBytes = 0
        for file in manifest.files {
            guard Self.isAssetPath(file.path), assets[file.path] == nil,
                  allowedMimes.contains(file.mimeType), file.bytes >= 0, file.bytes <= 4 * 1024 * 1024 else { throw HostError.invalidBundle }
            let url = root.appendingPathComponent(file.path).resolvingSymlinksInPath()
            let resolvedRoot = root.resolvingSymlinksInPath().path + "/"
            guard url.path.hasPrefix(resolvedRoot) else { throw HostError.invalidBundle }
            let data = try Data(contentsOf: url)
            totalBytes += data.count
            let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
            guard data.count == file.bytes, digest == file.sha256, totalBytes <= 8 * 1024 * 1024 else { throw HostError.invalidBundle }
            assets[file.path] = Asset(data: data, mimeType: file.mimeType)
        }
        guard assets[manifest.entry] != nil else { throw HostError.invalidBundle }
        self.assets = assets
        self.entry = manifest.entry
    }

    static func isAssetPath(_ path: String) -> Bool {
        let parts = path.split(separator: "/", omittingEmptySubsequences: false)
        guard !path.contains("\\"), !path.contains("%"), !path.contains("\0"),
              !path.contains("?"), !path.contains("#"),
              parts.allSatisfy({ !$0.isEmpty && !$0.hasPrefix(".") }), parts.count >= 2 else { return false }
        return parts[0] == "web-prototype" || path == "data/levels_seed.json"
    }
}
