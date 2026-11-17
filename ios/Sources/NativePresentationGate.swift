import Foundation

// All native payment, consent and ad presenters share this main-actor lease.
@MainActor
final class NativePresentationGate {
    private var owner: UUID?
    func acquire() -> UUID? {
        guard owner == nil else { return nil }
        let token = UUID()
        owner = token
        return token
    }
    func release(_ token: UUID) { if owner == token { owner = nil } }
}
