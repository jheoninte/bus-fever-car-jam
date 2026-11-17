import XCTest
@testable import BusFever

final class AdOutcomeStateTests: XCTestCase {
    func testDismissWithoutRewardNeverGrants() {
        var state = AdOutcomeState()
        state.recordPresentation()
        let result = state.finish(failed: false)
        XCTAssertEqual(result?.completed, false)
        XCTAssertEqual(result?.shown, true)
    }

    func testRewardSettlesOnlyOnceAndAfterDismissal() {
        var state = AdOutcomeState()
        state.recordPresentation()
        state.recordReward()
        state.recordReward()
        XCTAssertFalse(state.finished)
        XCTAssertEqual(state.finish(failed: false)?.completed, true)
        XCTAssertNil(state.finish(failed: false))
        XCTAssertNil(state.finish(failed: true))
    }

    func testPresentationFailureNeverGrants() {
        var state = AdOutcomeState()
        state.recordReward()
        let result = state.finish(failed: true)
        XCTAssertEqual(result?.completed, false)
        XCTAssertEqual(result?.shown, false)
    }

    func testLateCallbacksCannotGrantAfterClose() {
        var state = AdOutcomeState()
        XCTAssertEqual(state.finish(failed: false)?.completed, false)
        state.recordReward()
        state.recordPresentation()
        XCTAssertFalse(state.earnedReward)
        XCTAssertFalse(state.presented)
        XCTAssertNil(state.finish(failed: false))
    }
}
