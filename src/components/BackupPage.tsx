import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Upload, AlertTriangle } from 'lucide-react';
import { db } from '../db/database';
import { deriveKey, randomBytes, toB64, fromB64 } from '../security/kdf';
import { importAesKey } from '../security/encryption';
import { encryptBytes, decryptBytes } from '../security/encryption';

export default function BackupPage() {
  const nav = useNavigate();
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function exportBackup() {
    setErr(''); setMsg('');
    if (!pw) { setErr('Enter your master password first.'); return; }
    const snapshot = {
      vaultMeta: await db.vaultMeta.toArray(),
      folders: await db.folders.toArray(),
      items: await db.items.toArray(),
      blobs: await db.blobs.toArray(),
      decoys: await db.decoys.toArray(),
      decoyTrees: await (db as any).decoyTrees.toArray(),
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
    setMsg('Backup exported.');
  }

  async function importBackup(e: React.ChangeEvent<HTMLInputElement>) {
    setErr(''); setMsg('');
    const file = e.target.files?.[0];
    if (!file) return;
    if (!pw) { setErr('Enter the master password for this backup.'); return; }
    try {
      const txt = await file.text();
      const inp = JSON.parse(txt);
      const salt = fromB64(inp.salt);
      const raw = await deriveKey(pw, salt, { memory: 65536, iterations: 3, parallelism: 1, hashLength: 32 });
      const key = await importAesKey(raw);
      const bytes = await decryptBytes(key, { iv: inp.iv, ct: inp.ct }, 'backup');
      const snap = JSON.parse(new TextDecoder().decode(bytes));
      await db.transaction('rw', [db.vaultMeta, db.folders, db.items, db.blobs, db.decoys, (db as any).decoyTrees, db.folderKeys], async () => {
        await db.vaultMeta.clear(); await db.folders.clear(); await db.items.clear();
        await db.blobs.clear(); await db.decoys.clear(); await (db as any).decoyTrees.clear(); await db.folderKeys.clear();
        for (const x of snap.vaultMeta) await db.vaultMeta.add(x);
        for (const x of snap.folders) await db.folders.add(x);
        for (const x of snap.items) await db.items.add(x);
        for (const x of snap.blobs) await db.blobs.add(x);
        for (const x of snap.decoys) await db.decoys.add(x);
        for (const x of snap.decoyTrees ?? []) await (db as any).decoyTrees.add(x);
        for (const x of snap.folderKeys) await db.folderKeys.add(x);
      });
      setMsg('Restored. Please log in again.');
    } catch (e: any) { setErr('Import failed: ' + e.message); }
  }

  return (
    <div className="h-full bg-[#fafafa]">
      <div className="max-w-md mx-auto p-6 space-y-6">
        <div className="flex items-center gap-2">
          <button onClick={() => nav('/app')} className="p-1.5 rounded hover:bg-zinc-100 text-zinc-600" aria-label="Back"><ArrowLeft size={16} /></button>
          <h1 className="text-base font-semibold tracking-tight">Backup</h1>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-100">
          <div className="p-4 space-y-3">
            <h2 className="text-sm font-medium">Export</h2>
            <p className="text-xs text-zinc-500">Encrypted with your master password. No separate backup password.</p>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1.5">Master password</label>
              <input type="password" value={pw} onChange={e => setPw(e.target.value)} className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" />
            </div>
            <button onClick={exportBackup} className="flex items-center gap-1.5 bg-zinc-900 text-white px-4 py-2 text-sm rounded hover:bg-zinc-800">
              <Download size={14} /> Export backup
            </button>
          </div>
          <div className="p-4 space-y-3">
            <h2 className="text-sm font-medium">Restore</h2>
            <p className="flex gap-1.5 text-xs text-amber-700"><AlertTriangle size={13} className="shrink-0" /> Restore replaces everything in this vault.</p>
            <label className="flex items-center gap-1.5 border border-zinc-300 px-4 py-2 text-sm rounded hover:bg-zinc-50 cursor-pointer w-fit">
              <Upload size={14} /> Select backup file
              <input type="file" accept=".vaultbackup,.json" className="hidden" onChange={importBackup} />
            </label>
            {msg && <p className="text-xs text-green-700">{msg}</p>}
            {err && <p className="text-xs text-red-600">{err}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}