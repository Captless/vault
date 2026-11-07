export type ItemKind = 'folder' | 'txt' | 'md' | 'file';
export type Protection = 'unprotected' | 'protected';

export interface FolderMeta { name: string; }
export interface FileMeta { name: string; mime?: string; size?: number; protection?: 'unprotected' | 'protected'; }

export interface ItemMeta { name: string; mime?: string; size?: number; }

export interface DbFolder {
  id: string;
  parentId: string | null;
  protection: Protection;
  keyId?: string;
  metaEnc: string; // encrypted JSON FolderMeta
  metaIv: string;
  // Vault-encrypted display name so locked folders still show their title
  // in explorer/sidebar (contents remain hidden until unlocked).
  nameEncVault?: string;
  nameIvVault?: string;
  createdAt: number;
  updatedAt: number;
  cryptoVersion: number;
}

export interface DbItem {
  id: string;
  parentId: string | null;
  kind: ItemKind;
  scope: 'vault' | 'folder'; // which DEK
  metaEnc: string;
  metaIv: string;
  payloadEnc?: string;
  payloadIv?: string;
  mime?: string;
  size?: number;
  createdAt: number;
  updatedAt: number;
  cryptoVersion: number;
}

export interface DbBlob { id: string; itemId: string; chunk: number; enc: string; iv: string; }
export interface DbDecoy { id: string; itemId: string; enc: string; iv: string; }
export interface DbDecoyTree { id: string; enc: string; iv: string; updatedAt: number; }
export interface DecoySubFolder { id: string; parentId: string | null; name: string; }
export interface DecoyDoc { id: string; folderId: string | null; name: string; kind: 'txt' | 'md'; text: string; }
export interface DecoyTree { name: string; folders: DecoySubFolder[]; docs: DecoyDoc[]; }
export interface DbFolderKey {
  id: string; folderId: string; algo: string; salt: string; params: string;
  wrappedDek: string; wrapIv: string; verifyEnc: string; verifyIv: string;
}
export interface VaultMeta {
  id: string; schemaVersion: number; kdf: string; salt: string; params: string;
  wrappedDek: string; wrapIv: string; verifyEnc: string; verifyIv: string;
  createdAt: number; settings: Record<string, unknown>;
}