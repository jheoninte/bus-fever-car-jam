import XCTest
@testable import BusFever

@MainActor
final class HostBoundaryTests: XCTestCase {
    func testOnlyTokenScopedGameAssetsAreAddressable() {
        XCTAssertEqual(LoopbackHTTPServer.assetPath(requestTarget: "/abc/web-prototype/src/hint-worker.js?v=1", token: "abc"), "web-prototype/src/hint-worker.js")
        for target in ["/wrong/web-prototype/index.html", "/abc/../save.json", "/abc/web-prototype/%2e%2e/save.json",
                       "/abc/web-prototype/%252e%252e/save.json", "/abc/web-prototype/../data/levels_seed.json",
                       "/abc/web-prototype\\save.json", "/abc/.git/config", "/abc/ios/Config/Info.plist",
                       "/abc/data/level-verification.json", "/abc/web-prototype/%00foo", "http://evil.invalid/"] {
            XCTAssertNil(LoopbackHTTPServer.assetPath(requestTarget: target, token: "abc"), target)
        }
    }

    func testBridgeRejectsOtherOriginPortPageAndFragments() throws {
        let entry = try XCTUnwrap(URL(string: "http://localhost:12345/abc/web-prototype/index.html"))
        XCTAssertTrue(NativeBridge.isGamePage(entry, entry: entry))
        for string in ["http://localhost:12346/abc/web-prototype/index.html", "https://localhost:12345/abc/web-prototype/index.html",
                       "http://evil.invalid:12345/abc/web-prototype/index.html", "http://localhost:12345/abc/web-prototype/src/hint-worker.js",
                       "http://localhost:12345/abc/web-prototype/index.html?x=1", "http://localhost:12345/abc/web-prototype/index.html#x"] {
            XCTAssertFalse(NativeBridge.isGamePage(URL(string: string), entry: entry), string)
        }
    }

    func testPackagedAssetsAndLiveLoopbackHTTP() async throws {
        let root = try XCTUnwrap(Bundle.main.url(forResource: "WebBundle", withExtension: nil))
        let store = try BundleAssetStore(root: root)
        XCTAssertNotNil(store.assets["web-prototype/src/hint-worker.js"])
        XCTAssertNil(store.assets["data/level-verification.json"])
        let server = LoopbackHTTPServer(store: store)
        defer { server.stop() }
        let entry: URL = try await withCheckedThrowingContinuation { continuation in
            server.start { continuation.resume(with: $0) }
        }
        let session = URLSession(configuration: .ephemeral)
        defer { session.invalidateAndCancel() }
        let (body, response) = try await session.data(from: entry)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual(body, store.assets[store.entry]?.data)
        let worker = try XCTUnwrap(URL(string: "src/hint-worker.js", relativeTo: entry)?.absoluteURL)
        let (_, workerResponse) = try await session.data(from: worker)
        XCTAssertEqual((workerResponse as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual((workerResponse as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type"), "text/javascript; charset=utf-8")
        let stylesheet = try XCTUnwrap(URL(string: "presentation.css", relativeTo: entry)?.absoluteURL)
        let (css, cssResponse) = try await session.data(from: stylesheet)
        XCTAssertEqual((cssResponse as? HTTPURLResponse)?.statusCode, 200)
        XCTAssertEqual((cssResponse as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type"), "text/css; charset=utf-8")
        XCTAssertEqual(css, store.assets["web-prototype/presentation.css"]?.data)
        var post = URLRequest(url: entry)
        post.httpMethod = "POST"
        let (_, denied) = try await session.data(for: post)
        XCTAssertEqual((denied as? HTTPURLResponse)?.statusCode, 405)
        var components = try XCTUnwrap(URLComponents(url: entry, resolvingAgainstBaseURL: false))
        components.path = "/wrong/web-prototype/index.html"
        let (_, missing) = try await session.data(from: XCTUnwrap(components.url))
        XCTAssertEqual((missing as? HTTPURLResponse)?.statusCode, 404)
    }
}
