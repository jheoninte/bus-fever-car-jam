import { getHintKey, projectHintState } from './hint-engine.js';

export function createHintClient({ createWorker = () => new Worker(new URL('./hint-worker.js', import.meta.url), { type: 'module' }),
  timeoutMs = 2500, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  let active = null;
  let cached = null;
  function cancel() {
    if (!active) return;
    const previous = active;
    active = null;
    unschedule(previous.timer);
    previous.worker.terminate();
    previous.resolve({ status: 'cancelled' });
  }
  return {
    get busy() { return active !== null; },
    cancel,
    async request(state) {
      if (active) return { status: 'busy' };
      const key = getHintKey(state);
      if (cached?.key === key) return { ...cached.result };
      let worker;
      try { worker = createWorker(); }
      catch { return { status: 'unavailable' }; }
      return new Promise(resolve => {
        const request = { worker, resolve, timer: null };
        active = request;
        const finish = result => {
          if (active !== request) return;
          active = null;
          unschedule(request.timer);
          worker.terminate();
          if (getHintKey(state) !== key) { resolve({ status: 'stale' }); return; }
          const allowed = ['recommended', 'finished', 'wait', 'budget_exhausted', 'invalid', 'unavailable', 'ambiguous'];
          const safe = allowed.includes(result?.status) ? result : { status: 'unavailable' };
          if (['recommended', 'ambiguous'].includes(safe.status)) cached = { key, result: safe };
          resolve(safe);
        };
        worker.onmessage = event => finish(event.data);
        worker.onerror = event => { event.preventDefault?.(); finish({ status: 'unavailable' }); };
        request.timer = schedule(() => finish({ status: 'budget_exhausted' }), timeoutMs);
        try { worker.postMessage(projectHintState(state)); }
        catch { finish({ status: 'unavailable' }); }
      });
    }
  };
}
