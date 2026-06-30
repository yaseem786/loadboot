// permissions.js — client-side permission cache for UI HIDING ONLY.
// The server re-checks every privileged action (RLS + RPC). Hiding a control here is
// a convenience, never a security boundary: a hidden button still cannot perform an
// unauthorized action because the RPC denies it.
import { getMyStaffContext } from './api.js';

let _ctx = null;

export async function loadStaffContext(force = false) {
  if (_ctx && !force) return _ctx;
  const raw = await getMyStaffContext();
  _ctx = {
    isStaff: !!(raw && raw.is_staff),
    permissions: new Set((raw && raw.permissions) || []),
  };
  return _ctx;
}

export function can(permission) {
  return !!(_ctx && _ctx.permissions.has(permission));
}

export function isStaff() {
  return !!(_ctx && _ctx.isStaff);
}

export function clearStaffContext() { _ctx = null; }

export default { loadStaffContext, can, isStaff, clearStaffContext };
