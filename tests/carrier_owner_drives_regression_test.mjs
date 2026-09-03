import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../app/carrier/app.js', import.meta.url), 'utf8');

assert.match(
  source,
  /ownerDrives:\s*f\.owner_drives\s*\|\|\s*null/,
  'Step 2 must send the selected owner/employed/both value to the profile RPC.',
);

assert.doesNotMatch(
  source,
  /ownerDrives:[^,\n]*String\(f\.truck_count\)/,
  'Step 2 must never send the truck count as owner_drives.',
);

console.log('carrier owner_drives regression: ok');
