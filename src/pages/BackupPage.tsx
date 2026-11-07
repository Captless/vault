import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/database';

import { deriveKey, randomBytes, toB64, fromB64 } from '../security/kdf';
import { importAesKey } from '../security/encryption';
import { encryptBytes, decryptBytes } from '../security/encryption';

export default function BackupPage() {
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');

  async function exportBackup() {
    const snapshot = {
      vaultMeta: await db.vaultMeta.toArray(),
      folders: await db.folders.toArray(),
      items: await db.items.toArray(),
      blobs: await db.blobs.toArray(),
      decoys: await db.decoys.toArray(),
      folderKeys: await db.folderKeys.toArray(),
    };
    const salt = randomBytes(16);
    const raw = await deriveKey(pw, salt, { memory: 65536, iterations: 3, parallelism: 1, hashLength: 32 });
    const key = await importAesKey(raw);
    const data = new TextEncoder().encode(JSON.stringify(snapshot));
    const env = await encryptBytes(key, data, 'backup');
    const out = { v: 1, salt: toB64(salt), iv: env.iv, ct: env.ct };
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'vault.vaultbackup';
    a.click();
    URL.revokeObjectURL(url);
    setMsg('Exported.');
  }

  async function importBackup(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const inp = JSON.parse(txt);
      const salt = fromB64(inp.salt);
      const raw = await deriveKey(pw, salt, { memory: 65536, iterations: 3, parallelism: 1, hashLength: 32 });
      const key = await importAesKey(raw);
      const bytes = await decryptBytes(key, { iv: inp.iv, ct: inp.ct }, 'backup');
      const snap = JSON.parse(new TextDecoder().decode(bytes));
      if (!confirm('Restore will replace current vault data. Continue?')) return;
      await db.transaction('rw', [db.vaultMeta, db.folders, db.items, db.blobs, db.decoys, db.folderKeys], async () => {
        await db.vaultMeta.clear(); await db.folders.clear(); await db.items.clear();
        await db.blobs.clear(); await db.decoys.clear(); await db.folderKeys.clear();
        for (const x of snap.vaultMeta) await db.vaultMeta.add(x);
        for (const x of snap.folders) await db.folders.add(x);
        for (const x of snap.items) await db.items.add(x);
        for (const x of snap.blobs) await db.blobs.add(x);
        for (const x of snap.decoys) await db.decoys.add(x);
        for (const x of snap.folderKeys) await db.folderKeys.add(x);
      });
      setMsg('Restored. Please re-login.');
    } catch (err: any) {
      setMsg('Import failed: ' + err.message);
    }
  }

  return (
    <div className="h-full p-6 max-w-md mx-auto space-y-4">
      <button onClick={()=>nav('/app')} className="text-xs text-zinc-500">← Back</button>
      <h1 className="text-lg font-semibold">Backup</h1>
      <div className="border border-zinc-200 bg-white p-4 space-y-3">
        <p className="text-xs text-zinc-500">Master password (for backup encryption):</p>
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)} className="w-full border border-zinc-300 px-3 py-2 text-sm" />
        <div className="flex gap-2">
          <button onClick={exportBackup} className="bg-zinc-900 text-white px-3 py-2 text-sm">Export</button>
          <label className="border border-zinc-300 px-3 py-2 text-sm cursor-pointer">
            Import <input type="file" accept=".vaultbackup,.json" className="hidden" onChange={importBackup} />
          </label>
        </div>
        {msg && <p className="text-xs text-zinc-600">{msg}</p>}
      </div>
    </div>
  );
}