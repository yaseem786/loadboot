// Imported by generated /app/sw.js. Capture the owner before reading shared bytes.
self.lbStoreSharedFile = async function(request) {
  const marker = async () => {
    const r = await (await caches.open('lb-share-owner')).match('/__share_owner');
    return r ? r.json() : null;
  };
  const initial = await marker();
  if (!initial?.owner || !initial.nonce || initial.expires <= Date.now()) return false;
  const stillOwned = async () => {
    const now = await marker();
    return now?.owner === initial.owner && now?.nonce === initial.nonce && now?.expires > Date.now();
  };
  const fd = await request.formData(), file = fd.getAll('media')[0];
  if (!file?.size || file.size > 25*1024*1024 || !(await stillOwned())) return false;
  const cache = await caches.open('lb-share-inbox');
  for (const key of await cache.keys()) await cache.delete(key);
  if (!(await stillOwned())) return false;
  const key = '/__share/' + crypto.randomUUID();
  await cache.put(key, new Response(file, {headers:{
    'x-name':encodeURIComponent(file.name || 'shared-file'),
    'content-type':file.type || 'application/octet-stream',
    'x-share-owner':initial.owner, 'x-share-nonce':initial.nonce,
    'x-share-expires':String(Math.min(initial.expires,Date.now()+15*60*1000))
  }}));
  if (!(await stillOwned())) { await cache.delete(key); return false; }
  return true;
};
