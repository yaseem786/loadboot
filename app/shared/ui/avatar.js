// avatar.js — self-contained profile-avatar editor (#31). Shows the user's own photo
// (or initials fallback) and lets them upload/replace it. Stored in the private
// documents bucket under {auth.uid()}/avatar/... and recorded via cc_set_my_avatar.
// Portable: uses plain DOM so any portal can mount it.
import { uploadAvatar, signedDocumentUrl } from '../storage.js';
import { setMyAvatar, myAvatar } from '../api.js';

function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
}

export async function mountAvatarEditor(host, opts = {}) {
  if (!host) return;
  const name = opts.name || '';
  const size = opts.size || 72;
  host.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;gap:14px;flex-wrap:wrap';

  const ring = document.createElement('div');
  ring.style.cssText = 'width:' + size + 'px;height:' + size + 'px;border-radius:50%;overflow:hidden;flex:none;' +
    'background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;display:flex;align-items:center;justify-content:center;' +
    'font-weight:800;font-size:' + Math.round(size / 2.6) + 'px;border:2px solid #e2e8f0';
  ring.textContent = initials(name);

  const info = document.createElement('div');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'Upload photo';
  btn.style.cssText = 'background:#0883F7;color:#fff;border:0;border-radius:9px;padding:9px 14px;font-weight:700;cursor:pointer;font-family:inherit';
  const hint = document.createElement('div');
  hint.style.cssText = 'color:#64748b;font-size:.82rem;margin-top:6px';
  hint.textContent = 'JPG, PNG, WEBP or GIF, up to 5 MB. This replaces the default logo avatar.';
  const status = document.createElement('div');
  status.style.cssText = 'font-size:.82rem;margin-top:4px';
  const file = document.createElement('input');
  file.type = 'file';
  file.accept = 'image/png,image/jpeg,image/webp,image/gif';
  file.style.display = 'none';

  async function showCurrent() {
    try {
      const r = await myAvatar();
      const path = r && r.avatar_path;
      if (path) {
        const url = await signedDocumentUrl(path, 600);
        if (url) { ring.textContent = ''; ring.style.background = '#fff';
          ring.innerHTML = '<img src="' + url + '" alt="avatar" style="width:100%;height:100%;object-fit:cover">'; }
        btn.textContent = 'Change photo';
      }
    } catch (_) {}
  }

  btn.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const f = file.files && file.files[0];
    if (!f) return;
    btn.disabled = true; btn.textContent = 'Uploading…'; status.textContent = '';
    try {
      const meta = await uploadAvatar(f);
      await setMyAvatar(meta.path);
      const url = await signedDocumentUrl(meta.path, 600);
      ring.textContent = ''; ring.style.background = '#fff';
      ring.innerHTML = '<img src="' + url + '" alt="avatar" style="width:100%;height:100%;object-fit:cover">';
      status.style.color = '#16a34a'; status.textContent = '✓ Photo updated';
      btn.textContent = 'Change photo';
    } catch (e) {
      status.style.color = '#dc2626'; status.textContent = (e && e.message) || 'Could not upload.';
      btn.textContent = 'Upload photo';
    }
    btn.disabled = false; file.value = '';
  });

  info.appendChild(btn); info.appendChild(hint); info.appendChild(status); info.appendChild(file);
  wrap.appendChild(ring); wrap.appendChild(info);
  host.appendChild(wrap);
  showCurrent();
}

export default mountAvatarEditor;
