import { db } from '../db/database';
import { getVaultKey } from './crypto.service';
import { encryptJson, decryptJson, encryptBytes, decryptBytes } from '../security/encryption';
import { newId } from './folder.service';
import type { DecoyTree } from '../types';

// Per-document decoy (txt/md only): text shown for that exact doc in decoy view.
export async function setDecoy(itemId: string, text: string) {
  const key = getVaultKey()!;
  const p = await encryptBytes(key, new TextEncoder().encode(text), 'decoy:' + itemId);
  const existing = await db.decoys.where('itemId').equals(itemId).first();
  if (existing) {
    await db.decoys.update(existing.id, { enc: p.ct, iv: p.iv } as any);
  } else {
    await db.decoys.add({ id: newId(), itemId, enc: p.ct, iv: p.iv });
  }
}
export async function getDecoy(itemId: string): Promise<string | null> {
  const rec = await db.decoys.where('itemId').equals(itemId).first();
  if (!rec) return null;
  const key = getVaultKey()!;
  try {
    const b = await decryptBytes(key, { iv: rec.iv, ct: rec.enc }, 'decoy:' + itemId);
    return new TextDecoder().decode(b);
  } catch { return null; }
}
export async function deleteDecoy(itemId: string) {
  await db.decoys.where('itemId').equals(itemId).delete();
}

// Folder-level decoy tree: one encrypted JSON blob per protected folder.
// Encrypted with the vault key (vault session only) — never the folder key,
// so a wrong folder password can still render the decoy view.
export async function getDecoyTree(folderId: string): Promise<DecoyTree | null> {
  const rec = await db.decoyTrees.get(folderId);
  if (!rec) return null;
  const key = getVaultKey();
  if (!key) return null;
  try {
    return await decryptJson<DecoyTree>(key, { iv: rec.iv, ct: rec.enc }, 'decoy-tree:' + folderId);
  } catch { return null; }
}

export async function saveDecoyTree(folderId: string, tree: DecoyTree) {
  const key = getVaultKey()!;
  const env = await encryptJson(key, tree, 'decoy-tree:' + folderId);
  await db.decoyTrees.put({ id: folderId, enc: env.ct, iv: env.iv, updatedAt: Date.now() });
}

export async function deleteDecoyTree(folderId: string) {
  await db.decoyTrees.delete(folderId);
}

export function emptyDecoyTree(name: string): DecoyTree {
  return { name: name || 'Folder', folders: [], docs: [] };
}

export function newDecoyId() { return newId(); }
