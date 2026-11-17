import { findPublicHint } from './hint-engine.js';

self.onmessage = event => {
  try { self.postMessage(findPublicHint(event.data)); }
  catch { self.postMessage({ status: 'unavailable' }); }
};
