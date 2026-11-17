import { PRODUCT_CATALOG } from './economy-config.js';
import { applyNativePurchaseSnapshot } from './purchase-state.js';

export function createPurchaseDelivery(state, platform, persist) {
  let queue = Promise.resolve();
  return transaction => {
    const deliver = async () => {
      if (transaction?.success !== true || typeof transaction.transactionId !== 'string' || !transaction.transactionId ||
          !PRODUCT_CATALOG.some(product => product.id === transaction.productId)) throw new Error('invalid_transaction');
      if (platform.capabilities?.nativePurchaseDelivery !== true) throw new Error('native_purchase_delivery_required');
      const previous = state.deliveredTransactions?.[transaction.transactionId];
      if (previous && previous !== transaction.productId) throw new Error('transaction_product_mismatch');
      const saved = await persist('iap_before_delivery');
      if (saved?.persisted !== true) throw new Error('purchase_save_failed');
      const committed = await platform.commitPurchase(transaction.productId, transaction.transactionId);
      if (committed?.persisted !== true) throw new Error('purchase_commit_failed');
      applyNativePurchaseSnapshot(state, committed.snapshot);
      const finished = await platform.finishTransaction(transaction.transactionId);
      return { message: committed.duplicate ? '이미 처리된 구매를 확인했습니다.' : '구매 보상이 저장되었습니다.', finished, duplicate: committed.duplicate === true };
    };
    const result = queue.then(deliver, deliver);
    queue = result.catch(() => {});
    return result;
  };
}
