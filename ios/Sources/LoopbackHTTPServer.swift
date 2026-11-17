import Foundation
import Network

// Bind loopback only. All reads come from the immutable, hash-checked asset map, never a request-built filesystem path.
final class LoopbackHTTPServer {
    private let queue = DispatchQueue(label: "com.busfever.loopback")
    private let store: BundleAssetStore
    private let token = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    private var listener: NWListener?
    private var connections: [UUID: NWConnection] = [:]
    private var deadlines: [UUID: DispatchWorkItem] = [:]
    var onFailure: (() -> Void)?

    init(store: BundleAssetStore) { self.store = store }

    func start(completion: @escaping (Result<URL, Error>) -> Void) {
        queue.async { [weak self] in
            guard let self = self else { return }
            do {
                let parameters = NWParameters.tcp
                parameters.requiredLocalEndpoint = .hostPort(host: NWEndpoint.Host("127.0.0.1"), port: .any)
                let listener = try NWListener(using: parameters)
                self.listener = listener
                var replied = false
                listener.stateUpdateHandler = { [weak self] state in
                    guard let self = self else { return }
                    switch state {
                    case .ready:
                        guard !replied, let port = self.listener?.port,
                              let url = URL(string: "http://localhost:\(port.rawValue)/\(self.token)/\(self.store.entry)") else { return }
                        replied = true
                        DispatchQueue.main.async { completion(.success(url)) }
                    case .failed(let error):
                        if !replied {
                            replied = true
                            DispatchQueue.main.async { completion(.failure(error)) }
                        } else {
                            DispatchQueue.main.async { [weak self] in self?.onFailure?() }
                        }
                    default: break
                    }
                }
                listener.newConnectionHandler = { [weak self] connection in self?.accept(connection) }
                listener.start(queue: self.queue)
                self.queue.asyncAfter(deadline: .now() + 8) {
                    if !replied {
                        replied = true
                        listener.cancel()
                        DispatchQueue.main.async { completion(.failure(HostError.unavailable)) }
                    }
                }
            } catch {
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }
    }

    func stop() {
        queue.async {
            self.listener?.cancel()
            self.listener = nil
            self.deadlines.values.forEach { $0.cancel() }
            self.deadlines.removeAll()
            self.connections.values.forEach { $0.cancel() }
            self.connections.removeAll()
        }
    }

    private func accept(_ connection: NWConnection) {
        guard connections.count < 24 else { connection.cancel(); return }
        let id = UUID()
        connections[id] = connection
        let deadline = DispatchWorkItem { [weak self] in self?.close(id) }
        deadlines[id] = deadline
        queue.asyncAfter(deadline: .now() + 8, execute: deadline)
        connection.start(queue: queue)
        receive(id, buffer: Data())
    }

    private func close(_ id: UUID) {
        deadlines.removeValue(forKey: id)?.cancel()
        connections.removeValue(forKey: id)?.cancel()
    }

    private func receive(_ id: UUID, buffer: Data) {
        guard let connection = connections[id] else { return }
        connection.receive(minimumIncompleteLength: 1, maximumLength: 16384) { [weak self] chunk, _, complete, error in
            guard let self = self else { return }
            var data = buffer
            if let chunk = chunk { data.append(chunk) }
            guard data.count <= 16384 else { self.respond(id, status: "431 Request Header Fields Too Large"); return }
            if let end = data.range(of: Data("\r\n\r\n".utf8)) {
                self.handle(id, header: data.subdata(in: 0..<end.lowerBound))
            } else if complete || error != nil {
                self.close(id)
            } else {
                self.receive(id, buffer: data)
            }
        }
    }

    // Kept pure so traversal, methods, queries and token isolation can be tested in XCTest.
    static func assetPath(requestTarget: String, token: String) -> String? {
        let rawPath = String(requestTarget.split(separator: "?", maxSplits: 1, omittingEmptySubsequences: false)[0])
        guard let decoded = rawPath.removingPercentEncoding,
              decoded.hasPrefix("/\(token)/") else { return nil }
        let path = String(decoded.dropFirst(token.count + 2))
        return BundleAssetStore.isAssetPath(path) ? path : nil
    }

    private func handle(_ id: UUID, header: Data) {
        guard let text = String(data: header, encoding: .utf8), let line = text.components(separatedBy: "\r\n").first else {
            respond(id, status: "400 Bad Request"); return
        }
        let parts = line.split(separator: " ", omittingEmptySubsequences: false)
        guard parts.count == 3, ["HTTP/1.1", "HTTP/1.0"].contains(String(parts[2])) else { respond(id, status: "400 Bad Request"); return }
        guard parts[0] == "GET" || parts[0] == "HEAD" else { respond(id, status: "405 Method Not Allowed"); return }
        guard let path = Self.assetPath(requestTarget: String(parts[1]), token: token), let asset = store.assets[path] else {
            respond(id, status: "404 Not Found"); return
        }
        respond(id, status: "200 OK", asset: asset, head: parts[0] == "HEAD")
    }

    private func respond(_ id: UUID, status: String, asset: BundleAssetStore.Asset? = nil, head: Bool = false) {
        guard let connection = connections[id] else { return }
        let body = asset?.data ?? Data()
        let mime = asset?.mimeType ?? "text/plain; charset=utf-8"
        let header = "HTTP/1.1 \(status)\r\nContent-Type: \(mime)\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nCross-Origin-Resource-Policy: same-origin\r\nConnection: close\r\n\r\n"
        var response = Data(header.utf8)
        if !head { response.append(body) }
        connection.send(content: response, completion: .contentProcessed { [weak self] _ in self?.close(id) })
    }
}
