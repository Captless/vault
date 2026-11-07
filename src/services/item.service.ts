import { db } from '../db/database';
import { getVaultKey, getFolderKey } from './crypto.service';
import { encryptJson, decryptJson, encryptBytes, decryptBytes } from '../security/encryption';
import { newId } from './folder.service';
import type { DbItem, ItemMeta, ItemKind } from '../types';

export async function resolveKeyForParent(parentId: string | null): Promise<CryptoKey | null> {
  // walk up
  let cur = parentId;
  const chain: string[] = [];
  while (cur) {
    chain.unshift(cur);
    const f = await db.folders.get(cur);
    if (!f) return null;
    cur = f.parentId;
  }
  // find nearest protected ancestor from root down
  let key = getVaultKey();
  for (const fid of chain) {
    const f = await db.folders.get(fid);
    if (!f) return null;
    if (f.protection === 'protected') {
      const fk = getFolderKey(fid);
      if (!fk) return null; // locked
      key = fk;
    }
  }
  return key;
}

export async function listItems(parentId: string | null) {
  return db.items.filter(i => i.parentId === parentId).toArray();
}

export async function createTxt(parentId: string | null, name: string) {
  const key = await resolveKeyForParent(parentId);
  if (!key) throw new Error('locked');
  const meta: ItemMeta = { name, size: 0 };
  const m = await encryptJson(key, meta, 'item-meta');
  const p = await encryptBytes(key, new TextEncoder().encode(''), 'item-payload');
  const it: DbItem = {
    id: newId(), parentId, kind: 'txt', scope: 'vault',
    metaEnc: m.ct, metaIv: m.iv,
    payloadEnc: p.ct, payloadIv: p.iv,
    size: 0,
    createdAt: Date.now(), updatedAt: Date.now(), cryptoVersion: 1
  };
  await db.items.add(it);
  return it;
}

export async function createMd(parentId: string | null, name: string) {
  const it = await createTxt(parentId, name);
  await db.items.update(it.id, { kind: 'md' });
  return { ...it, kind: 'md' as ItemKind };
}

export async function getItemMeta(it: DbItem): Promise<ItemMeta> {
  const key = await resolveKeyForParent(it.parentId);
  if (!key) throw new Error('locked');
  return decryptJson<ItemMeta>(key, { iv: it.metaIv, ct: it.metaEnc }, 'item-meta');
}

export async function readText(it: DbItem): Promise<string> {
  const key = await resolveKeyForParent(it.parentId);
  if (!key) throw new Error('locked');
  const bytes = await decryptBytes(key, { iv: it.payloadIv!, ct: it.payloadEnc! }, 'item-payload');
  return new TextDecoder().decode(bytes);
}

export async function writeText(it: DbItem, text: string) {
  const key = await resolveKeyForParent(it.parentId);
  if (!key) throw new Error('locked');
  const encoded = new TextEncoder().encode(text);
  const p = await encryptBytes(key, encoded, 'item-payload');
  let metaEnc = it.metaEnc; let metaIv = it.metaIv;
  try {
    const meta = await decryptJson<ItemMeta>(key, { iv: it.metaIv, ct: it.metaEnc }, 'item-meta');
    meta.size = encoded.byteLength;
    const m = await encryptJson(key, meta, 'item-meta');
    metaEnc = m.ct; metaIv = m.iv;
  } catch { /* keep existing meta if decrypt fails */ }
  await db.items.update(it.id, { payloadEnc: p.ct, payloadIv: p.iv, metaEnc, metaIv, size: encoded.byteLength, updatedAt: Date.now() });
}

export async function renameItem(it: DbItem, name: string) {
  const key = await resolveKeyForParent(it.parentId);
  if (!key) throw new Error('locked');
  const meta = await getItemMeta(it);
  meta.name = name;
  const m = await encryptJson(key, meta, 'item-meta');
  await db.items.update(it.id, { metaEnc: m.ct, metaIv: m.iv, updatedAt: Date.now() });
}

export async function deleteItem(id: string) {
  await db.blobs.where('itemId').equals(id).delete();
  await db.decoys.where('itemId').equals(id).delete();
  await db.items.delete(id);
}

export async function uploadFile(parentId: string | null, file: File, onProgress?: (p:number)=>void) {
  const key = await resolveKeyForParent(parentId);
  if (!key) throw new Error('locked');
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const meta: ItemMeta = { name: file.name, mime: file.type, size: file.size };
  const m = await encryptJson(key, meta, 'item-meta');
  const p = await encryptBytes(key, bytes, 'item-payload');
  onProgress?.(100);
  const it: DbItem = {
    id: newId(), parentId, kind: 'file', scope: 'vault',
    metaEnc: m.ct, metaIv: m.iv,
    payloadEnc: p.ct, payloadIv: p.iv,
    mime: file.type, size: file.size,
    createdAt: Date.now(), updatedAt: Date.now(), cryptoVersion: 1
  };
  await db.items.add(it);
  return it;
}

export async function readFileItem(it: DbItem): Promise<{ bytes: Uint8Array; mime: string; name: string }> {
  const key = await resolveKeyForParent(it.parentId);
  if (!key) throw new Error('locked');
  if (!it.payloadIv || !it.payloadEnc) throw new Error('No file data');
  const ab = await decryptBytes(key, { iv: it.payloadIv, ct: it.payloadEnc }, 'item-payload');
  const bytes = new Uint8Array(ab);
  let name = 'file';
  let mime = it.mime || '';
  try {
    const meta = await decryptJson<ItemMeta>(key, { iv: it.metaIv, ct: it.metaEnc }, 'item-meta');
    if (meta.name) name = meta.name;
    if (meta.mime) mime = meta.mime;
  } catch { /* use fallbacks */ }
  if (!mime) {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') mime = 'application/pdf';
    else if (['png','jpg','jpeg','gif','webp','bmp','svg','avif'].includes(ext)) mime = `image/${ext === 'jpg' ? 'jpeg' : ext === 'svg' ? 'svg+xml' : ext}`;
  }
  return { bytes, mime, name };
}