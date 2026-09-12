// Device-only temporary copies. These owner labels never replace server authorization.
export const SHARE_CACHE = 'lb-share-inbox';
const OWNER_CACHE = 'lb-share-owner';
export const SHARE_TTL = 15 * 60 * 1000;
let revision = 0, owner = null, tail = Promise.resolve();
export function syncShareOwner(nextOwner) {
  const next = nextOwner || null;
  if (next !== owner) { owner = next; revision++; }
  const expected = revision;
  const job = tail.then(async () => {
    if (expected !== revision || typeof caches === 'undefined') return;
    const cache = await caches.open(OWNER_CACHE);
    const previous = await cache.match('/__share_owner');
    const record = previous ? await previous.json() : null;
    if (record?.owner !== next || !next) await caches.delete(SHARE_CACHE);
    if (expected !== revision) return;
    if (!next) { await caches.delete(OWNER_CACHE); return; }
    await cache.put('/__share_owner', new Response(JSON.stringify({owner:next, nonce:record?.owner === next ? record.nonce : crypto.randomUUID(), expires:Date.now()+SHARE_TTL})));
    if (expected !== revision) await caches.delete(OWNER_CACHE);
  });
  tail = job.catch(() => {});
  return job;
}
export async function clearSharedFiles() {
  owner = null; revision++;
  if (typeof caches === 'undefined') return;
  await tail;
  await Promise.all([caches.delete(OWNER_CACHE), caches.delete(SHARE_CACHE)]);
}
export async function validSharedResponse(response, userId) {
  const expiry = Number(response?.headers.get('x-share-expires'));
  if (!userId || response?.headers.get('x-share-owner') !== userId || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now()+SHARE_TTL) return false;
  const marker = await (await caches.open(OWNER_CACHE)).match('/__share_owner');
  const record = marker ? await marker.json() : null;
  return !!record && record.owner === userId && record.nonce === response.headers.get('x-share-nonce') && record.expires > Date.now();
}
