import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('../app/command-center/views/carrier360.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../app/shared/api.js', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../migrations/bl_fleet_0314_first_truck_reminder.sql', import.meta.url), 'utf8');

assert.match(view, /ccFleetTruckRemind\(orgId\)/, 'Fleet card must invoke the truck reminder RPC');
assert.match(view, /Last truck reminder:/, 'Fleet card must show the last manual send time');
assert.match(view, /Last auto onboarding:/, 'Fleet card must show the existing automatic onboarding time');
assert.match(view, /automatic first-truck reminders are not enabled/, 'UI must not mislabel general onboarding nags as truck reminders');
assert.match(view, /Reminder history/, 'Fleet card must expose recent reminder history');

assert.match(api, /rpc\('cc_fleet_truck_remind'/, 'API wrapper for the send RPC is missing');
assert.match(api, /rpc\('cc_fleet_truck_reminder_status'/, 'API wrapper for the status RPC is missing');

assert.match(migration, /template_key = 'fleet\.first_truck_reminder'/, 'Fleet reminder must have its own template key');
assert.match(migration, /interval '6 hours'/, 'Manual reminder cooldown must remain in force');
assert.match(migration, /'url', '\/app\/carrier\/#fleet\/add-truck'/, 'In-app CTA must deep-link to Add truck');
assert.match(migration, /'source', 'manual'/, 'Reminder history must distinguish manual sends');
assert.match(migration, /app_private\.audit_logs/, 'Manual staff sends must be audited');
assert.match(migration, /revoke all on function public\.cc_fleet_truck_remind\(uuid\) from anon, public/, 'Send RPC must not be anon-executable');

console.log('carrier fleet reminder regression checks passed');
