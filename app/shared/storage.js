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

// Short-lived signed URL so a carrier can re-download their own document.
export async function signedDocumentUrl(path, expiresSeconds = 300) {
  const sb = await getClient();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, expiresSeconds);
  if (error) throw new Error(error.message || 'Could not create a link.');
  return data && data.signedUrl;
}

export default { uploadDocument, signedDocumentUrl };
