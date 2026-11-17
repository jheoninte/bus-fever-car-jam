import Foundation

// A reward is earned only by the SDK reward event, and delivered once after dismissal.
struct AdOutcomeState {
    private(set) var earnedReward = false
    private(set) var presented = false
    private(set) var finished = false

    mutating func recordPresentation() { if !finished { presented = true } }
    mutating func recordReward() { if !finished { earnedReward = true } }
    mutating func finish(failed: Bool) -> (completed: Bool, shown: Bool)? {
        guard !finished else { return nil }
        finished = true
        return (!failed && earnedReward, !failed && presented)
    }
}
