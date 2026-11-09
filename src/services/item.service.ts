import { db } from '../db/database';
import { getVaultKey, getFolderKey } from './crypto.service';
import { encryptJson, decryptJson, encryptBytes, decryptBytes } from '../security/encryption';
import { newId } from './folder.service';
import type { DbItem, ItemMeta, ItemKind } from '../types';

export type TextEditorMode = 'markdown' | 'plain';

const MARKDOWN_EXTS = new Set(['md', 'markdown', 'mdx']);
const TEXT_EXTS = new Set([
  'txt', 'text', 'md', 'markdown', 'mdx',
  'html', 'htm', 'xhtml', 'xml', 'svg-src', // svg handled as image viewer by default; allow source-open paths only if needed
  'json', 'jsonc', 'json5', 'map',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'config', 'properties',
  'csv', 'tsv', 'log', 'out',
  'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts',
  'css', 'scss', 'sass', 'less',
  'py', 'pyw', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'groovy', 'gradle',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'cs', 'fs', 'fsx',
  'php', 'phtml', 'swift', 'dart', 'lua', 'pl', 'pm', 'r',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'psd1', 'bat', 'cmd',
  'sql', 'graphql', 'gql', 'prisma',
  'vue', 'svelte', 'astro',
  'env', 'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc', 'prettierrc', 'eslintrc', 'babelrc',
  'dockerfile', 'makefile', 'cmake', 'lock',
]);
const TEXT_BASENAMES = new Set([
  'dockerfile', 'makefile', 'cmakelists.txt', '.gitignore', '.gitattributes', '.editorconfig', '.env', '.npmrc', '.nvmrc',
  'license', 'readme', 'changelog',
]);

export function getTextEditorMode(name?: string, mime?: string, itemKind?: string): TextEditorMode | null {
  if (itemKind === 'md') return 'markdown';
  if (itemKind === 'txt') return 'plain';
  if (itemKind && itemKind !== 'file') return null;

  const rawName = (name || '').trim();
  const lowerName = rawName.toLowerCase();
  const base = lowerName.split(/[\\/]/).pop() || '';
  const ext = base.includes('.') ? (base.split('.').pop() || '') : '';
  const m = (mime || '').toLowerCase().split(';')[0].trim();

  if (m === 'text/markdown' || m === 'text/x-markdown') return 'markdown';
  if (MARKDOWN_EXTS.has(ext)) return 'markdown';

  if (m.startsWith('text/')) return 'plain';
  if (m === 'application/json' || m === 'application/ld+json' || m.endsWith('+json')) return 'plain';
  if (m === 'application/xml' || m === 'text/xml' || m.endsWith('+xml')) return 'plain';
  if (m === 'application/javascript' || m === 'application/x-javascript' || m === 'application/typescript') return 'plain';
  if (m === 'application/x-yaml' || m === 'application/yaml' || m === 'application/toml') return 'plain';
  if (m === 'application/sql' || m === 'application/graphql' || m === 'application/x-sh') return 'plain';

  if (ext && TEXT_EXTS.has(ext)) return 'plain';
  if (base && TEXT_BASENAMES.has(base)) return 'plain';
  // dotfiles like .env.local
  if (base.startsWith('.') && base.length > 1) return 'plain';

  return null;
}

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

export function textKindFromNameMime(name?: string, mime?: string): 'txt' | 'md' | null {
  const mode = getTextEditorMode(name, mime);
  if (mode === 'markdown') return 'md';
  if (mode === 'plain' && ((mime || '').toLowerCase() === 'text/plain' || /\.(txt|text)$/i.test(name || ''))) return 'txt';
  return null;
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
  const textKind = textKindFromNameMime(file.name, file.type);
  const it: DbItem = {
    id: newId(), parentId, kind: textKind || 'file', scope: 'vault',
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