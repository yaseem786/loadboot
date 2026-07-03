// storage.js — carrier-facing document uploads to the private `documents` bucket.
// Files are stored under the uploader's own user folder (`{auth.uid()}/…`), which is
// exactly what the storage RLS policy (doc_read/doc_upload) and the documents-table
// trigger require. Staff read via admin/signed URLs; carriers read only their own.
import { getClient } from './supabaseClient.js';
import { getUser } from './session.js';

const BUCKET = 'documents';
const safeName = (n) => (n || 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);
const rand = () => Math.random().toString(36).slice(2, 10);

// Upload a File/Blob; returns { path, fileName, contentType, size } for the metadata RPC.
export async function uploadDocument(file, kind) {
  if (!file) throw new Error('No file selected.');
  if (file.size > 25 * 1024 * 1024) throw new Error('File is larger than 25 MB.');
  const sb = await getClient();
  const user = await getUser();
  if (!user) throw new Error('Please sign in again.');
  const path = `${user.id}/${kind || 'other'}/${Date.now()}-${rand()}-${safeName(file.name)}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream', upsert: false,
  });
  if (error) throw new Error(error.message || 'Upload failed.');
  return { path, fileName: file.name, contentType: file.type || null, size: file.size || null };
}

// Proof-of-delivery upload. Enforces the private-bucket path contract that the server re-validates:
//   {auth.uid()}/pod/{tripId}/{immutable-name}
// The first folder must equal auth.uid() (storage doc_upload RLS); the server also re-checks the trip.
// Client-side validation mirrors the server (PDF/JPEG/PNG/WEBP, <=10 MB) so the user gets fast feedback.
const POD_ALLOWED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const POD_EXTMAP = { 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export async function uploadPodDocument(file, tripId) {
  if (!file) throw new Error('No file selected.');
  if (!tripId) throw new Error('Missing trip.');
  if (!POD_ALLOWED.includes(file.type)) throw new Error('Unsupported file type. Allowed: PDF, JPG, PNG, WEBP.');
  if (file.size <= 0) throw new Error('That file is empty.');
  if (file.size > 10 * 1024 * 1024) throw new Error('File is larger than 10 MB.');
  const sb = await getClient();
  const user = await getUser();
  if (!user) throw new Error('Please sign in again.');
  const ext = POD_EXTMAP[file.type] || 'bin';
  const path = `${user.id}/pod/${tripId}/${Date.now()}-${rand()}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message || 'Upload failed.');
  return { path, fileName: file.name, contentType: file.type, size: file.size };
}

const AVATAR_ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AVATAR_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
// Upload a profile avatar image under {auth.uid()}/avatar/... (own-folder RLS). Returns { path }.
export async function uploadAvatar(file) {
  if (!file) throw new Error('No image selected.');
  if (!AVATAR_ALLOWED.includes(file.type)) throw new Error('Please choose a JPG, PNG, WEBP or GIF image.');
  if (file.size <= 0) throw new Error('That image is empty.');
  if (file.size > 5 * 1024 * 1024) throw new Error('Image is larger than 5 MB.');
  const sb = await getClient();
  const user = await getUser();
  if (!user) throw new Error('Please sign in again.');
  const ext = AVATAR_EXT[file.type] || 'img';
  const path = `${user.id}/avatar/${Date.now()}-${rand()}.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message || 'Upload failed.');
  return { path, fileName: file.name, contentType: file.type, size: file.size };
}

// Short-lived signed URL so a carrier can re-download their own document.
export async function signedDocumentUrl(path, expiresSeconds = 300) {
  const sb = await getClient();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, expiresSeconds);
  if (error) throw new Error(error.message || 'Could not create a link.');
  return data && data.signedUrl;
}

export default { uploadDocument, uploadPodDocument, uploadAvatar, signedDocumentUrl };
