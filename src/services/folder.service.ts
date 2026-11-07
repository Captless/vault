import { db } from '../db/database';
import { getVaultKey, getFolderKey } from './crypto.service';
import { encryptJson, decryptJson, encryptBytes, decryptBytes } from '../security/encryption';
import { randomBytes, toB64 } from '../security/kdf';
import type { DbFolder, FolderMeta } from '../types';

export function newId() { return toB64(randomBytes(12)).replace(/[^a-zA-Z0-9]/g, ''); }

export async function listFolders(parentId: string | null) {
  return db.folders.filter(f => f.parentId === parentId).toArray();
}

export async function createFolder(parentId: string | null, name: string, protection: 'unprotected'|'protected' = 'unprotected', key?: CryptoKey | null) {
  const meta: FolderMeta = { name };
  const useKey = key ?? getVaultKey()!;
  const env = await encryptJson(useKey, meta, 'folder-meta');
  // Vault-encrypted display name so the title stays visible while locked.
  let nameEncVault: string | undefined;
  let nameIvVault: string | undefined;
  const vk = getVaultKey();
  if (vk) {
    const nv = await encryptJson(vk, meta, 'folder-name-vault');
    nameEncVault = nv.ct;
    nameIvVault = nv.iv;
  }
  const f: DbFolder = {
    id: newId(),
    parentId,
    protection,
    keyId: protection === 'protected' ? undefined : undefined,
    metaEnc: env.ct,
    metaIv: env.iv,
    nameEncVault,
    nameIvVault,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    cryptoVersion: 1
  };
  await db.folders.add(f);
  return f;
}

export async function protectFolder(f: DbFolder, folderKey: CryptoKey) {
  const meta = await getFolderMeta(f);
  const env = await encryptJson(folderKey, meta, 'folder-meta');
  const vk = getVaultKey();
  let vaultNameFields: Partial<DbFolder> = {};
  if (vk) {
    const nv = await encryptJson(vk, meta, 'folder-name-vault');
    vaultNameFields = { nameEncVault: nv.ct, nameIvVault: nv.iv };
  }
  await db.folders.update(f.id, { protection: 'protected', metaEnc: env.ct, metaIv: env.iv, ...vaultNameFields, updatedAt: Date.now() });
  // Re-encrypt all items in this folder (and recursively subfolders) with the folder DEK
  const { listItems } = await import('./item.service');
  const items = await listItems(f.id);
  if (vk) {
    for (const it of items) {
      try {
        const im = await decryptJson<any>(vk, { iv: it.metaIv, ct: it.metaEnc }, 'item-meta');
        const nm = await encryptJson(folderKey, im, 'item-meta');
        let npEnc = it.payloadEnc; let npIv = it.payloadIv;
        if (it.payloadEnc && it.payloadIv) {
          const plain = await decryptBytes(vk, { iv: it.payloadIv, ct: it.payloadEnc }, 'item-payload');
          const np = await encryptBytes(folderKey, plain, 'item-payload');
          npEnc = np.ct; npIv = np.iv;
        }
        await db.items.update(it.id, { metaEnc: nm.ct, metaIv: nm.iv, payloadEnc: npEnc, payloadIv: npIv, updatedAt: Date.now() });
      } catch { /* skip locked/undecryptable */ }
    }
  }
  // Recurse into subfolders: re-encrypt their metas with the folder key
  const children = await db.folders.where('parentId').equals(f.id).toArray();
  for (const c of children) await protectFolder(c, folderKey);
  // Forget the key so reopening requires the password
  const { setFolderKey } = await import('./crypto.service');
  setFolderKey(f.id, null);
}

export async function unprotectFolder(f: DbFolder) {
  const meta = await getFolderMeta(f);
  const vk = getVaultKey()!;
  const folderKey = getFolderKey(f.id);
  const env = await encryptJson(vk, meta, 'folder-meta');
  await db.folders.update(f.id, { protection: 'unprotected', metaEnc: env.ct, metaIv: env.iv, updatedAt: Date.now() });
  if (folderKey) {
    const { listItems } = await import('./item.service');
    const items = await listItems(f.id);
    for (const it of items) {
      try {
        const im = await decryptJson<any>(folderKey, { iv: it.metaIv, ct: it.metaEnc }, 'item-meta');
        const nm = await encryptJson(vk, im, 'item-meta');
        let npEnc = it.payloadEnc; let npIv = it.payloadIv;
        if (it.payloadEnc && it.payloadIv) {
          const plain = await decryptBytes(folderKey, { iv: it.payloadIv, ct: it.payloadEnc }, 'item-payload');
          const np = await encryptBytes(vk, plain, 'item-payload');
          npEnc = np.ct; npIv = np.iv;
        }
        await db.items.update(it.id, { metaEnc: nm.ct, metaIv: nm.iv, payloadEnc: npEnc, payloadIv: npIv, updatedAt: Date.now() });
      } catch { /* skip */ }
    }
  }
}

export async function getFolderMeta(f: DbFolder): Promise<FolderMeta> {
  // determine key
  let key = getVaultKey()!;
  if (f.protection === 'protected') {
    const fk = getFolderKey(f.id);
    if (fk) {
      return decryptJson<FolderMeta>(fk, { iv: f.metaIv, ct: f.metaEnc }, 'folder-meta');
    }
    // Locked: show the vault-encrypted display name only (contents stay hidden).
    if (f.nameEncVault && f.nameIvVault && key) {
      try {
        return await decryptJson<FolderMeta>(key, { iv: f.nameIvVault, ct: f.nameEncVault }, 'folder-name-vault');
      } catch { /* fall through */ }
    }
    // Legacy locked folders without a vault name: attempt vault-key decrypt
    // (pre-vault-name records) then give up so caller falls back to 'Folder'.
    return decryptJson<FolderMeta>(key, { iv: f.metaIv, ct: f.metaEnc }, 'folder-meta');
  }
  return decryptJson<FolderMeta>(key, { iv: f.metaIv, ct: f.metaEnc }, 'folder-meta');
}

export async function renameFolder(f: DbFolder, name: string) {
  let key = getVaultKey()!;
  if (f.protection === 'protected') { const fk = getFolderKey(f.id); if (fk) key = fk; }
  const env = await encryptJson(key, { name } as FolderMeta, 'folder-meta');
  const vk = getVaultKey();
  let vaultNameFields: Partial<DbFolder> = {};
  if (vk) {
    const nv = await encryptJson(vk, { name } as FolderMeta, 'folder-name-vault');
    vaultNameFields = { nameEncVault: nv.ct, nameIvVault: nv.iv };
  }
  await db.folders.update(f.id, { metaEnc: env.ct, metaIv: env.iv, ...vaultNameFields, updatedAt: Date.now() });
}

export async function deleteFolder(id: string) {
  // cascade
  const children = await db.folders.where('parentId').equals(id).toArray();
  for (const c of children) await deleteFolder(c.id);
  const items = await db.items.where('parentId').equals(id).toArray();
  for (const it of items) {
    await db.blobs.where('itemId').equals(it.id).delete();
    await db.decoys.where('itemId').equals(it.id).delete();
    await db.items.delete(it.id);
  }
  await db.folderKeys.delete(id);
  await db.decoyTrees.delete(id);
  await db.folders.delete(id);
}