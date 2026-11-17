import { SAVE_SCHEMA_VERSION } from './economy-config.js';

export function isFutureSave(save) {
  return save && Number.isInteger(save.schemaVersion) && save.schemaVersion > SAVE_SCHEMA_VERSION;
}

export function selectPreferredSave(localSave, cloudSave) {
  const candidates = [localSave, cloudSave].map((save, index) => ({ save, source: index ? 'cloud' : 'local' }))
    .filter(({ save }) => save && typeof save === 'object' && !Array.isArray(save) &&
      Number.isInteger(save.stage) && save.stage > 0 && Number.isFinite(save.score) && save.score >= 0 &&
      Number.isInteger(save.schemaVersion ?? 0) && (save.schemaVersion ?? 0) >= 0 && (save.schemaVersion ?? 0) <= SAVE_SCHEMA_VERSION &&
      Number.isFinite(save.updatedAt ?? 0) && (save.updatedAt ?? 0) >= 0);
  if (!candidates.length) return null;
  candidates.sort((a, b) => (b.save.updatedAt ?? 0) - (a.save.updatedAt ?? 0));
  const selected = candidates[0];
  return {
    ...selected.save,
    stage: Math.max(...candidates.map(({ save }) => save.stage)),
    score: Math.max(...candidates.map(({ save }) => save.score)),
    __source: selected.source
  };
}
