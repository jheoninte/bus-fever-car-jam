import Foundation

struct PurchaseDefinition {
    enum Kind { case consumable, nonConsumable }
    let kind: Kind
    let coins: Int
    let shuffles: Int
    let vip: Int
}

enum PurchaseCatalog {
    static let removeAds = "com.busfever.removeads"
    static let starter = "com.busfever.starterbundle"
    // validate:platform checks these amounts/types against the web catalog.
    static let products: [String: PurchaseDefinition] = [
        "com.busfever.removeads": .init(kind: .nonConsumable, coins: 0, shuffles: 0, vip: 0),
        "com.busfever.starterbundle": .init(kind: .nonConsumable, coins: 600, shuffles: 5, vip: 3),
        "com.busfever.coinpack.small": .init(kind: .consumable, coins: 1200, shuffles: 0, vip: 0),
        "com.busfever.coinpack.medium": .init(kind: .consumable, coins: 3500, shuffles: 0, vip: 0)
    ]
}

// Constructed only after StoreKit returns .verified. No bridge accepts a grant or JWS from JS.
struct VerifiedPurchase {
    let transactionID: String
    let productID: String
    let quantity: Int
    var grantStarterContents = true
}

struct DeliveredPurchase: Codable, Equatable {
    let productID: String
    let quantity: Int
}

struct PurchaseJournal: Codable {
    var version = 1
    var revision = 0
    var delivered: [String: DeliveredPurchase] = [:]
    var ownedProducts: Set<String> = []
}
