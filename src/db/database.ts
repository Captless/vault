import Dexie, { type Table } from 'dexie';
import type { DbFolder, DbItem, DbBlob, DbDecoy, DbDecoyTree, DbFolderKey, VaultMeta } from '../types';

export class VaultDB extends Dexie {
  vaultMeta!: Table<VaultMeta, string>;
  folders!: Table<DbFolder, string>;
  items!: Table<DbItem, string>;
  blobs!: Table<DbBlob, string>;
  decoys!: Table<DbDecoy, string>;
  decoyTrees!: Table<DbDecoyTree, string>;
  folderKeys!: Table<DbFolderKey, string>;

  constructor() {
    super('personal-vault-v2');
    this.on('blocked', () => { console.warn('DB upgrade blocked by another tab'); });
    this.on('versionchange', () => { this.close(); location.reload(); });
    this.version(2).stores({
      vaultMeta: 'id',
      folders: 'id, parentId, protection',
      items: 'id, parentId, kind',
      blobs: 'id, itemId, chunk',
      decoys: 'id, itemId',
      folderKeys: 'id, folderId'
    });
    this.version(3).stores({
      vaultMeta: 'id',
      folders: 'id, parentId, protection',
      items: 'id, parentId, kind',
      blobs: 'id, itemId, chunk',
      decoys: 'id, itemId',
      decoyTrees: 'id',
      folderKeys: 'id, folderId'
    });
  }
}

export const db = new VaultDB();
