import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { listFolders, createFolder, getFolderMeta, deleteFolder } from '../services/folder.service';
import { listItems, createTxt, createMd, deleteItem, getItemMeta, uploadFile } from '../services/item.service';
import { unlockFolder } from '../services/crypto.service';
import { clearSession } from '../services/crypto.service';
import type { DbFolder, DbItem } from '../types';

export default function ExplorerPage() {
  const nav = useNavigate();
  const [parentId, setParentId] = useState<string | null>(null);
  const [folders, setFolders] = useState<DbFolder[]>([]);
  const [items, setItems] = useState<DbItem[]>([]);
  const [names, setNames] = useState<Record<string,string>>({});
  const [unlockTarget, setUnlockTarget] = useState<DbFolder | null>(null);
  const [unlockPw, setUnlockPw] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [crumbs, setCrumbs] = useState<{id:string|null; name:string}[]>([{id:null,name:'Vault'}]);

  const load = useCallback(async () => {
    const fs = await listFolders(parentId);
    const its = await listItems(parentId ?? '');
    // root items parentId null? items use parentId string; root folders have parentId null. items root parentId? we use '' for root? fix: store root parentId as null not allowed in DbItem (string). Use 'root' sentinel? Simpler: parentId null for root folders; items parentId string non-null. For root items use parentId '__root__'? 
    setFolders(fs);
    setItems(its);
    const n: Record<string,string> = {};
    for (const f of fs) { try { n[f.id] = (await getFolderMeta(f)).name; } catch { n[f.id]='(locked)'; } }
    for (const it of its) { try { n[it.id] = (await getItemMeta(it)).name; } catch { n[it.id]='?'; } }
    setNames(n);
  }, [parentId]);

  useEffect(() => { load(); }, [load]);

  async function openFolder(f: DbFolder) {
    if (f.protection === 'protected' && !unlockTarget) {
      // check if unlocked
      // try getFolderKey
      const { getFolderKey } = await import('../services/crypto.service');
      if (!getFolderKey(f.id)) {
        setUnlockTarget(f);
        setUnlockPw('');
        return;
      }
    }
    // navigate
    const name = names[f.id] ?? 'Folder';
    setCrumbs(c => [...c, { id: f.id, name }]);
    setParentId(f.id);
  }

  async function doUnlock() {
    if (!unlockTarget) return;
    const ok = await unlockFolder(unlockTarget.id, unlockPw);
    if (ok) { setUnlockTarget(null); openFolder(unlockTarget); }
    else { alert('Incorrect password (decoy view not implemented in this build).'); setUnlockTarget(null); }
  }



  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    for (const f of Array.from(files)) {
      await uploadFile(parentId, f);
    }
    load();
  }

  async function delFolder(f: DbFolder) {
    if (!confirm('Delete folder and contents?')) return;
    await deleteFolder(f.id);
    load();
  }
  async function delItem(it: DbItem) {
    if (!confirm('Delete item?')) return;
    await deleteItem(it.id);
    load();
  }

  function goCrumb(c: {id:string|null; name:string}, idx: number) {
    setCrumbs(prev => prev.slice(0, idx+1));
    setParentId(c.id);
  }

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2">
        <button onClick={()=>{ clearSession(); nav('/login'); }} className="text-xs text-zinc-500 hover:text-zinc-900">Lock</button>
        <nav className="flex items-center gap-1 text-sm">
          {crumbs.map((c, i) => (
            <span key={i} className="flex items-center gap-1">
              {i>0 && <span className="text-zinc-300">/</span>}
              <button onClick={()=>goCrumb(c,i)} className="hover:underline">{c.name}</button>
            </span>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <button onClick={()=>setShowCreate(s=>!s)} className="text-xs bg-zinc-900 text-white px-3 py-1 hover:bg-zinc-800">Create</button>
            {showCreate && (
              <div className="absolute right-0 mt-1 w-36 border border-zinc-200 bg-white shadow-sm z-10">
                <button onClick={async()=>{ setShowCreate(false); const n=prompt('Folder name'); if(n){ await createFolder(parentId,n.trim()); load(); } }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100">New folder</button>
                <button onClick={async()=>{ setShowCreate(false); const n=prompt('Name?')||'Untitled.txt'; await createTxt(parentId,n); load(); }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100">New TXT</button>
                <button onClick={async()=>{ setShowCreate(false); const n=prompt('Name?')||'Untitled.md'; await createMd(parentId,n); load(); }} className="block w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100">New MD</button>
                <label className="block w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-100 cursor-pointer">
                  Upload file <input type="file" multiple className="hidden" onChange={async(e)=>{ setShowCreate(false); await onUpload(e); }} />
                </label>
              </div>
            )}
          </div>
          <button onClick={()=>setShowSettings(true)} className="text-zinc-500 hover:text-zinc-900" title="Settings">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
          </button>
        </div>
      </header>



      <div className="flex-1 overflow-auto p-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 border-b border-zinc-200">
              <th className="py-1 font-normal">Name</th>
              <th className="py-1 font-normal w-24">Type</th>
              <th className="py-1 font-normal w-24">Size</th>
              <th className="py-1 font-normal w-32"></th>
            </tr>
          </thead>
          <tbody>
            {folders.map(f => (
              <tr key={f.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                <td className="py-1.5">
                  <button onClick={()=>openFolder(f)} className="hover:underline">{names[f.id]}</button>
                  {f.protection==='protected' && <span className="ml-2 text-xs text-zinc-400">locked</span>}
                </td>
                <td className="py-1.5 text-zinc-500">Folder</td>
                <td className="py-1.5 text-zinc-500">—</td>
                <td className="py-1.5 text-right">
                  <button onClick={()=>delFolder(f)} className="text-xs text-zinc-400 hover:text-red-600">Delete</button>
                </td>
              </tr>
            ))}
            {items.map(it => (
              <tr key={it.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                <td className="py-1.5">
                  {it.kind==='txt'||it.kind==='md' ? (
                    <button onClick={()=>nav('/editor/'+it.id)} className="hover:underline">{names[it.id]}</button>
                  ) : (
                    <span>{names[it.id]}</span>
                  )}
                </td>
                <td className="py-1.5 text-zinc-500">{it.kind.toUpperCase()}</td>
                <td className="py-1.5 text-zinc-500">{it.size ? (it.size/1024).toFixed(1)+'KB' : '—'}</td>
                <td className="py-1.5 text-right">
                  <button onClick={()=>delItem(it)} className="text-xs text-zinc-400 hover:text-red-600">Delete</button>
                </td>
              </tr>
            ))}
            {folders.length===0 && items.length===0 && (
              <tr><td colSpan={4} className="py-8 text-center text-zinc-400 text-sm">Empty folder</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center p-4 z-20">
          <div className="bg-white border border-zinc-200 p-6 w-full max-w-sm space-y-3">
            <h2 className="text-sm font-semibold">Settings</h2>
            <button onClick={()=>{ setShowSettings(false); nav('/settings'); }} className="block w-full text-left text-sm px-3 py-2 border border-zinc-200 hover:bg-zinc-50">Master password & settings</button>
            <button onClick={()=>{ setShowSettings(false); nav('/backup'); }} className="block w-full text-left text-sm px-3 py-2 border border-zinc-200 hover:bg-zinc-50">Backup / Restore</button>
            <button onClick={()=>{ clearSession(); nav('/login'); }} className="block w-full text-left text-sm px-3 py-2 border border-zinc-200 hover:bg-zinc-50 text-red-600">Lock vault</button>
            <div className="flex justify-end">
              <button onClick={()=>setShowSettings(false)} className="text-xs px-3 py-1.5">Close</button>
            </div>
          </div>
        </div>
      )}

      {unlockTarget && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center p-4">
          <div className="bg-white border border-zinc-200 p-6 w-full max-w-sm space-y-3">
            <h2 className="text-sm font-semibold">Unlock folder</h2>
            <input type="password" value={unlockPw} onChange={e=>setUnlockPw(e.target.value)} className="w-full border border-zinc-300 px-3 py-2 text-sm" autoFocus />
            <div className="flex gap-2 justify-end">
              <button onClick={()=>setUnlockTarget(null)} className="text-xs px-3 py-1.5">Cancel</button>
              <button onClick={doUnlock} className="text-xs bg-zinc-900 text-white px-3 py-1.5">Unlock</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}