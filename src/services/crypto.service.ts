import { db } from '../db/database';
import { DEFAULT_KDF, deriveKey, randomBytes, toB64, fromB64 } from '../security/kdf';
import { importAesKey, encryptJson, decryptJson, encryptBytes, decryptBytes } from '../security/encryption';
import type { VaultMeta, DbFolderKey } from '../types';

let vaultKey: CryptoKey | null = null;
let folderKeys = new Map<string, CryptoKey>();

export function getVaultKey() { return vaultKey; }
export function setVaultKey(k: CryptoKey | null) { vaultKey = k; }
export function getFolderKey(id: string) { return folderKeys.get(id) ?? null; }
export function setFolderKey(id: string, k: CryptoKey | null) {
  if (k) folderKeys.set(id, k); else folderKeys.delete(id);
}
export function clearAllFolderKeys() { folderKeys.clear(); }
export function clearSession() {
  vaultKey = null;
  folderKeys.clear();
  try { sessionStorage.removeItem('vault-unlocked'); } catch { /* ignore */ }
}

export async function persistSession() {
  if (!vaultKey) return;
  try {
    const jwk = await crypto.subtle.exportKey('jwk', vaultKey);
    sessionStorage.setItem('vault-unlocked', JSON.stringify(jwk));
  } catch { /* ignore */ }
}

export async function restoreSession(): Promise<boolean> {
  try {
    const raw = sessionStorage.getItem('vault-unlocked');
    if (!raw) return false;
    const jwk = JSON.parse(raw);
    vaultKey = await crypto.subtle.importKey('jwk', jwk, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt']);
    // Folder keys intentionally NOT restored: locked folders must re-prompt for password on reload.
    folderKeys.clear();
    return true;
  } catch {
    return false;
  }
}

export async function setupVault(password: string) {
  const salt = randomBytes(16);
  const raw = await deriveKey(password, salt, DEFAULT_KDF);
  const wrapKey = await importAesKey(raw);
  const dekRaw = randomBytes(32);
  const dek = await importAesKey(dekRaw);
  // wrap dek with wrapKey
  const wrapped = await encryptBytes(wrapKey, dekRaw, 'vault-dek');
  const verify = await encryptJson(wrapKey, { ok: true }, 'vault-verify');
  const meta: VaultMeta = {
    id: 'vault',
    schemaVersion: 1,
    kdf: 'argon2id',
    salt: toB64(salt),
    params: JSON.stringify(DEFAULT_KDF),
    wrappedDek: wrapped.ct,
    wrapIv: wrapped.iv,
    verifyEnc: verify.ct,
    verifyIv: verify.iv,
    createdAt: Date.now(),
    settings: {}
  };
  await db.vaultMeta.put(meta);
  vaultKey = dek;
  await persistSession();
  // store dek raw? no. keep in memory. Persist wrapped only.
  // Need dekRaw for future? re-derive on login. OK.
  void dekRaw;
}

export async function loginVault(password: string): Promise<boolean> {
  const meta = await db.vaultMeta.get('vault');
  if (!meta) return false;
  const params = JSON.parse(meta.params);
  const salt = fromB64(meta.salt);
  const raw = await deriveKey(password, salt, params);
  const wrapKey = await importAesKey(raw);
  try {
    const dekRaw = await decryptBytes(wrapKey, { iv: meta.wrapIv, ct: meta.wrappedDek }, 'vault-dek');
    const v = await decryptJson<{ ok: boolean }>(wrapKey, { iv: meta.verifyIv, ct: meta.verifyEnc }, 'vault-verify');
    if (!v.ok) return false;
    vaultKey = await importAesKey(dekRaw);
    await persistSession();
    return true;
  } catch {
    return false;
  }
}

export async function changeMasterPassword(current: string, next: string): Promise<boolean> {
  // verify current
  const ok = await loginVault(current);
  if (!ok) return false;
  // unwrap
  const meta = await db.vaultMeta.get('vault');
  if (!meta) return false;
  const params = JSON.parse(meta.params);
  const salt = fromB64(meta.salt);
  const raw = await deriveKey(current, salt, params);
  const wrapKey = await importAesKey(raw);
  const dekRaw = await decryptBytes(wrapKey, { iv: meta.wrapIv, ct: meta.wrappedDek }, 'vault-dek');

  const newSalt = randomBytes(16);
  const newRaw = await deriveKey(next, newSalt, DEFAULT_KDF);
  const newWrap = await importAesKey(newRaw);
  const wrapped = await encryptBytes(newWrap, dekRaw, 'vault-dek');
  const verify = await encryptJson(newWrap, { ok: true }, 'vault-verify');
  await db.vaultMeta.update('vault', {
    salt: toB64(newSalt),
    params: JSON.stringify(DEFAULT_KDF),
    wrappedDek: wrapped.ct,
    wrapIv: wrapped.iv,
    verifyEnc: verify.ct,
    verifyIv: verify.iv
  });
  vaultKey = await importAesKey(dekRaw);
  return true;
}

export async function setupFolderKey(folderId: string, password: string) {
  const salt = randomBytes(16);
  const params = DEFAULT_KDF;
  const raw = await deriveKey(password, salt, params);
  const wrapKey = await importAesKey(raw);
  const dekRaw = randomBytes(32);
  const dek = await importAesKey(dekRaw);
  const wrapped = await encryptBytes(wrapKey, dekRaw, 'folder-dek:' + folderId);
  const verify = await encryptJson(wrapKey, { ok: true }, 'folder-verify:' + folderId);
  const fk: DbFolderKey = {
    id: folderId,
    folderId,
    algo: 'argon2id',
    salt: toB64(salt),
    params: JSON.stringify(params),
    wrappedDek: wrapped.ct,
    wrapIv: wrapped.iv,
    verifyEnc: verify.ct,
    verifyIv: verify.iv
  };
  await db.folderKeys.put(fk);
  setFolderKey(folderId, dek);
  return dek;
}

export async function unlockFolder(folderId: string, password: string): Promise<boolean> {
  const fk = await db.folderKeys.get(folderId);
  if (!fk) return false;
  const params = JSON.parse(fk.params);
  const salt = fromB64(fk.salt);
  const raw = await deriveKey(password, salt, params);
  const wrapKey = await importAesKey(raw);
  try {
    const dekRaw = await decryptBytes(wrapKey, { iv: fk.wrapIv, ct: fk.wrappedDek }, 'folder-dek:' + folderId);
    const v = await decryptJson<{ ok: boolean }>(wrapKey, { iv: fk.verifyIv, ct: fk.verifyEnc }, 'folder-verify:' + folderId);
    if (!v.ok) return false;
    setFolderKey(folderId, await importAesKey(dekRaw));
    return true;
  } catch {
    return false;
  }
}