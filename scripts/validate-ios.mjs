import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const release = process.argv.includes('--release');
const config = await readFile(new URL(`ios/Config/${release ? 'Release' : 'Debug'}.xcconfig`, root), 'utf8');
const values = Object.fromEntries([...config.matchAll(/^(\w+)\s*=\s*(.*?)\s*$/gm)].map(([, key, value]) => [key, value]));
for (const key of ['ADMOB_APP_ID', 'ADMOB_INTERSTITIAL_ID', 'ADMOB_REWARDED_ID']) {
  const pattern = key === 'ADMOB_APP_ID' ? /^ca-app-pub-\d{16}~\d{10}$/ : /^ca-app-pub-\d{16}\/\d{10}$/;
  assert.match(values[key] || '', pattern, `${key}: ${release ? '운영 AdMob ID를 입력해야 합니다.' : '테스트 ID 형식 오류'}`);
  assert.equal(values[key].includes('3940256099942544'), !release, `${key}: 광고 환경 불일치`);
}
const plist = await readFile(new URL('ios/Config/Info.plist', root), 'utf8');
for (const key of ['NSUserTrackingUsageDescription', 'GADApplicationIdentifier', 'SKAdNetworkItems']) assert.ok(plist.includes(`<key>${key}</key>`));
for (const key of ['ADMOB_APP_ID', 'ADMOB_INTERSTITIAL_ID', 'ADMOB_REWARDED_ID']) assert.ok(plist.includes(`$(${key})`));
const entitlements = await readFile(new URL('ios/Config/BusFever.entitlements', root), 'utf8');
assert.ok(entitlements.includes('com.apple.developer.ubiquity-kvstore-identifier'));
console.log(`iOS ${release ? 'release IDs' : 'template'} validation passed. Native compilation/device QA still required.`);
