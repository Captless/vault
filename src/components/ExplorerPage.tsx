import { Fragment, useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Folder, FileText, File, Lock, Settings, Upload, Plus, Trash2, ChevronRight, Undo2, FolderOpen, LogOut, Database, HardDrive, Download, Pencil, Search, X } from 'lucide-react';
import { db } from '../db/database';
import { deriveKey, randomBytes, toB64, fromB64 } from '../security/kdf';
import { importAesKey } from '../security/encryption';
import { encryptBytes, decryptBytes } from '../security/encryption';
import { listFolders, createFolder, getFolderMeta, deleteFolder } from '../services/folder.service';
import { listItems, createTxt, createMd, deleteItem, getItemMeta, uploadFile, readFileItem } from '../services/item.service';
import { unlockFolder, clearSession, getFolderKey } from '../services/crypto.service';
import { getDecoyTree, saveDecoyTree, deleteDecoyTree, newDecoyId, getDecoy } from '../services/decoy.service';
import Dialog from './Dialog';
import EditorPage from './EditorPage';
import DecoyEditorInline from './DecoyEditorInline';
import type { DbFolder, DbItem, DecoyTree } from '../types';
import { APP_VERSION_LABEL } from '../app/version';

type CreateKind = 'folder' | 'txt' | 'md';
type DecoyDocDraft = { id: string; folderId: string | null; name: string; kind: 'txt' | 'md'; text: string };
type DecoyFolderDraft = { id: string; name: string };

export default function ExplorerPage({ onLock }: { onLock?: () => void }) {
  const nav = useNavigate();
  const [parentId, setParentId] = useState<string | null>(null);
  const [folders, setFolders] = useState<DbFolder[]>([]);
  const [items, setItems] = useState<DbItem[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [lockedId, setLockedId] = useState<string | null>(null);
  const [unlockPw, setUnlockPw] = useState('');
  const [unlockErr, setUnlockErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [createKind, setCreateKind] = useState<CreateKind>('folder');
  const [createName, setCreateName] = useState('');
  const [createErr, setCreateErr] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'menu' | 'master' | 'backup'>('menu');
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'folder' | 'item'; id: string; name: string } | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [folderActionsOpen, setFolderActionsOpen] = useState(false);
  const [plusMenuPos, setPlusMenuPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const [crumbs, setCrumbs] = useState<{ id: string | null; name: string }[]>([{ id: null, name: 'All' }]);
  const [storage, setStorage] = useState('');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [renameTarget, setRenameTarget] = useState<{ type: 'folder' | 'item'; id: string; name: string } | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [renameErr, setRenameErr] = useState('');
  const [lockTarget, setLockTarget] = useState<{ type: 'folder' | 'item'; id: string; name: string } | null>(null);
  const [lockPw, setLockPw] = useState('');
  const [lockPw2, setLockPw2] = useState('');
  const [lockDecoy, setLockDecoy] = useState('');
  const [lockErr, setLockErr] = useState('');
  const [lockStep, setLockStep] = useState<1 | 2>(1);
  const [decoyEnabled, setDecoyEnabled] = useState(true);
  const [decoyName, setDecoyName] = useState('');
  const [decoyFolders, setDecoyFolders] = useState<DecoyFolderDraft[]>([]);
  const [decoyDocs, setDecoyDocs] = useState<DecoyDocDraft[]>([]);
  const [selected, setSelected] = useState<Record<string, 'folder' | 'item'>>({});
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [treeFolders, setTreeFolders] = useState<DbFolder[]>([]);
  const [treeNames, setTreeNames] = useState<Record<string, string>>({});
  const [sidebarItems, setSidebarItems] = useState<Record<string, { id: string; kind: string; name: string; size?: number; mime?: string }[]>>({});
  const [folderSizes, setFolderSizes] = useState<Record<string, number>>({});
  const [foldersWithItems, setFoldersWithItems] = useState<Set<string>>(new Set());
  // Decoy view (wrong folder password)
  const [decoyMode, setDecoyMode] = useState<{ folderId: string; tree: DecoyTree; subId: string | null } | null>(null);
  const [decoySearchQuery, setDecoySearchQuery] = useState('');
  const [decoyExpanded, setDecoyExpanded] = useState<Set<string>>(new Set());
  useEffect(() => { setDecoyExpanded(new Set()); }, [decoyMode?.folderId]);
  // Inline editor (stays inside main layout: sidebar + header remain)
  const [editingId, setEditingId] = useState<string | null>(null);
  // Inline decoy editor (same: sidebar stays, doc opens as its own section)
  const [decoyEditingId, setDecoyEditingId] = useState<string | null>(null);
  // Collapsed/expanded folders in the sidebar tree (VS Code style chevron)
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [closingFolders, setClosingFolders] = useState<Set<string>>(new Set());
  // Suppresses the second click of a double-click so rows only toggle once.
  const lastRowClick = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  // Decoy manager (edit decoy for a protected folder)
  const [decoyEdit, setDecoyEdit] = useState<{ folderId: string; name: string; enabled: boolean; treeName: string; folders: DecoyFolderDraft[]; docs: DecoyDocDraft[] } | null>(null);
  // Global search (all folders/files with accessible names)
  const [searchQuery, setSearchQuery] = useState('');
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchResults, setSearchResults] = useState<{ folders: { id: string; name: string; path: string; locked: boolean }[]; items: { id: string; name: string; kind: string; size?: number; mime?: string; parentId: string | null; path: string }[] } | null>(null);
  const searchItemNames = useRef<Record<string, string>>({});
  // Create/upload can target a specific folder (3-dots "Create inside")
  const [createTargetParentId, setCreateTargetParentId] = useState<string | null | undefined>(undefined); // undefined = use current parentId
  const uploadHereRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  // Inline unlock for locked folders (expand/collapse model, no navigation)
  const [inlineUnlockId, setInlineUnlockId] = useState<string | null>(null);
  // File viewer (images, PDFs)
  const [viewer, setViewer] = useState<{ id: string; name: string; mime: string; url: string; kind: 'image' | 'pdf' } | null>(null);
  const [viewerBusy, setViewerBusy] = useState(false);
  const [viewerErr, setViewerErr] = useState('');
  const viewerUrlRef = useRef<string | null>(null);
  useEffect(() => () => { if (viewerUrlRef.current) URL.revokeObjectURL(viewerUrlRef.current); }, []);

  function openMenuAt(id: string, e: React.MouseEvent) {
    const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
    setMenuPos({ top: r.bottom + 4, left: Math.max(8, r.right - 176) });
    setMenuId(menuId === id ? null : id);
  }

  function openPlusMenu(e: React.MouseEvent) {
    if (plusMenuPos) { closePlusMenu(); return; }
    const r = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
    const menuH = 180;
    const gap = 8;
    const spaceAbove = r.top - gap;
    const spaceBelow = window.innerHeight - r.bottom - gap;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - 200);
    const next = spaceAbove >= menuH || spaceAbove >= spaceBelow
      ? { bottom: Math.max(gap, window.innerHeight - r.top + gap), left }
      : { top: Math.min(r.bottom + gap, window.innerHeight - gap), left };
    setPlusMenuPos(next);
    setFolderActionsOpen(true);
  }

  function closePlusMenu() {
    setPlusMenuPos(null);
    setFolderActionsOpen(false);
  }

  function resetLockWizard() {
    setLockStep(1); setLockPw(''); setLockPw2(''); setLockDecoy(''); setLockErr('');
    setDecoyEnabled(true); setDecoyName(''); setDecoyFolders([]); setDecoyDocs([]);
  }

  function menuItems(id: string, kind: 'folder' | 'item', name: string, prot: string, itemKind?: string, mime?: string) {
    const canCreateInside = kind === 'folder' && (prot !== 'protected' || !!getFolderKey(id));
    const viewKind = kind === 'item' ? (itemKind === 'txt' || itemKind === 'md' ? 'editor' : (itemKind === 'file' ? getViewKind(mime, name) : null)) : null;
    return (
      <>
        {viewKind === 'editor' && <button onClick={() => { setMenuId(null); openEditor(id); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 text-left"><FolderOpen size={12} /> Open</button>}
        {(viewKind === 'image' || viewKind === 'pdf') && <button onClick={() => { setMenuId(null); void openFileViewer(id); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 text-left"><FolderOpen size={12} /> View</button>}
        {canCreateInside && (
          <>
            <button onClick={() => { setMenuId(null); setCreateTargetParentId(id); setCreateKind('folder'); setCreateName(''); setCreateErr(''); setShowCreate(true); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 text-left"><Folder size={12} /> New subfolder</button>
            <button onClick={() => { setMenuId(null); setCreateTargetParentId(id); setCreateKind('txt'); setCreateName(''); setCreateErr(''); setShowCreate(true); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 text-left"><FileText size={12} /> New text file</button>
            <button onClick={() => { setMenuId(null); setCreateTargetParentId(id); setCreateKind('md'); setCreateName(''); setCreateErr(''); setShowCreate(true); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 text-left"><FileText size={12} /> New markdown</button>
            <button onClick={() => { setMenuId(null); setUploadTargetId(id); uploadHereRef.current?.click(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 text-left"><Upload size={12} /> Upload here</button>
            <div className="my-1 border-t border-zinc-100" />
          </>
        )}
        {prot !== 'protected' && <button onClick={() => { setMenuId(null); setLockTarget({ type: kind, id, name }); resetLockWizard(); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 text-left"><Lock size={12} /> Lock</button>}
        <button onClick={() => { setMenuId(null); setRenameTarget({ type: kind, id, name }); setRenameValue(name); setRenameErr(''); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-zinc-100 text-left"><Pencil size={12} /> Rename</button>
        <button onClick={() => { setMenuId(null); setDeleteTarget({ type: kind, id, name }); }} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-red-50 text-red-600 w-full text-left"><Trash2 size={12} /> Delete</button>
      </>
    );
  }
  function RowMenu({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
    if (!open) return null;
    return (
      <>
        <button aria-hidden tabIndex={-1} onClick={onClose} className="fixed inset-0 z-30 cursor-default" />
        <div className="fixed z-40 w-44 border border-zinc-200 bg-white rounded-md shadow-lg py-1" role="menu" style={{ top: menuPos.top, left: menuPos.left }}>
          {children}
        </div>
      </>
    );
  }

  const loadSidebarItems = useCallback(async (folderId: string | null) => {
    const key = folderId === 'root' ? null : folderId;
    const listKey = folderId === 'root' || folderId === null ? 'root' : folderId;
    try {
      const its = await listItems(key);
      const list: { id: string; kind: string; name: string; size?: number; mime?: string }[] = [];
      for (const it of its) {
        try {
          const meta = await getItemMeta(it);
          list.push({ id: it.id, kind: it.kind, name: meta.name, size: it.size, mime: meta.mime || it.mime });
        } catch {
          // skip items we can't decrypt (locked)
        }
      }
      list.sort((a, b) => a.name.localeCompare(b.name));
      setSidebarItems(s => ({ ...s, [listKey]: list }));
    } catch {
      setSidebarItems(s => ({ ...s, [listKey]: [] }));
    }
  }, []);

  useEffect(() => { void loadSidebarItems('root'); }, [loadSidebarItems]);

  const load = useCallback(async () => {
    const fs = await listFolders(parentId);
    const its = await listItems(parentId);
    setFolders(fs);
    setItems(its);
    const n: Record<string, string> = {};
    for (const f of fs) { try { n[f.id] = (await getFolderMeta(f)).name; } catch { n[f.id] = 'Folder'; } }
    for (const it of its) { try { n[it.id] = (await getItemMeta(it)).name; } catch { n[it.id] = it.kind === 'txt' ? 'Text file' : it.kind === 'md' ? 'Markdown file' : 'File'; } }
    setNames(n);
    const all = await db.folders.toArray();
    setTreeFolders(all);
    const tn: Record<string, string> = {};
    for (const f of all) { try { tn[f.id] = (await getFolderMeta(f)).name; } catch { tn[f.id] = 'Folder'; } }
    setTreeNames(tn);
    try {
      const allItems = await db.items.toArray();
      const directSize: Record<string, number> = {};
      const withItems = new Set<string>();
      for (const it of allItems) {
        if (it.parentId) withItems.add(it.parentId);
        if (it.parentId && typeof it.size === 'number' && it.size > 0) directSize[it.parentId] = (directSize[it.parentId] || 0) + it.size;
      }
      setFoldersWithItems(withItems);
      const kids = new Map<string | null, string[]>();
      for (const f of all) { const a = kids.get(f.parentId) ?? []; a.push(f.id); kids.set(f.parentId, a); }
      const total: Record<string, number> = {};
      const roll = (id: string): number => {
        let s = directSize[id] || 0;
        for (const c of kids.get(id) || []) s += roll(c);
        total[id] = s;
        return s;
      };
      for (const f of all) if (f.parentId === null) roll(f.id);
      for (const f of all) if (total[f.id] === undefined) roll(f.id);
      setFolderSizes(total);
    } catch {
      setFolderSizes({});
      setFoldersWithItems(new Set());
    }
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      setStorage(e.usage ? Math.max(0, (e.usage / 1024 / 1024)).toFixed(1) + ' MB used' : '');
    }
    void loadSidebarItems(parentId ?? 'root');
  }, [parentId, loadSidebarItems]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setSelected({}); }, [parentId, decoyMode?.folderId, decoyMode?.subId]);

  // Strict auto-lock: leaving the current folder (any navigation) clears its
  // key and resets the unlock password input. Tracked via ref so the cleanup
  // for the *previous* folder runs before the next one is shown.
  const parentRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = parentRef.current;
    if (prev && prev !== parentId) {
      import('../services/crypto.service').then(m => m.setFolderKey(prev, null));
    }
    parentRef.current = parentId;
    setUnlockPw('');
    setUnlockErr('');
    // Clear the locked-folder card only when navigating AWAY from it.
    // When entering the locked folder itself, lockedId was just set by the
    // click handler in the same batch — keep it, otherwise the card is wiped
    // and the folder appears to open without a password prompt.
    setLockedId(cur => (cur && cur === parentId ? cur : null));
  }, [parentId]);

  // Closing the inline editor re-locks its parent folder (if protected) and
  // steps back out of it so the list shows the locked folder title.
  const closeEditor = useCallback(async () => {
    const pid = parentId;
    setEditingId(null);
    setUnlockPw(''); setUnlockErr(''); setLockedId(null);
    if (pid) {
      const f = await db.folders.get(pid);
      if (f?.protection === 'protected') {
        import('../services/crypto.service').then(m => m.setFolderKey(pid, null));
        setCrumbs(c => c.slice(0, -1));
        setParentId(f.parentId);
      }
    }
    void load();
  }, [parentId, load]);

  const editingRef = useRef<string | null>(null);
  useEffect(() => { editingRef.current = editingId; }, [editingId]);

  // Browser back from inline editor closes it; otherwise clears folder keys.
  useEffect(() => {
    const onPop = () => {
      if (editingRef.current) {
        // Back from file editor: close editor (closeEditor re-locks folder).
        void closeEditor();
        return;
      }
      import('../services/crypto.service').then(m => { m.clearAllFolderKeys(); });
      setUnlockPw(''); setUnlockErr(''); setLockedId(null);
    };
    const onHide = () => {
      import('../services/crypto.service').then(m => { m.clearAllFolderKeys(); });
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('pagehide', onHide);
      import('../services/crypto.service').then(m => { m.clearAllFolderKeys(); });
    };
  }, []);

  // Restore decoy view after navigating back from decoy editor
  useEffect(() => {
    (async () => {
      try {
        const fid = sessionStorage.getItem('decoy-folder');
        if (!fid) return;
        const t = await getDecoyTree(fid);
        if (t) {
          sessionStorage.removeItem('decoy-folder');
          setDecoyMode({ folderId: fid, tree: t, subId: null });
          setCrumbs([{ id: null, name: 'All' }, { id: null, name: t.name }]);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  async function enterDecoyView(folderId: string) {
    let tree = await getDecoyTree(folderId);
    if (!tree) {
      // Fallback: per-document decoys for txt/md items inside this folder
      const its = await db.items.where('parentId').equals(folderId).toArray();
      const docs: DecoyTree['docs'] = [];
      for (const it of its) {
        if (it.kind !== 'txt' && it.kind !== 'md') continue;
        const text = await getDecoy(it.id);
        if (text === null) continue;
        let nm = it.kind === 'txt' ? 'Text file.txt' : 'Document.md';
        try { nm = (await getItemMeta(it)).name; } catch { /* locked meta — use generic */ }
        docs.push({ id: it.id, folderId: null, name: nm, kind: it.kind, text });
      }
      if (docs.length === 0) return false;
      tree = { name: 'Folder', folders: [], docs };
    }
    setDecoyMode({ folderId, tree, subId: null });
    setCrumbs([{ id: null, name: 'All' }, { id: null, name: tree.name }]);
    return true;
  }

  function getViewKind(mime?: string, name?: string): 'image' | 'pdf' | null {
    const m = (mime || '').toLowerCase();
    if (m.startsWith('image/')) return 'image';
    if (m === 'application/pdf') return 'pdf';
    const ext = (name || '').split('.').pop()?.toLowerCase() || '';
    if (ext === 'pdf') return 'pdf';
    if (['png','jpg','jpeg','gif','webp','bmp','svg','avif','ico'].includes(ext)) return 'image';
    return null;
  }

  function closeViewer() {
    if (viewerUrlRef.current) { URL.revokeObjectURL(viewerUrlRef.current); viewerUrlRef.current = null; }
    setViewer(null);
    setViewerErr('');
    setViewerBusy(false);
  }

  async function openFileViewer(id: string) {
    setSearchQuery('');
    setSearchResults(null);
    setViewerErr('');
    setViewerBusy(true);
    if (viewerUrlRef.current) { URL.revokeObjectURL(viewerUrlRef.current); viewerUrlRef.current = null; }
    try {
      let it = items.find(x => x.id === id) || null;
      if (!it) it = (await db.items.get(id)) || null;
      if (!it) throw new Error('File not found');
      const { bytes, mime, name } = await readFileItem(it);
      const kind = getViewKind(mime, name);
      if (!kind) throw new Error('This file type cannot be previewed');
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mime || 'application/octet-stream' }));
      viewerUrlRef.current = url;
      setViewer({ id, name, mime: mime || 'application/octet-stream', url, kind });
    } catch (e: any) {
      setViewerErr(e?.message || 'Could not open file');
      setViewer({ id, name: 'File', mime: '', url: '', kind: 'image' });
    } finally {
      setViewerBusy(false);
    }
  }

  function openEditor(id: string) {
    setSearchQuery('');
    setSearchResults(null);
    setEditingId(id);
  }

  // Navigate/open folder. In expand/collapse model, locked folders unlock inline (no navigation).
  async function openFolder(f: DbFolder) {
    const { getFolderKey } = await import('../services/crypto.service');
    if (f.protection === 'protected' && !getFolderKey(f.id)) {
      setUnlockPw(''); setUnlockErr('');
      setInlineUnlockId(f.id);
      // reveal in tree without changing current directory
      const chain: string[] = [];
      let cur: DbFolder | undefined = f;
      while (cur?.parentId) { chain.push(cur.parentId); cur = treeFolders.find(x => x.id === cur!.parentId); }
      if (chain.length) setExpandedFolders(s => { const n = new Set(s); for (const id of chain) n.add(id); return n; });
      setLockedId(null);
      return;
    }
    setInlineUnlockId(null);
    setLockedId(null);
    setCrumbs(pathTo(f));
    setParentId(f.id);
  }

  async function doUnlock(targetId?: string | null) {
    const id = targetId ?? inlineUnlockId ?? lockedId;
    if (!id) return;
    setBusy(true); setUnlockErr('');
    const ok = await unlockFolder(id, unlockPw);
    setBusy(false);
    if (ok) {
      setInlineUnlockId(cur => (cur === id ? null : cur));
      setLockedId(cur => (cur === id ? null : cur));
      setUnlockPw('');
      setExpandedFolders(s => new Set(s).add(id));
      await load();
      void loadSidebarItems(id);
      return;
    }
    // Wrong password → decoy view if one exists (silent, no error)
    const entered = await enterDecoyView(id);
    if (entered) {
      setInlineUnlockId(cur => (cur === id ? null : cur));
      setLockedId(cur => (cur === id ? null : cur));
      setUnlockPw('');
      setExpandedFolders(s => { const n = new Set(s); n.delete(id); return n; });
      setSidebarItems(s => { const n = { ...s }; delete n[id]; return n; });
      return;
    }
    setUnlockErr('Incorrect password.');
  }

  async function doCreate() {
    const targetParentId = createTargetParentId !== undefined ? createTargetParentId : parentId;
    const raw = createName.trim();
    const defaultName = createKind === 'folder' ? 'New Folder' : createKind === 'txt' ? 'New Text Document.txt' : 'New Markdown.md';
    const input = raw || defaultName;

    let siblings: string[] = [];
    if (targetParentId === parentId) {
      siblings = [
        ...folders.map(f => (names[f.id] || '').toLowerCase()),
        ...items.map(it => (names[it.id] || '').toLowerCase()),
      ].filter(Boolean);
    } else {
      const sf = await listFolders(targetParentId);
      const si = await listItems(targetParentId);
      for (const f of sf) { try { siblings.push((await getFolderMeta(f)).name.toLowerCase()); } catch { /* ignore */ } }
      for (const it of si) { try { siblings.push((await getItemMeta(it)).name.toLowerCase()); } catch { /* ignore */ } }
    }
    const existing = new Set<string>(siblings);

    function uniqueName(base: string, isFile: boolean) {
      let candidate = base;
      if (!existing.has(candidate.toLowerCase())) return candidate;
      let stem = base;
      let ext = '';
      if (isFile) {
        const m = base.match(/^(.*?)(\.[^.]*)$/);
        if (m) { stem = m[1] || base; ext = m[2]; }
      }
      for (let i = 1; ; i++) {
        candidate = `${stem} (${i})${ext}`;
        if (!existing.has(candidate.toLowerCase())) return candidate;
      }
    }

    setBusy(true);
    try {
      if (createKind === 'folder') {
        const finalName = uniqueName(input, false);
        await createFolder(targetParentId, finalName);
      } else if (createKind === 'txt') {
        const withExt = input.toLowerCase().endsWith('.txt') ? input : input + '.txt';
        const finalName = uniqueName(withExt, true);
        await createTxt(targetParentId, finalName);
      } else {
        const withExt = input.toLowerCase().endsWith('.md') ? input : input + '.md';
        const finalName = uniqueName(withExt, true);
        await createMd(targetParentId, finalName);
      }
    } catch (err: any) {
      setCreateErr(err?.message ?? 'Could not create');
      return;
    } finally {
      setBusy(false);
    }
    setCreateName(''); setCreateErr(''); setShowCreate(false);
    if (targetParentId) {
      setExpandedFolders(s => new Set(s).add(targetParentId));
      void loadSidebarItems(targetParentId);
    }
    setCreateTargetParentId(undefined);
    await load();
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files) return;
    const target = uploadTargetId ?? parentId;
    for (const f of Array.from(files)) await uploadFile(target, f);
    if (target) {
      setExpandedFolders(s => new Set(s).add(target));
      void loadSidebarItems(target);
    }
    setUploadTargetId(null);
    e.target.value = '';
    load();
  }

  async function doDelete() {
    if (!deleteTarget) return;
    const id = deleteTarget.id;
    if (deleteTarget.type === 'folder') await deleteFolder(id);
    else await deleteItem(id);
    setSelected(s => { if (!s[id]) return s; const n = { ...s }; delete n[id]; return n; });
    setDeleteTarget(null);
    setSidebarItems({});
    await load();
    void loadSidebarItems(parentId ?? 'root');
  }

  async function doBulkDelete() {
    const entries = Object.entries(selected);
    for (const [id, type] of entries) {
      try {
        if (type === 'folder') await deleteFolder(id);
        else await deleteItem(id);
      } catch { /* continue */ }
    }
    setSelected({});
    setBulkDeleteOpen(false);
    setSidebarItems({});
    await load();
    void loadSidebarItems(parentId ?? 'root');
  }

  async function doRename() {
    if (!renameTarget) return;
    const v = renameValue.trim();
    if (!v) { setRenameErr('Name is required'); return; }
    try {
      if (renameTarget.type === 'folder') {
        const f = await db.folders.get(renameTarget.id);
        if (f) { const { renameFolder } = await import('../services/folder.service'); await renameFolder(f, v); }
      } else {
        const it = await db.items.get(renameTarget.id);
        if (it) { const { renameItem } = await import('../services/item.service'); await renameItem(it, v); }
      }
    } catch (err: any) { setRenameErr(err?.message ?? 'Could not rename'); return; }
    setRenameTarget(null); setRenameValue(''); setRenameErr('');
    await load();
  }

  function addDecoyDocDraft() {
    setDecoyDocs(d => [...d, { id: newDecoyId(), folderId: null, name: '', kind: 'txt', text: '' }]);
  }
  function addDecoyFolderDraft() {
    setDecoyFolders(f => [...f, { id: newDecoyId(), name: '' }]);
  }

  async function doLock() {
    if (!lockTarget) return;
    setLockErr('');
    if (lockStep === 1) {
      if (lockPw.length < 1) { setLockErr('Enter a password'); return; }
      if (lockPw !== lockPw2) { setLockErr('Passwords do not match'); return; }
      setLockStep(2);
      return;
    }
    // Step 2: create decoy tree (optional) then lock
    setBusy(true);
    try {
      const { setupFolderKey } = await import('../services/crypto.service');
      const { protectFolder } = await import('../services/folder.service');
      if (lockTarget.type === 'folder') {
        const f = await db.folders.get(lockTarget.id);
        if (!f) throw new Error('Folder not found');
        const key = await setupFolderKey(f.id, lockPw);
        await protectFolder(f, key);
        if (decoyEnabled) {
          const tree: DecoyTree = {
            name: decoyName.trim() || 'Notes',
            folders: decoyFolders.filter(x => x.name.trim()).map(x => ({ id: x.id, parentId: null, name: x.name.trim() })),
            docs: decoyDocs.filter(x => x.name.trim()).map(x => ({ id: x.id, folderId: x.folderId, name: x.name.trim(), kind: x.kind, text: x.text }))
          };
          await saveDecoyTree(f.id, tree);
        } else {
          await deleteDecoyTree(f.id);
        }
      } else {
        if (!parentId) throw new Error('Vault root cannot be locked — create a folder first');
        const f = await db.folders.get(parentId);
        if (!f) throw new Error('Parent folder not found');
        const key = await setupFolderKey(f.id, lockPw);
        await protectFolder(f, key);
        if (lockDecoy) {
          const { setDecoy } = await import('../services/decoy.service');
          await setDecoy(lockTarget.id, lockDecoy);
        }
      }
    } catch (err: any) { setLockErr(err?.message ?? 'Could not lock'); return; }
    finally { setBusy(false); }
    setLockTarget(null);
    resetLockWizard();
    await load();
  }

  async function saveDecoyEdit() {
    if (!decoyEdit) return;
    if (decoyEdit.enabled) {
      const tree: DecoyTree = {
        name: decoyEdit.treeName.trim() || 'Notes',
        folders: decoyEdit.folders.filter(x => x.name.trim()).map(x => ({ id: x.id, parentId: null, name: x.name.trim() })),
        docs: decoyEdit.docs.filter(x => x.name.trim()).map(x => ({ id: x.id, folderId: x.folderId, name: x.name.trim(), kind: x.kind, text: x.text }))
      };
      await saveDecoyTree(decoyEdit.folderId, tree);
    } else {
      await deleteDecoyTree(decoyEdit.folderId);
    }
    setDecoyEdit(null);
  }

  // Strict leave: clear the current folder's key + reset unlock input,
  // then navigate. Used by breadcrumbs, sidebar, and VAULT button.
  function leaveCurrentFolder() {
    if (parentId) {
      import('../services/crypto.service').then(m => m.setFolderKey(parentId, null));
    }
    parentRef.current = null;
    setEditingId(null);
    setDecoyEditingId(null);
    setUnlockPw(''); setUnlockErr(''); setLockedId(null);
  }

  function goCrumb(c: { id: string | null; name: string }, idx: number) {
    if (decoyMode) {
      setDecoySearchQuery('');
      setDecoyEditingId(null);
      if (idx === 0) {
        setDecoyMode(null);
        setCrumbs([{ id: null, name: 'All' }]);
        setParentId(null);
      } else if (idx === 1) {
        setDecoyMode(m => m ? { ...m, subId: null } : m);
        setCrumbs(prev => prev.slice(0, idx + 1));
      }
      return;
    }
    if (c.id === parentId) return;
    leaveCurrentFolder();
    setCrumbs(prev => prev.slice(0, idx + 1));
    setParentId(c.id);
    const target = c.id ? treeFolders.find(f => f.id === c.id) : null;
    if (target && target.protection === 'protected' && !getFolderKey(target.id)) setLockedId(target.id);
  }

  function lock() { clearSession(); try { sessionStorage.removeItem('decoy-folder'); } catch { /* ignore */ } onLock?.(); nav('/login'); }

  // Decoy view helpers
  async function persistDecoyTree(tree: DecoyTree) {
    if (!decoyMode) return;
    await saveDecoyTree(decoyMode.folderId, tree);
    setDecoyMode(m => m ? { ...m, tree } : m);
  }
  function openDecoyDoc(docId: string) {
    if (!decoyMode) return;
    setDecoyEditingId(docId);
  }

  const treeChildren = new Map<string | null, DbFolder[]>([[null, []]]);
  for (const f of treeFolders) {
    const arr = treeChildren.get(f.parentId) ?? [];
    arr.push(f);
    treeChildren.set(f.parentId, arr);
  }
  for (const arr of treeChildren.values()) arr.sort((a, b) => (treeNames[a.id] ?? '').localeCompare(treeNames[b.id] ?? ''));

  function renderTree(parent: string | null, depth: number): React.ReactNode {
    const kids = treeChildren.get(parent) ?? [];
    return kids.map(f => {
      const isProtected = f.protection === 'protected';
      const locked = isProtected && !getFolderKey(f.id);
      const hasKidsFolders = (treeChildren.get(f.id)?.length ?? 0) > 0;
      const files = locked ? [] : (sidebarItems[f.id] || []);
      const hasFiles = foldersWithItems.has(f.id) || files.length > 0;
      const canExpand = isProtected || hasKidsFolders || hasFiles;
      const expanded = expandedFolders.has(f.id) && !locked;
      return (
        <div key={f.id}>
          <div
            className={`group relative flex items-center gap-0.5 pr-2 rounded hover:bg-zinc-100 ${parentId === f.id ? 'bg-zinc-100 font-medium' : 'text-zinc-700'}`}
            style={{ paddingLeft: `${0.25 + depth * 0.75}rem` }}
          >
            <button
              onClick={() => {
                if (locked) { setUnlockPw(''); setUnlockErr(''); setInlineUnlockId(cur => (cur === f.id ? null : f.id)); void loadSidebarItems(f.id); return; }
                if (!canExpand) return;
                toggleExpand(f.id, () => void loadSidebarItems(f.id));
              }}
              aria-label={expanded ? `Collapse ${treeNames[f.id]}` : `Expand ${treeNames[f.id]}`}
              aria-expanded={expanded}
              className={`p-0.5 rounded text-zinc-400 hover:text-zinc-900 ${canExpand ? '' : 'invisible'}`}
              tabIndex={canExpand ? 0 : -1}
            >
              <ChevronRight size={12} className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
            </button>
            <button
              onClick={async () => {
                if (locked) {
                  setUnlockPw(''); setUnlockErr('');
                  setInlineUnlockId(cur => (cur === f.id ? null : f.id));
                  const chain: string[] = [];
                  let p: DbFolder | undefined = f;
                  while (p?.parentId) { chain.push(p.parentId); p = treeFolders.find(x => x.id === p!.parentId); }
                  setExpandedFolders(s => { const n = new Set(s); for (const id of chain) n.add(id); return n; });
                  void loadSidebarItems(f.id);
                  return;
                }
                if (canExpand) toggleExpand(f.id, () => void loadSidebarItems(f.id));
              }}
              title={locked ? 'Locked folder — unlock' : (canExpand ? (expanded ? 'Collapse folder' : 'Expand folder') : 'Folder')}
              className="flex-1 flex items-center gap-1.5 py-1 text-xs text-left truncate min-w-0"
            >
              <Folder size={12} className="shrink-0 text-zinc-500" />
              <span className="truncate">{treeNames[f.id] ?? 'Folder'}</span>
              {locked && <Lock size={10} className="ml-auto text-zinc-400 shrink-0" />}
            </button>
            {/* Sidebar hover menu — appears on hover of the row */}
            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-100">
              <button
                onClick={(e) => { e.stopPropagation(); openMenuAt(f.id, e); }}
                className="p-1 rounded text-zinc-400 hover:text-zinc-900"
                aria-label="Options"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
              </button>
            </div>
          </div>
          {canExpand && (
            <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
              <div className="overflow-hidden">
                {hasKidsFolders && renderTree(f.id, depth + 1)}
                {files.map(it => (
                  <div
                    key={it.id}
                    className="group relative flex items-center gap-0.5 pr-2 rounded hover:bg-zinc-100 text-zinc-600"
                    style={{ paddingLeft: `${0.25 + (depth + 1) * 0.75 + 1.0}rem` }}
                  >
                    <button
                      onClick={() => {
                        if (it.kind === 'txt' || it.kind === 'md') openEditor(it.id);
                        else if (it.kind === 'file' && getViewKind(it.mime, it.name)) void openFileViewer(it.id);
                      }}
                      className="flex-1 flex items-center gap-1.5 py-1 text-xs text-left min-w-0"
                      title={it.name}
                    >
                      {it.kind === 'txt' || it.kind === 'md' ? <FileText size={12} className="shrink-0 text-zinc-400" /> : <File size={12} className="shrink-0 text-zinc-400" />}
                      <span className="truncate">{it.name}</span>
                      {it.size ? <span className="ml-auto shrink-0 text-[10px] text-zinc-400 tabular-nums">{fmtSize(it.size)}</span> : null}
                    </button>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                      <button onClick={(e) => { e.stopPropagation(); openMenuAt(it.id, e); }} className="p-1 rounded text-zinc-400 hover:text-zinc-900" aria-label="Options">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    });
  }

  // Decoy view (expand/collapse, no drill-down; contents collapsed by default)
  const decoyHasRootContent = decoyMode ? (decoyMode.tree.folders.some(f => f.parentId === null) || decoyMode.tree.docs.some(d => d.folderId === null)) : false;

  const selectableTop = decoyMode ? [] : [
    ...(treeChildren.get(parentId) ?? []).map(f => ({ id: f.id, type: 'folder' as const })),
    ...items.map(it => ({ id: it.id, type: 'item' as const })),
  ];
  const selectedCount = Object.keys(selected).length;
  const allSelected = selectableTop.length > 0 && selectableTop.every(x => selected[x.id]);

  function toggleSelect(id: string, type: 'folder' | 'item') {
    setSelected(s => {
      const n = { ...s };
      if (n[id]) delete n[id]; else n[id] = type;
      return n;
    });
  }
  function toggleSelectAll() {
    if (allSelected) setSelected({});
    else setSelected(Object.fromEntries(selectableTop.map(x => [x.id, x.type])));
  }

  function toggleExpand(id: string, onExpand?: () => void) {
    // Guard against double-click firing two toggles (which would cancel out).
    const now = Date.now();
    if (lastRowClick.current.id === id && now - lastRowClick.current.at < 350) return;
    lastRowClick.current = { id, at: now };
    const expanding = !expandedFolders.has(id);
    if (!expanding) {
      // Re-lock protected folders on collapse (session key cleared) so next expand asks password.
      if (getFolderKey(id)) {
        import('../services/crypto.service').then(m => m.setFolderKey(id, null));
        setSidebarItems(s => { const n = { ...s }; delete n[id]; return n; });
      }
      setInlineUnlockId(cur => (cur === id ? null : cur));
      setClosingFolders(s => { const n = new Set(s); n.add(id); return n; });
      window.setTimeout(() => {
        setExpandedFolders(s => { const n = new Set(s); n.delete(id); return n; });
        setClosingFolders(s => { const n = new Set(s); n.delete(id); return n; });
      }, 160);
    } else {
      setClosingFolders(s => { const n = new Set(s); n.delete(id); return n; });
      window.setTimeout(() => {
        setExpandedFolders(s => { const n = new Set(s); n.add(id); return n; });
        onExpand?.();
      }, 50);
    }
  }

  function folderName(id: string) {
    return names[id] ?? treeNames[id] ?? 'Folder';
  }

  function fmtSize(bytes?: number) {
    if (!bytes || bytes <= 0) return '—';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  // Back one level without needing the breadcrumb stack to be in sync.
  function goUp() {
    const current = treeFolders.find(f => f.id === parentId) ?? folders.find(f => f.id === parentId);
    const upId = current?.parentId ?? null;
    const up = upId ? (treeFolders.find(f => f.id === upId) ?? null) : null;
    leaveCurrentFolder();
    setCrumbs(pathTo(up));
    setParentId(upId);
    if (up && up.protection === 'protected' && !getFolderKey(up.id)) setLockedId(up.id);
  }

  function pathTo(f: DbFolder | null) {
    const path: { id: string | null; name: string }[] = [{ id: null, name: 'All' }];
    const chain: DbFolder[] = [];
    let cur: DbFolder | null | undefined = f;
    while (cur) {
      chain.unshift(cur);
      cur = cur.parentId ? treeFolders.find(x => x.id === cur!.parentId) : null;
    }
    for (const c of chain) path.push({ id: c.id, name: treeNames[c.id] ?? names[c.id] ?? 'Folder' });
    return path;
  }

  function pathStringForFolder(id: string | null): string {
    if (!id) return 'All';
    const f = treeFolders.find(x => x.id === id) || null;
    return pathTo(f).map(c => c.name).join(' / ');
  }

  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) { setSearchResults(null); setSearchBusy(false); return; }
    let cancelled = false;
    setSearchBusy(true);
    const t = window.setTimeout(async () => {
      try {
        const folderHits = treeFolders
          .map(f => {
            const name = treeNames[f.id] ?? 'Folder';
            const locked = f.protection === 'protected' && !getFolderKey(f.id);
            return { id: f.id, name, path: pathStringForFolder(f.id), locked };
          })
          .filter(f => f.name.toLowerCase().includes(q))
          .slice(0, 60);
        const allItems = await db.items.toArray();
        const itemHits: { id: string; name: string; kind: string; size?: number; mime?: string; parentId: string | null; path: string }[] = [];
        for (const it of allItems) {
          let nm = searchItemNames.current[it.id];
          if (!nm) {
            try { nm = (await getItemMeta(it)).name; searchItemNames.current[it.id] = nm; } catch { continue; }
          }
          if (!nm.toLowerCase().includes(q)) continue;
          itemHits.push({ id: it.id, name: nm, kind: it.kind, size: it.size, mime: it.mime, parentId: it.parentId, path: pathStringForFolder(it.parentId) });
          if (itemHits.length >= 80) break;
        }
        if (!cancelled) setSearchResults({ folders: folderHits, items: itemHits });
      } finally {
        if (!cancelled) setSearchBusy(false);
      }
    }, 220);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [searchQuery, treeFolders, treeNames]);

  async function goToSearchFolder(id: string) {
    const f = treeFolders.find(x => x.id === id);
    if (!f) return;
    setSearchQuery(''); setSearchResults(null);
    await openFolder(f);
  }

  async function goToSearchItem(hit: { id: string; name: string; kind: string; size?: number; mime?: string; parentId: string | null }) {
    if (hit.kind !== 'txt' && hit.kind !== 'md') {
      if (hit.kind === 'file' && getViewKind(hit.mime, hit.name)) {
        setSearchQuery(''); setSearchResults(null);
        await openFileViewer(hit.id);
        return;
      }
      // Navigate to its parent folder for non-editor files
      if (hit.parentId) { const pf = treeFolders.find(x => x.id === hit.parentId); if (pf) { setSearchQuery(''); setSearchResults(null); await openFolder(pf); } }
      else { setSearchQuery(''); setSearchResults(null); leaveCurrentFolder(); setLockedId(null); setParentId(null); setCrumbs([{ id: null, name: 'All' }]); }
      return;
    }
    setSearchQuery(''); setSearchResults(null);
    if (hit.parentId) {
      const pf = treeFolders.find(x => x.id === hit.parentId) || null;
      if (pf) {
        leaveCurrentFolder();
        setLockedId(null);
        setCrumbs(pathTo(pf));
        setParentId(pf.id);
      }
    } else {
      leaveCurrentFolder();
      setLockedId(null);
      setParentId(null);
      setCrumbs([{ id: null, name: 'All' }]);
    }
    // ensure names include the hit so editor chrome can resolve
    setNames(n => ({ ...n, [hit.id]: hit.name }));
    setEditingId(hit.id);
  }

  // File-explorer style rows: expanding a folder lists its subfolders inline.
  // Locked folders never expand — clicking them opens the password card.
  function renderFolderRows(parent: string | null, depth: number, closing = false): React.ReactNode {
    const kids = treeChildren.get(parent) ?? [];
    return kids.map(f => {
      const fname = folderName(f.id);
      const isProtected = f.protection === 'protected';
      const locked = isProtected && !getFolderKey(f.id);
      const hasSubfolders = (treeChildren.get(f.id)?.length ?? 0) > 0;
      const hasFiles = foldersWithItems.has(f.id) || (sidebarItems[f.id]?.length ?? 0) > 0;
      const canExpand = isProtected || hasSubfolders || hasFiles;
      const expanded = expandedFolders.has(f.id);
      const nested = depth > 0;
      const anim = nested ? (closing ? 'row-slide-out' : 'row-slide-in') : '';
      const cellPy = nested ? 'py-0' : 'py-1';
      const innerPy = nested ? 'py-1' : '';
      return (
        <Fragment key={f.id}>
          <tr className={`group border-b border-zinc-100 hover:bg-zinc-50 focus-within:bg-zinc-50 ${nested ? 'bg-zinc-50/30' : ''}`}>
            <td className={`px-3 ${cellPy}`}>
              <div className={nested ? `${anim} ${innerPy}` : ''}>
                <div className="flex items-center gap-1" style={{ paddingLeft: depth * 16 }}>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (locked) { setUnlockPw(''); setUnlockErr(''); setInlineUnlockId(cur => (cur === f.id ? null : f.id)); return; }
                      if (!canExpand) return;
                      toggleExpand(f.id, () => void loadSidebarItems(f.id));
                    }}
                    className={`p-1 rounded text-zinc-400 hover:text-zinc-900 shrink-0 ${canExpand ? '' : 'invisible'}`}
                    aria-label={expanded ? `Collapse ${fname}` : `Expand ${fname}`}
                    aria-expanded={expanded}
                    tabIndex={canExpand ? 0 : -1}
                  >
                    <ChevronRight size={12} className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
                  </button>
                  <button
                    onClick={() => {
                      if (locked) {
                        setUnlockPw(''); setUnlockErr('');
                        setInlineUnlockId(cur => (cur === f.id ? null : f.id));
                        void loadSidebarItems(f.id);
                        return;
                      }
                      if (canExpand) toggleExpand(f.id, () => void loadSidebarItems(f.id));
                    }}
                    title={locked ? 'Locked folder — unlock' : (canExpand ? (expanded ? 'Collapse folder' : 'Expand folder') : 'Folder')}
                    className="flex items-center gap-2 py-1.5 w-full text-left rounded px-1 min-w-0"
                  >
                    <Folder size={15} className="text-zinc-500 shrink-0" />
                    <span className="truncate">{fname}</span>
                    {f.protection === 'protected' && <span title="Locked" className="ml-0.5 flex items-center gap-1 text-[10px] leading-none text-zinc-600 border border-zinc-300 bg-zinc-100 rounded px-1 py-0.5 shrink-0"><Lock size={10} /> locked</span>}
                  </button>
                </div>
              </div>
            </td>
            <td className={`px-3 text-xs text-zinc-500 ${cellPy}`}>
              <div className={nested ? `${anim} ${innerPy} flex items-center` : ''}>Folder</div>
            </td>
            <td className={`px-3 text-xs text-zinc-500 hidden sm:table-cell ${cellPy}`}>
              <div className={nested ? `${anim} ${innerPy} flex items-center` : ''}>{fmtSize(folderSizes[f.id])}</div>
            </td>
            <td className={`px-2 ${cellPy}`}>
              <div className={`${nested ? `${anim} ${innerPy}` : ''} flex items-center justify-end gap-1`}>
                <input type="checkbox" checked={!!selected[f.id]} onChange={() => toggleSelect(f.id, 'folder')} onClick={e => e.stopPropagation()} className="h-3.5 w-3.5 rounded border-zinc-300" aria-label={`Select ${fname}`} />
                <button onClick={(e) => openMenuAt(f.id, e)} className="p-1.5 rounded text-zinc-400 hover:text-zinc-900" aria-label="Options" aria-haspopup="menu" aria-expanded={menuId === f.id}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                </button>
              </div>
            </td>
          </tr>
          {inlineUnlockId === f.id && (
            <tr className="border-b border-zinc-100 bg-zinc-50/40">
              <td colSpan={4} className="px-3 py-3">
                <div style={{ paddingLeft: (depth + 1) * 16 }}>
                  <form onSubmit={(e) => { e.preventDefault(); void doUnlock(f.id); }} className="max-w-sm space-y-2">
                    <p className="text-xs text-zinc-600 flex items-center gap-1.5"><Lock size={12} /> Enter password for <span className="font-medium text-zinc-800">{fname}</span></p>
                    <input type="password" value={unlockPw} onChange={e => { setUnlockPw(e.target.value); setUnlockErr(''); }} placeholder="Folder password" autoComplete="current-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} className="w-full border border-zinc-300 rounded px-3 py-2 text-sm bg-white focus:border-zinc-900" />
                    {unlockErr && <p className="text-xs text-red-600">{unlockErr}</p>}
                    <div className="flex items-center gap-2">
                      <button type="submit" disabled={busy} className="px-3 py-1.5 text-sm rounded bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50">{busy ? 'Unlocking…' : 'Unlock'}</button>
                      <button type="button" onClick={() => { setInlineUnlockId(null); setUnlockPw(''); setUnlockErr(''); }} className="px-3 py-1.5 text-sm rounded border border-zinc-300 hover:bg-zinc-50">Cancel</button>
                    </div>
                  </form>
                </div>
              </td>
            </tr>
          )}
          {(expandedFolders.has(f.id) || closingFolders.has(f.id)) && !locked && (
            <>
              {renderFolderRows(f.id, depth + 1, closingFolders.has(f.id))}
              {Array.isArray(sidebarItems[f.id]) && (treeChildren.get(f.id)?.length ?? 0) === 0 && (sidebarItems[f.id] || []).length === 0 && (
                <tr className="border-b border-zinc-100 bg-zinc-50/30">
                  <td colSpan={4} className="px-3 py-2 text-xs text-zinc-500" style={{ paddingLeft: (depth + 1) * 16 + 12 }}>This folder is empty.</td>
                </tr>
              )}
              {(sidebarItems[f.id] || []).map(it => {
                const childClosing = closingFolders.has(f.id);
                const childAnim = childClosing ? 'row-slide-out' : 'row-slide-in';
                return (
                  <tr key={it.id} className="group border-b border-zinc-100 hover:bg-zinc-50 focus-within:bg-zinc-50 bg-zinc-50/30">
                    <td className="px-3 py-0">
                      <div className={`${childAnim} py-1`}>
                        <div className="flex items-center gap-1" style={{ paddingLeft: (depth + 1) * 16 }}>
                          <span className="shrink-0 w-5 h-5" aria-hidden />
                          {it.kind === 'txt' || it.kind === 'md' ? (
                            <button onClick={() => openEditor(it.id)} className="flex items-center gap-2 py-1.5 w-full text-left rounded px-1 min-w-0">
                              <FileText size={15} className="text-zinc-500 shrink-0" />
                              <span className="truncate">{it.name}</span>
                            </button>
                          ) : it.kind === 'file' && getViewKind(it.mime, it.name) ? (
                            <button onClick={() => void openFileViewer(it.id)} className="flex items-center gap-2 py-1.5 w-full text-left rounded px-1 min-w-0">
                              <File size={15} className="text-zinc-500 shrink-0" />
                              <span className="truncate">{it.name}</span>
                            </button>
                          ) : (
                            <span className="flex items-center gap-2 py-1.5 px-1 min-w-0">
                              <File size={15} className="text-zinc-500 shrink-0" />
                              <span className="truncate">{it.name}</span>
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 text-xs text-zinc-500 py-0"><div className={`${childAnim} py-1 flex items-center`}>{it.kind.toUpperCase()}</div></td>
                    <td className="px-3 text-xs text-zinc-500 hidden sm:table-cell py-0"><div className={`${childAnim} py-1 flex items-center`}>{fmtSize(it.size)}</div></td>
                    <td className="px-2 py-0">
                      <div className={`${childAnim} py-1 flex items-center justify-end gap-1`}>
                        <input type="checkbox" checked={!!selected[it.id]} onChange={() => toggleSelect(it.id, 'item')} onClick={e => e.stopPropagation()} className="h-3.5 w-3.5 rounded border-zinc-300" aria-label={`Select ${it.name}`} />
                        <button onClick={(e) => openMenuAt(it.id, e)} className="p-1.5 rounded text-zinc-400 hover:text-zinc-900" aria-label="Options" aria-haspopup="menu" aria-expanded={menuId === it.id}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </>
          )}
        </Fragment>
      );
    });
  }

  return (
    <div className="h-full flex bg-[#fafafa]">
      {navOpen && <button aria-hidden tabIndex={-1} onClick={() => setNavOpen(false)} className="fixed inset-0 z-10 bg-black/20 md:hidden cursor-default" />}
      <aside className={`${navOpen ? 'flex' : 'hidden'} md:flex absolute md:static z-20 h-full w-52 shrink-0 flex-col border-r border-zinc-200 bg-white`}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-zinc-100">
          <div className="flex h-6 w-6 items-center justify-center bg-zinc-900 text-white text-xs rounded">V</div>
          <span className="text-sm font-semibold tracking-tight">All</span>
          <button className="ml-auto md:hidden text-zinc-500" onClick={() => setNavOpen(false)} aria-label="Close menu">✕</button>
        </div>
        <nav className="flex-1 overflow-auto p-1.5">
          <p className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-400">All</p>
          <button
            onClick={() => { leaveCurrentFolder(); setDecoySearchQuery(''); if (decoyMode) setDecoyMode(null); setCrumbs([{ id: null, name: 'All' }]); setParentId(null); }}
            className={`w-full flex items-center gap-1.5 px-2 py-1 text-xs rounded hover:bg-zinc-100 ${parentId === null && !decoyMode ? 'bg-zinc-100 font-medium' : 'text-zinc-700'}`}
          >
            <FolderOpen size={12} className="text-zinc-500" /> ALL
          </button>
          {!decoyMode && renderTree(null, 0)}
          {!decoyMode && (sidebarItems['root'] || []).map(it => (
            <div
              key={it.id}
              className="group relative flex items-center gap-0.5 pr-2 rounded hover:bg-zinc-100 text-zinc-600"
              style={{ paddingLeft: '1.25rem' }}
            >
              <button
                onClick={() => { if (it.kind === 'txt' || it.kind === 'md') openEditor(it.id); }}
                className="flex-1 flex items-center gap-1.5 py-1 text-xs text-left min-w-0"
                title={it.name}
              >
                {it.kind === 'txt' || it.kind === 'md' ? <FileText size={12} className="shrink-0 text-zinc-400" /> : <File size={12} className="shrink-0 text-zinc-400" />}
                <span className="truncate">{it.name}</span>
                {it.size ? <span className="ml-auto shrink-0 text-[10px] text-zinc-400 tabular-nums">{fmtSize(it.size)}</span> : null}
              </button>
              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-100">
                <button onClick={(e) => { e.stopPropagation(); openMenuAt(it.id, e); }} className="p-1 rounded text-zinc-400 hover:text-zinc-900" aria-label="Options">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                </button>
              </div>
            </div>
          ))}
        </nav>

        <div className="p-2 border-t border-zinc-100 space-y-2">
          {storage && <p className="flex items-center gap-1.5 px-2 text-xs text-zinc-500"><HardDrive size={12} />{storage}</p>}
          <button onClick={() => { setSettingsTab('menu'); setShowSettings(true); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm rounded hover:bg-zinc-100 text-zinc-700">
            <Settings size={14} /> Settings
          </button>
          <button onClick={lock} className="w-full flex items-center gap-2 px-2.5 py-1.5 text-sm rounded hover:bg-red-50 text-red-600">
            <LogOut size={14} /> Lock vault
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 relative">
        <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 md:hidden">
          <button className="p-1.5 text-zinc-600" onClick={() => setNavOpen(true)} aria-label="Menu">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
          </button>
          <span className="text-sm font-medium text-zinc-700 truncate">All</span>
        </header>

        <div className="flex-1 overflow-auto min-h-0 flex flex-col pb-20">
          {editingId || (decoyMode && decoyEditingId) ? (
            <div>
              <div className="max-w-4xl mx-auto mt-4 mb-2 h-10" />
              <table className="w-full table-fixed text-sm bg-white mx-auto max-w-4xl mt-0 border border-zinc-200 rounded-t-lg overflow-hidden border-b-0">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 border-b border-zinc-200 bg-zinc-50">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium w-20">Type</th>
                    <th className="px-3 py-2 font-medium w-24 hidden sm:table-cell">Size</th>
                    <th className="px-2 py-2 font-medium w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const editingFile = editingId ? (items.find(i => i.id === editingId) ?? Object.values(sidebarItems).flat().find(x => x.id === editingId)) : null;
                    const editingName = editingId ? (names[editingId] || (editingFile && 'name' in editingFile ? editingFile.name : '') || 'File') : null;
                    const decoyDoc = decoyEditingId && decoyMode ? decoyMode.tree.docs.find(d => d.id === decoyEditingId) : null;
                    const fileCrumb = editingId && editingName ? { id: editingId, name: editingName } : (decoyDoc ? { id: decoyDoc.id, name: decoyDoc.name } : null);
                    const displayCrumbs = fileCrumb ? [...crumbs, fileCrumb] : crumbs;
                    const typeLabel = editingId ? ((editingFile?.kind || 'file').toUpperCase()) : decoyDoc ? decoyDoc.kind.toUpperCase() : 'Folder';
                    const sizeLabel = editingId ? fmtSize(editingFile?.size) : decoyDoc ? fmtSize(new TextEncoder().encode(decoyDoc.text || '').byteLength) : fmtSize(parentId ? folderSizes[parentId] : undefined);
                    return (
                      <tr className="bg-zinc-100 border-b-2 border-zinc-300">
                        <td className="px-3 py-1 overflow-hidden">
                          <div className="flex items-center gap-1 py-1.5 w-full text-left rounded px-1 -mx-1 min-w-0">
                            <button
                              type="button"
                              onClick={() => {
                                if (editingId) void closeEditor();
                                else if (decoyMode && decoyEditingId) setDecoyEditingId(null);
                              }}
                              className="p-1 rounded text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 shrink-0"
                              aria-label="Back"
                              title="Back"
                            >
                              <Undo2 size={15} />
                            </button>
                            <nav aria-label="Folder path" className="flex items-center gap-0.5 min-w-0 flex-1 overflow-hidden text-sm">
                              {displayCrumbs.map((c, i) => (
                                <span key={`${c.id}-${i}`} className="flex items-center gap-0.5 min-w-0 shrink">
                                  {i > 0 && <ChevronRight size={12} className="text-zinc-400 shrink-0" />}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (fileCrumb && c.id === fileCrumb.id) return;
                                      if (editingId) void closeEditor().then(() => goCrumb(c, i));
                                      else if (decoyEditingId) { setDecoyEditingId(null); goCrumb(c, i); }
                                      else goCrumb(c, i);
                                    }}
                                    className={`truncate max-w-[12rem] px-0.5 py-0.5 rounded ${i === displayCrumbs.length - 1 ? 'font-medium text-zinc-900' : 'text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'}`}
                                    title={c.name}
                                  >
                                    {c.name}
                                  </button>
                                </span>
                              ))}
                            </nav>
                          </div>
                        </td>
                        <td className="px-3 py-1 text-xs text-zinc-600 font-medium">{typeLabel}</td>
                        <td className="px-3 py-1 text-xs text-zinc-600 hidden sm:table-cell">{sizeLabel}</td>
                        <td className="px-2 py-1"></td>
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
              <div className="max-w-4xl mx-auto bg-white border border-t-0 border-zinc-200 rounded-b-lg overflow-hidden mb-4 flex flex-col h-[60vh] min-h-[400px]">
                {editingId ? (
                  <EditorPage itemId={editingId} onClose={() => void closeEditor()} />
                ) : decoyMode && decoyEditingId ? (
                  <DecoyEditorInline
                    folderId={decoyMode.folderId}
                    docId={decoyEditingId}
                    tree={decoyMode.tree}
                    onTreeChange={tree => setDecoyMode(m => m ? { ...m, tree } : m)}
                    onClose={() => setDecoyEditingId(null)}
                  />
                ) : null}
              </div>
            </div>
          ) : decoyMode ? (
            <div>
              {(() => {
                const dq = decoySearchQuery.trim().toLowerCase();
                const decoyFolderPath = (folderId: string | null): string => {
                  const parts = ['All', decoyMode.tree.name];
                  if (!folderId) return parts.join(' / ');
                  const chain: typeof decoyMode.tree.folders = [];
                  let cur = decoyMode.tree.folders.find(f => f.id === folderId);
                  while (cur) { chain.unshift(cur); cur = cur.parentId ? decoyMode.tree.folders.find(f => f.id === cur!.parentId) : undefined; }
                  for (const c of chain) parts.push(c.name);
                  return parts.join(' / ');
                };
                const dFolderHits = dq ? decoyMode.tree.folders.filter(f => f.name.toLowerCase().includes(dq)).map(f => ({ id: f.id, name: f.name, path: decoyFolderPath(f.id) })) : [];
                const dDocHits = dq ? decoyMode.tree.docs.filter(d => d.name.toLowerCase().includes(dq)).map(d => ({ id: d.id, name: d.name, kind: d.kind, path: decoyFolderPath(d.folderId) })) : [];
                const openDecoyFolderById = (folderId: string) => {
                  setDecoySearchQuery('');
                  const chain: string[] = [folderId];
                  let cur = decoyMode.tree.folders.find(f => f.id === folderId);
                  while (cur?.parentId) { chain.unshift(cur.parentId); cur = decoyMode.tree.folders.find(f => f.id === cur!.parentId); }
                  setDecoyExpanded(s => { const n = new Set(s); for (const id of chain) n.add(id); return n; });
                  setCrumbs([{ id: null, name: 'All' }, { id: null, name: decoyMode.tree.name }]);
                  setDecoyMode(m => m ? { ...m, subId: null } : m);
                };
                const openDecoyDocHit = (docId: string, folderId: string | null) => {
                  setDecoySearchQuery('');
                  if (folderId) {
                    const chain: string[] = [];
                    let cur = decoyMode.tree.folders.find(f => f.id === folderId);
                    while (cur) { chain.unshift(cur.id); cur = cur.parentId ? decoyMode.tree.folders.find(f => f.id === cur!.parentId) : undefined; }
                    setDecoyExpanded(s => { const n = new Set(s); for (const id of chain) n.add(id); return n; });
                  }
                  setCrumbs([{ id: null, name: 'All' }, { id: null, name: decoyMode.tree.name }]);
                  setDecoyMode(m => m ? { ...m, subId: null } : m);
                  openDecoyDoc(docId);
                };
                const toggleDecoyExpand = (id: string) => setDecoyExpanded(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
                const renderDecoyRows = (pid: string | null, depth: number): React.ReactNode[] => {
                  const folders = decoyMode.tree.folders.filter(f => f.parentId === pid);
                  const docs = decoyMode.tree.docs.filter(d => d.folderId === pid);
                  const rows: React.ReactNode[] = [];
                  for (const f of folders) {
                    const expanded = decoyExpanded.has(f.id);
                    const hasChildren = decoyMode.tree.folders.some(x => x.parentId === f.id) || decoyMode.tree.docs.some(x => x.folderId === f.id);
                    rows.push(
                      <tr key={f.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                        <td className="px-3 py-1 overflow-hidden">
                          <div className="flex items-center gap-1 min-w-0" style={{ paddingLeft: depth * 16 }}>
                            <button
                              type="button"
                              onClick={() => toggleDecoyExpand(f.id)}
                              aria-label={expanded ? `Collapse ${f.name}` : `Expand ${f.name}`}
                              aria-expanded={expanded}
                              className={`p-0.5 rounded text-zinc-400 hover:text-zinc-900 shrink-0 ${hasChildren ? '' : 'invisible'}`}
                              tabIndex={hasChildren ? 0 : -1}
                            >
                              <ChevronRight size={14} className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`} />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleDecoyExpand(f.id)}
                              title={hasChildren ? (expanded ? 'Collapse folder' : 'Expand folder') : 'Folder'}
                              className="flex items-center gap-2 py-1.5 w-full text-left rounded px-1 min-w-0"
                            >
                              <Folder size={15} className="text-zinc-500 shrink-0" />
                              <span className="truncate">{f.name}</span>
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-1 text-xs text-zinc-500">Folder</td>
                        <td className="px-3 py-1 text-xs text-zinc-500 hidden sm:table-cell">—</td>
                        <td className="px-3 py-1 overflow-hidden">
                          <button onClick={async () => { await persistDecoyTree({ ...decoyMode.tree, folders: decoyMode.tree.folders.filter(x => x.id !== f.id), docs: decoyMode.tree.docs.filter(x => x.folderId !== f.id) }); setDecoyExpanded(s => { const n = new Set(s); n.delete(f.id); return n; }); }} className="p-1.5 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50" aria-label="Delete decoy folder"><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    );
                    if (expanded) {
                      if (hasChildren) rows.push(...renderDecoyRows(f.id, depth + 1));
                      else rows.push(<tr key={`${f.id}-empty`} className="border-b border-zinc-100 bg-zinc-50/30"><td colSpan={4} className="px-3 py-2"><div style={{ paddingLeft: (depth + 1) * 16 + 24 }} className="text-xs text-zinc-500">This folder is empty.</div></td></tr>);
                    }
                  }
                  for (const d of docs) {
                    rows.push(
                      <tr key={d.id} className="border-b border-zinc-100 hover:bg-zinc-50">
                        <td className="px-3 py-1 overflow-hidden">
                          <div className="flex items-center gap-1 min-w-0" style={{ paddingLeft: depth * 16 }}>
                            <span className="shrink-0 w-5 h-5" aria-hidden />
                            <button onClick={() => { setDecoySearchQuery(''); openDecoyDoc(d.id); }} className="flex items-center gap-2 py-1.5 w-full text-left rounded px-1 min-w-0 overflow-hidden">
                              <FileText size={15} className="text-zinc-500 shrink-0" />
                              <span className="truncate">{d.name}</span>
                            </button>
                          </div>
                        </td>
                        <td className="px-3 py-1 text-xs text-zinc-500">{d.kind.toUpperCase()}</td>
                        <td className="px-3 py-1 text-xs text-zinc-500 hidden sm:table-cell">—</td>
                        <td className="px-3 py-1 overflow-hidden">
                          <button onClick={async () => { await persistDecoyTree({ ...decoyMode.tree, docs: decoyMode.tree.docs.filter(x => x.id !== d.id) }); }} className="p-1.5 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50" aria-label="Delete decoy document"><Trash2 size={13} /></button>
                        </td>
                      </tr>
                    );
                  }
                  return rows;
                };
                return (
                  <>
                    <div className="max-w-4xl mx-auto mt-4 mb-2 px-3 sm:px-0">
                      <div className="relative">
                        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                        <input
                          type="text"
                          value={decoySearchQuery}
                          onChange={e => setDecoySearchQuery(e.target.value)}
                          placeholder="Search all folders and files..."
                          className="w-full h-10 pl-9 pr-9 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
                          aria-label="Search decoy folders and files"
                        />
                        {decoySearchQuery && (
                          <button type="button" onClick={() => setDecoySearchQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-zinc-400 hover:text-zinc-900" aria-label="Clear search">
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                    {dq ? (
                      <div className="max-w-4xl mx-auto mb-4 border border-zinc-200 rounded-lg bg-white overflow-hidden">
                        <div className="px-3 py-2 text-xs text-zinc-500 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                          <span>{dFolderHits.length + dDocHits.length} results</span>
                          {dFolderHits.length === 0 && dDocHits.length === 0 && <span>No matches</span>}
                        </div>
                        {(dFolderHits.length > 0 || dDocHits.length > 0) && (
                          <div className="max-h-[60vh] overflow-auto">
                            {dFolderHits.length > 0 && <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 bg-zinc-50/50 border-b border-zinc-100">Folders</div>}
                            {dFolderHits.map(f => (
                              <button key={f.id} type="button" onClick={() => openDecoyFolderById(f.id)} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 text-left border-b border-zinc-100 last:border-b-0">
                                <Folder size={15} className="text-zinc-500 shrink-0" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate">{f.name}</span>
                                  <span className="block text-[11px] text-zinc-400 truncate">{f.path}</span>
                                </span>
                              </button>
                            ))}
                            {dDocHits.length > 0 && <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 bg-zinc-50/50 border-b border-zinc-100">Files</div>}
                            {dDocHits.map(d => (
                              <button key={d.id} type="button" onClick={() => openDecoyDocHit(d.id, decoyMode.tree.docs.find(x => x.id === d.id)?.folderId ?? null)} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 text-left border-b border-zinc-100 last:border-b-0">
                                <FileText size={15} className="text-zinc-400 shrink-0" />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate">{d.name}</span>
                                  <span className="block text-[11px] text-zinc-400 truncate">{d.path}</span>
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      <table className="w-full table-fixed text-sm bg-white mx-auto max-w-4xl mt-0 mb-4 border border-zinc-200 rounded-lg overflow-hidden">
                        <thead>
                          <tr className="text-left text-xs text-zinc-500 border-b border-zinc-200 bg-zinc-50">
                            <th className="px-3 py-2 font-medium">Name</th>
                            <th className="px-3 py-2 font-medium w-20">Type</th>
                            <th className="px-3 py-2 font-medium w-24 hidden sm:table-cell">Size</th>
                            <th className="px-2 py-2 font-medium w-20"></th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="bg-zinc-100 border-b-2 border-zinc-300">
                            <td className="px-3 py-1 overflow-hidden">
                              <div className="flex items-center gap-2 py-1.5 w-full text-left rounded px-1 -mx-1 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => goCrumb(crumbs[Math.max(0, crumbs.length - 2)], Math.max(0, crumbs.length - 2))}
                                  className="p-1 rounded text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 shrink-0"
                                  aria-label="Go up one level"
                                  title="Up one level"
                                >
                                  <Undo2 size={15} />
                                </button>
                                <nav aria-label="Folder path" className="flex items-center gap-0.5 min-w-0 flex-1 overflow-hidden text-sm">
                                  {crumbs.map((c, i) => (
                                    <span key={i} className="flex items-center gap-0.5 min-w-0 shrink">
                                      {i > 0 && <ChevronRight size={12} className="text-zinc-400 shrink-0" />}
                                      <button
                                        type="button"
                                        onClick={() => goCrumb(c, i)}
                                        className={`truncate max-w-[10rem] px-0.5 py-0.5 rounded ${i === crumbs.length - 1 ? 'font-medium text-zinc-900' : 'text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'}`}
                                        title={c.name}
                                      >
                                        {c.name}
                                      </button>
                                    </span>
                                  ))}
                                </nav>
                              </div>
                            </td>
                            <td className="px-3 py-1 text-xs text-zinc-600 font-medium">Folder</td>
                            <td className="px-3 py-1 text-xs text-zinc-600 hidden sm:table-cell">—</td>
                            <td className="px-3 py-1 overflow-hidden"></td>
                          </tr>
                          {renderDecoyRows(null, 0)}
                          {!decoyHasRootContent && (
                            <tr><td colSpan={4} className="px-3 py-10 text-center text-sm text-zinc-500">This folder is empty. Create or upload to get started.</td></tr>
                          )}
                        </tbody>
                      </table>
                    )}
                    <div className="max-w-4xl mx-auto mt-2 mb-4 flex justify-start px-1">
                      <div className="relative">
                        <button
                          type="button"
                          onClick={openPlusMenu}
                          className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-800 shadow-md"
                          aria-label="Add"
                          aria-haspopup="menu"
                          aria-expanded={folderActionsOpen}
                          title="Create in decoy"
                        >
                          <Plus size={20} />
                        </button>
                        {folderActionsOpen && plusMenuPos && (
                          <>
                            <button aria-hidden tabIndex={-1} onClick={closePlusMenu} className="fixed inset-0 z-30 cursor-default" />
                            <div className="fixed z-40 w-48 border border-zinc-200 bg-white rounded-md shadow-lg py-1 max-h-[calc(100vh-16px)] overflow-auto" role="menu" style={{ top: plusMenuPos.top, bottom: plusMenuPos.bottom, left: plusMenuPos.left }}>
                              <button onClick={async () => { closePlusMenu(); await persistDecoyTree({ ...decoyMode.tree, folders: [...decoyMode.tree.folders, { id: newDecoyId(), parentId: null, name: 'New folder' }] }); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 text-left"><Folder size={14} /> New folder</button>
                              <button onClick={async () => { closePlusMenu(); await persistDecoyTree({ ...decoyMode.tree, docs: [...decoyMode.tree.docs, { id: newDecoyId(), folderId: null, name: 'New document.txt', kind: 'txt', text: '' }] }); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 text-left"><FileText size={14} /> New document</button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          ) : (
            <div>
              <div className="max-w-4xl mx-auto mt-4 mb-2 px-3 sm:px-0">
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Search all folders and files..."
                    className="w-full h-10 pl-9 pr-9 text-sm border border-zinc-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-zinc-300"
                    aria-label="Search all folders and files"
                  />
                  {searchQuery && (
                    <button type="button" onClick={() => { setSearchQuery(''); setSearchResults(null); }} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-zinc-400 hover:text-zinc-900" aria-label="Clear search">
                      <X size={14} />
                    </button>
                  )}
                </div>
              </div>
              {searchQuery.trim() ? (
                <div className="max-w-4xl mx-auto mb-4 border border-zinc-200 rounded-lg bg-white overflow-hidden">
                  <div className="px-3 py-2 text-xs text-zinc-500 border-b border-zinc-200 bg-zinc-50 flex items-center justify-between">
                    <span>{searchBusy ? 'Searching…' : `${(searchResults?.folders.length ?? 0) + (searchResults?.items.length ?? 0)} results`}</span>
                    {!searchBusy && searchResults && searchResults.folders.length === 0 && searchResults.items.length === 0 && <span>No matches</span>}
                  </div>
                  {!searchBusy && searchResults && (searchResults.folders.length > 0 || searchResults.items.length > 0) && (
                    <div className="max-h-[60vh] overflow-auto">
                      {searchResults.folders.length > 0 && <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 bg-zinc-50/50 border-b border-zinc-100">Folders</div>}
                      {searchResults.folders.map(f => (
                        <button key={f.id} type="button" onClick={() => void goToSearchFolder(f.id)} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 text-left border-b border-zinc-100 last:border-b-0">
                          <Folder size={15} className="text-zinc-500 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{f.name}</span>
                            <span className="block text-[11px] text-zinc-400 truncate">{f.path}{f.locked ? ' · locked' : ''}</span>
                          </span>
                          {f.locked && <Lock size={12} className="text-zinc-400 shrink-0" />}
                        </button>
                      ))}
                      {searchResults.items.length > 0 && <div className="px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400 bg-zinc-50/50 border-b border-zinc-100">Files</div>}
                      {searchResults.items.map(it => (
                        <button key={it.id} type="button" onClick={() => void goToSearchItem(it)} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-50 text-left border-b border-zinc-100 last:border-b-0">
                          {it.kind === 'txt' || it.kind === 'md' ? <FileText size={15} className="text-zinc-400 shrink-0" /> : <File size={15} className="text-zinc-400 shrink-0" />}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{it.name}</span>
                            <span className="block text-[11px] text-zinc-400 truncate">{it.path}</span>
                          </span>
                          <span className="text-[11px] text-zinc-400 shrink-0 tabular-nums">{fmtSize(it.size)}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
              <>
              <div className="max-w-4xl mx-auto mt-0 mb-2 h-10">
                {selectedCount > 0 && (
                  <div className="h-full flex items-center justify-between gap-2 px-3 bg-zinc-100 border border-zinc-200 rounded-lg text-sm">
                    <span className="text-zinc-700">{selectedCount} selected</span>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setSelected({})} className="px-2.5 py-1.5 text-xs rounded border border-zinc-300 bg-white hover:bg-zinc-50">Clear</button>
                      <button type="button" onClick={() => setBulkDeleteOpen(true)} className="px-2.5 py-1.5 text-xs rounded border border-red-600 text-red-600 hover:bg-red-600 hover:text-white">Delete selected</button>
                    </div>
                  </div>
                )}
              </div>
              <table className="w-full table-fixed text-sm bg-white mx-auto max-w-4xl mt-0 mb-4 border border-zinc-200 rounded-lg overflow-hidden">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 border-b border-zinc-200 bg-zinc-50">
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium w-20">Type</th>
                    <th className="px-3 py-2 font-medium w-24 hidden sm:table-cell">Size</th>
                    <th className="px-2 py-2 font-medium w-20">
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          disabled={selectableTop.length === 0}
                          className="h-3.5 w-3.5 rounded border-zinc-300"
                          aria-label="Select all"
                          title="Select all"
                        />
                        <span className="w-[26px] h-[26px] shrink-0" aria-hidden />
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {parentId && (() => {
                    const current = treeFolders.find(f => f.id === parentId) ?? folders.find(f => f.id === parentId);
                    if (!current) return null;
                    return (
                      <Fragment>
                        <tr className="bg-zinc-100 border-b-2 border-zinc-300">
                          <td className="px-3 py-1 overflow-hidden">
                            <div className="flex items-center gap-2 py-1.5 w-full text-left rounded px-1 -mx-1 min-w-0">
                              <button
                                type="button"
                                onClick={goUp}
                                className="p-1 rounded text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900 shrink-0"
                                aria-label="Go up one level"
                                title="Up one level"
                              >
                                <Undo2 size={15} />
                              </button>
                              <nav aria-label="Folder path" className="flex items-center gap-0.5 min-w-0 flex-1 overflow-hidden text-sm">
                                {crumbs.map((c, i) => (
                                  <span key={i} className="flex items-center gap-0.5 min-w-0 shrink">
                                    {i > 0 && <ChevronRight size={12} className="text-zinc-400 shrink-0" />}
                                    <button
                                      type="button"
                                      onClick={() => goCrumb(c, i)}
                                      className={`truncate max-w-[10rem] px-0.5 py-0.5 rounded ${i === crumbs.length - 1 ? 'font-medium text-zinc-900' : 'text-zinc-600 hover:bg-zinc-200 hover:text-zinc-900'}`}
                                      title={c.name}
                                    >
                                      {c.name}
                                    </button>
                                  </span>
                                ))}
                              </nav>
                              {current.protection === 'protected' && <span title="Locked" className="ml-0.5 flex items-center gap-1 text-[10px] leading-none text-zinc-700 border border-zinc-400 bg-zinc-200 rounded px-1 py-0.5 shrink-0"><Lock size={10} /> locked</span>}
                            </div>
                          </td>
                          <td className="px-3 py-1 text-xs text-zinc-600 font-medium">Folder</td>
                          <td className="px-3 py-1 text-xs text-zinc-600 hidden sm:table-cell">{fmtSize(folderSizes[current.id])}</td>
                          <td className="px-3 py-1 overflow-hidden">
                            <button onClick={(e) => openMenuAt(current.id, e)} className="p-1.5 rounded text-zinc-500 hover:text-zinc-900" aria-label="Options" aria-haspopup="menu" aria-expanded={menuId === current.id}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                            </button>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })()}
                  {lockedId ? (
                    <tr>
                      <td colSpan={4} className="p-6 bg-zinc-50/30">
                        <form onSubmit={(e) => { e.preventDefault(); void doUnlock(); }} className="mx-auto w-full max-w-sm space-y-4">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500"><Lock size={15} /></div>
                            <div className="min-w-0">
                              <p className="text-sm font-semibold">Enter folder password</p>
                              <p className="text-xs text-zinc-500">Contents hidden until unlocked.</p>
                            </div>
                          </div>
                          <input
                            type="password"
                            value={unlockPw}
                            onChange={e => { setUnlockPw(e.target.value); setUnlockErr(''); }}
                            placeholder="Folder password"
                            autoComplete="current-password"
                            autoCorrect="off"
                            autoCapitalize="off"
                            spellCheck={false}
                            className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900 bg-white"
                          />
                          {unlockErr && <p className="text-xs text-red-600">{unlockErr}</p>}
                          <button type="submit" disabled={busy} className="w-full px-4 py-2 text-sm rounded bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50">{busy ? 'Unlocking…' : 'Unlock'}</button>
                        </form>
                      </td>
                    </tr>
                  ) : (
                    <>
                      {renderFolderRows(parentId, 0)}
                      {items.map(it => (
                        <tr key={it.id} className="group border-b border-zinc-100 hover:bg-zinc-50 focus-within:bg-zinc-50">
                          <td className="px-3 py-1 overflow-hidden">
                            <div className="flex items-center gap-1" style={{ paddingLeft: 0 }}>
                              <span className="shrink-0 w-5 h-5" aria-hidden />
                              {it.kind === 'txt' || it.kind === 'md' ? (
                                <button onClick={() => openEditor(it.id)} className="flex items-center gap-2 py-1.5 w-full text-left rounded px-1 min-w-0">
                                  <FileText size={15} className="text-zinc-500 shrink-0" />
                                  <span className="truncate">{names[it.id]}</span>
                                </button>
                              ) : it.kind === 'file' && getViewKind(it.mime, names[it.id]) ? (
                                <button onClick={() => void openFileViewer(it.id)} className="flex items-center gap-2 py-1.5 w-full text-left rounded px-1 min-w-0">
                                  <File size={15} className="text-zinc-500 shrink-0" />
                                  <span className="truncate">{names[it.id]}</span>
                                </button>
                              ) : (
                                <span className="flex items-center gap-2 py-1.5 px-1 min-w-0">
                                  <File size={15} className="text-zinc-500 shrink-0" />
                                  <span className="truncate">{names[it.id]}</span>
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1 text-xs text-zinc-500">{it.kind.toUpperCase()}</td>
                          <td className="px-3 py-1 text-xs text-zinc-500 hidden sm:table-cell">{fmtSize(it.size)}</td>
                          <td className="px-2 py-1">
                            <div className="flex items-center justify-end gap-1">
                              <input type="checkbox" checked={!!selected[it.id]} onChange={() => toggleSelect(it.id, 'item')} onClick={e => e.stopPropagation()} className="h-3.5 w-3.5 rounded border-zinc-300" aria-label={`Select ${names[it.id] || 'item'}`} />
                              <button onClick={(e) => openMenuAt(it.id, e)} className="p-1.5 rounded text-zinc-400 hover:text-zinc-900" aria-label="Options" aria-haspopup="menu" aria-expanded={menuId === it.id}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {(treeChildren.get(parentId)?.length ?? 0) === 0 && items.length === 0 && (
                        <tr><td colSpan={4} className="px-3 py-10 text-center text-sm text-zinc-500">This folder is empty. Create or upload to get started.</td></tr>
                      )}
                    </>
                  )}
                </tbody>
              </table>
              </>
              )}
              {!lockedId && (
                <div className="max-w-4xl mx-auto mt-2 mb-4 flex justify-start px-1">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={openPlusMenu}
                      className="flex h-11 w-11 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-800 shadow-md"
                      aria-label="Add"
                      aria-haspopup="menu"
                      aria-expanded={folderActionsOpen}
                      title="Create or upload"
                    >
                      <Plus size={20} />
                    </button>
                    {folderActionsOpen && plusMenuPos && (
                      <>
                        <button aria-hidden tabIndex={-1} onClick={closePlusMenu} className="fixed inset-0 z-30 cursor-default" />
                        <div className="fixed z-40 w-48 border border-zinc-200 bg-white rounded-md shadow-lg py-1 max-h-[calc(100vh-16px)] overflow-auto" role="menu" style={{ top: plusMenuPos.top, bottom: plusMenuPos.bottom, left: plusMenuPos.left }}>
                          <label className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 cursor-pointer">
                            <Upload size={14} /> Upload files
                            <input type="file" multiple className="hidden" onChange={e => { closePlusMenu(); void onUpload(e); }} />
                          </label>
                          <button onClick={() => { closePlusMenu(); setCreateTargetParentId(undefined); setCreateKind('folder'); setCreateName(''); setCreateErr(''); setShowCreate(true); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 text-left"><Folder size={14} /> New folder</button>
                          <button onClick={() => { closePlusMenu(); setCreateTargetParentId(undefined); setCreateKind('txt'); setCreateName(''); setCreateErr(''); setShowCreate(true); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 text-left"><FileText size={14} /> New text file</button>
                          <button onClick={() => { closePlusMenu(); setCreateTargetParentId(undefined); setCreateKind('md'); setCreateName(''); setCreateErr(''); setShowCreate(true); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-zinc-100 text-left"><FileText size={14} /> New markdown</button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {(() => {
        const mf = menuId ? (treeFolders.find(f => f.id === menuId) ?? null) : null;
        if (mf) {
          return (
            <RowMenu open onClose={() => setMenuId(null)}>
              {menuItems(mf.id, 'folder', folderName(mf.id), mf.protection)}
            </RowMenu>
          );
        }
        const mi = menuId ? (items.find(i => i.id === menuId) ?? null) : null;
        if (mi) {
          return (
            <RowMenu open onClose={() => setMenuId(null)}>
              {menuItems(mi.id, 'item', names[mi.id] || 'item', 'unprotected', mi.kind, mi.mime)}
            </RowMenu>
          );
        }
        const cached = menuId ? Object.values(sidebarItems).flat().find(it => it.id === menuId) : null;
        if (cached) {
          return (
            <RowMenu open onClose={() => setMenuId(null)}>
              {menuItems(cached.id, 'item', cached.name, 'unprotected', cached.kind, cached.mime)}
            </RowMenu>
          );
        }
        return null;
      })()}

      <input ref={uploadHereRef} type="file" multiple className="hidden" onChange={e => void onUpload(e)} />
      <Dialog open={showCreate} onClose={() => { setShowCreate(false); setCreateTargetParentId(undefined); }} title={createKind === 'folder' ? 'New folder' : createKind === 'txt' ? 'New text file' : 'New markdown file'}>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1.5">Name</label>
            <input autoFocus value={createName} onChange={e => { setCreateName(e.target.value); setCreateErr(''); }} onKeyDown={e => e.key === 'Enter' && doCreate()} placeholder={createKind === 'folder' ? 'New Folder' : createKind === 'txt' ? 'New Text Document.txt' : 'New Markdown.md'} className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" />
            {createErr && <p className="mt-1.5 text-xs text-red-600">{createErr}</p>}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setShowCreate(false); setCreateTargetParentId(undefined); }} className="px-3 py-2 text-sm rounded border border-zinc-300 hover:bg-zinc-50">Cancel</button>
            <button onClick={doCreate} className="px-4 py-2 text-sm rounded bg-zinc-900 text-white hover:bg-zinc-800">Create</button>
          </div>
        </div>
      </Dialog>

      <Dialog open={showSettings} onClose={() => setShowSettings(false)} title={`Settings  ${APP_VERSION_LABEL}`}>
        <div className="space-y-1.5">
          <button onClick={() => setSettingsTab('master')} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm rounded border border-zinc-200 hover:bg-zinc-50 text-left">
            <Lock size={15} className="text-zinc-500" /> Master password
            <span className="ml-auto text-zinc-400">›</span>
          </button>
          <button onClick={() => setSettingsTab('backup')} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm rounded border border-zinc-200 hover:bg-zinc-50 text-left">
            <Database size={15} className="text-zinc-500" /> Backup & restore
            <span className="ml-auto text-zinc-400">›</span>
          </button>
          <button onClick={lock} className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm rounded border border-red-200 text-red-600 hover:bg-red-50 text-left">
            <LogOut size={15} /> Lock vault
          </button>
        </div>
      </Dialog>

      <Dialog open={showSettings && settingsTab === 'master'} onClose={() => { setShowSettings(false); setSettingsTab('menu'); }} title="Master password">
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">Your files stay encrypted with the same key — only the wrapping key changes.</p>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1.5">Current password</label>
            <input type="password" id="set-cur" name="vault-settings-cur" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true" data-form-type="other" className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" />
          </div>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1.5">New password</label>
            <input type="password" id="set-new" name="vault-settings-new" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true" data-form-type="other" className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" />
          </div>
          <p id="set-msg" className="text-xs" />
          <div className="flex justify-between pt-1">
            <button onClick={() => setSettingsTab('menu')} className="text-xs text-zinc-500 hover:text-zinc-900">← Back</button>
            <button onClick={async () => { const { changeMasterPassword } = await import('../services/crypto.service'); const cur = (document.getElementById('set-cur') as HTMLInputElement).value; const nw = (document.getElementById('set-new') as HTMLInputElement).value; const ok = await changeMasterPassword(cur, nw); const m = document.getElementById('set-msg')!; m.textContent = ok ? 'Password changed.' : 'Failed — check current password.'; m.className = 'text-xs ' + (ok ? 'text-green-700' : 'text-red-600'); }} className="px-4 py-2 text-sm rounded bg-zinc-900 text-white hover:bg-zinc-800">Change</button>
          </div>
        </div>
      </Dialog>

      <Dialog open={showSettings && settingsTab === 'backup'} onClose={() => { setShowSettings(false); setSettingsTab('menu'); }} title="Backup & restore">
        <div className="space-y-3">
          <p className="text-xs text-zinc-500">Encrypted with your master password. Restore replaces everything in this vault.</p>
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1.5">Master password</label>
            <input type="password" id="bk-pw" name="vault-backup-pw" autoComplete="new-password" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true" data-form-type="other" className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" />
          </div>
          <p id="bk-msg" className="text-xs" />
          <div className="flex gap-2 flex-wrap pt-1">
            <button onClick={async () => { const pw = (document.getElementById('bk-pw') as HTMLInputElement).value; const m = document.getElementById('bk-msg')!; try { const snapshot = { vaultMeta: await db.vaultMeta.toArray(), folders: await db.folders.toArray(), items: await db.items.toArray(), blobs: await db.blobs.toArray(), decoys: await db.decoys.toArray(), decoyTrees: await (db as any).decoyTrees.toArray(), folderKeys: await db.folderKeys.toArray() }; const salt = randomBytes(16); const raw = await deriveKey(pw, salt, { memory: 65536, iterations: 3, parallelism: 1, hashLength: 32 }); const key = await importAesKey(raw); const env = await encryptBytes(key, new TextEncoder().encode(JSON.stringify(snapshot)), 'backup'); const out = { v: 1, salt: toB64(salt), iv: env.iv, ct: env.ct }; const url = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'vault.vaultbackup'; a.click(); URL.revokeObjectURL(url); m.textContent = 'Backup exported.'; m.className = 'text-xs text-green-700'; } catch (e: any) { m.textContent = 'Export failed: ' + e.message; m.className = 'text-xs text-red-600'; } }} className="flex items-center gap-1.5 bg-zinc-900 text-white px-3 py-2 text-sm rounded hover:bg-zinc-800"><Download size={14} /> Export</button>
            <label className="flex items-center gap-1.5 border border-zinc-300 px-3 py-2 text-sm rounded hover:bg-zinc-50 cursor-pointer"><Upload size={14} /> Import <input type="file" accept=".vaultbackup,.json" className="hidden" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; const m = document.getElementById('bk-msg')!; try { const pw = (document.getElementById('bk-pw') as HTMLInputElement).value; const inp = JSON.parse(await file.text()); const salt = fromB64(inp.salt); const raw = await deriveKey(pw, salt, { memory: 65536, iterations: 3, parallelism: 1, hashLength: 32 }); const key = await importAesKey(raw); const bytes = await decryptBytes(key, { iv: inp.iv, ct: inp.ct }, 'backup'); const snap = JSON.parse(new TextDecoder().decode(bytes)); await db.transaction('rw', [db.vaultMeta, db.folders, db.items, db.blobs, db.decoys, (db as any).decoyTrees, db.folderKeys], async () => { await db.vaultMeta.clear(); await db.folders.clear(); await db.items.clear(); await db.blobs.clear(); await db.decoys.clear(); await (db as any).decoyTrees.clear(); await db.folderKeys.clear(); for (const x of snap.vaultMeta) await db.vaultMeta.add(x); for (const x of snap.folders) await db.folders.add(x); for (const x of snap.items) await db.items.add(x); for (const x of snap.blobs) await db.blobs.add(x); for (const x of snap.decoys) await db.decoys.add(x); for (const x of snap.decoyTrees ?? []) await (db as any).decoyTrees.add(x); for (const x of snap.folderKeys) await db.folderKeys.add(x); }); m.textContent = 'Restored. Please log in again.'; m.className = 'text-xs text-green-700'; } catch (e: any) { m.textContent = 'Import failed: ' + e.message; m.className = 'text-xs text-red-600'; } }} /></label>
          </div>
          <div className="flex justify-start">
            <button onClick={() => setSettingsTab('menu')} className="text-xs text-zinc-500 hover:text-zinc-900">← Back</button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!renameTarget} onClose={() => setRenameTarget(null)} title="Rename">
        <div className="space-y-3">
          <input autoFocus value={renameValue} onChange={e => { setRenameValue(e.target.value); setRenameErr(''); }} onKeyDown={e => e.key === 'Enter' && doRename()} className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" />
          {renameErr && <p className="text-xs text-red-600">{renameErr}</p>}
          <div className="flex justify-end gap-2">
            <button onClick={() => setRenameTarget(null)} className="px-3 py-2 text-sm rounded border border-zinc-300 hover:bg-zinc-50">Cancel</button>
            <button onClick={doRename} className="px-4 py-2 text-sm rounded bg-zinc-900 text-white hover:bg-zinc-800">Rename</button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!lockTarget} onClose={() => setLockTarget(null)} title="Lock" width="32rem">
        {lockStep === 1 ? (
          <div className="space-y-3">
            <p className="text-xs text-zinc-500">Protect <span className="font-medium text-zinc-900">{lockTarget?.name}</span> with a folder password. Files inherit the folder's lock.</p>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1.5">Folder password</label>
              <input type="password" value={lockPw} onChange={e => { setLockPw(e.target.value); setLockErr(''); }} className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" autoFocus />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1.5">Confirm</label>
              <input type="password" value={lockPw2} onChange={e => { setLockPw2(e.target.value); setLockErr(''); }} className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" />
            </div>
            {lockTarget?.type === 'item' && (
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1.5">Decoy text (optional)</label>
                <textarea value={lockDecoy} onChange={e => setLockDecoy(e.target.value)} className="w-full h-20 border border-zinc-300 rounded p-2.5 text-sm focus:border-zinc-900" placeholder="Shown when an incorrect password is entered" />
              </div>
            )}
            {lockErr && <p className="text-xs text-red-600">{lockErr}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setLockTarget(null)} className="px-3 py-2 text-sm rounded border border-zinc-300 hover:bg-zinc-50">Cancel</button>
              <button onClick={doLock} disabled={busy} className="px-4 py-2 text-sm rounded bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50">Next</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 max-h-[70vh] overflow-auto pr-0.5">
            {lockTarget?.type === 'item' ? (
              <>
                <p className="text-xs text-zinc-500">Locking this file protects its parent folder. The decoy text you entered will be shown for this document on a wrong password.</p>
                <div className="flex justify-between pt-1">
                  <button onClick={() => { setLockStep(1); setLockErr(''); }} className="text-xs text-zinc-500 hover:text-zinc-900">← Back</button>
                  <button onClick={doLock} disabled={busy} className="px-4 py-2 text-sm rounded bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50">{busy ? 'Locking…' : 'Lock'}</button>
                </div>
              </>
            ) : (<>
            <p className="text-xs text-zinc-500">Step 2 — Decoy folder (optional). If someone enters a wrong password this folder is shown instead. Only folders and TXT/MD files — no binaries.</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={decoyEnabled} onChange={e => setDecoyEnabled(e.target.checked)} className="h-4 w-4" /> Add decoy folder
            </label>
            {decoyEnabled && (
              <>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Decoy folder name</label>
                  <input value={decoyName} onChange={e => setDecoyName(e.target.value)} placeholder="e.g. Notes" className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-600">Subfolders (only folders + TXT/MD inside)</p>
                  {decoyFolders.map(f => (
                    <div key={f.id} className="flex gap-2 items-center">
                      <input value={f.name} onChange={e => setDecoyFolders(fs => fs.map(x => x.id === f.id ? { ...x, name: e.target.value } : x))} placeholder="Subfolder name" className="flex-1 border border-zinc-300 rounded px-2 py-1.5 text-sm" />
                      <button onClick={() => { setDecoyFolders(fs => fs.filter(x => x.id !== f.id)); setDecoyDocs(ds => ds.map(d => d.folderId === f.id ? { ...d, folderId: null } : d)); }} className="text-zinc-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <button onClick={addDecoyFolderDraft} className="text-xs border border-zinc-300 rounded px-2.5 py-1.5 hover:bg-zinc-50">+ Subfolder</button>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-600">Decoy documents (TXT/MD only)</p>
                  {decoyDocs.map(d => (
                    <div key={d.id} className="border border-zinc-200 rounded p-2 space-y-2">
                      <div className="flex gap-2">
                        <input value={d.name} onChange={e => setDecoyDocs(ds => ds.map(x => x.id === d.id ? { ...x, name: e.target.value } : x))} placeholder="Document name" className="flex-1 border border-zinc-300 rounded px-2 py-1.5 text-sm" />
                        <select value={d.kind} onChange={e => setDecoyDocs(ds => ds.map(x => x.id === d.id ? { ...x, kind: e.target.value as 'txt' | 'md' } : x))} className="border border-zinc-300 rounded px-1.5 text-sm bg-white">
                          <option value="txt">TXT</option><option value="md">MD</option>
                        </select>
                        <select value={d.folderId ?? ''} onChange={e => setDecoyDocs(ds => ds.map(x => x.id === d.id ? { ...x, folderId: e.target.value || null } : x))} className="border border-zinc-300 rounded px-1.5 text-sm bg-white max-w-28">
                          <option value="">Root</option>
                          {decoyFolders.map(f => <option key={f.id} value={f.id}>{f.name || 'Folder'}</option>)}
                        </select>
                        <button onClick={() => setDecoyDocs(ds => ds.filter(x => x.id !== d.id))} className="text-zinc-400 hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                      <textarea value={d.text} onChange={e => setDecoyDocs(ds => ds.map(x => x.id === d.id ? { ...x, text: e.target.value } : x))} placeholder="Decoy text shown on wrong password…" className="w-full h-16 border border-zinc-300 rounded p-2 text-sm" />
                    </div>
                  ))}
                  <button onClick={addDecoyDocDraft} className="text-xs border border-zinc-300 rounded px-2.5 py-1.5 hover:bg-zinc-50">+ Document</button>
                </div>
              </>
            )}
            {lockErr && <p className="text-xs text-red-600">{lockErr}</p>}
            <div className="flex justify-between pt-1">
              <button onClick={() => { setLockStep(1); setLockErr(''); }} className="text-xs text-zinc-500 hover:text-zinc-900">← Back</button>
              <button onClick={doLock} disabled={busy} className="px-4 py-2 text-sm rounded bg-zinc-900 text-white hover:bg-zinc-800 disabled:opacity-50">{busy ? 'Locking…' : 'Lock'}</button>
            </div>
            </>)}
          </div>
        )}
      </Dialog>

      <Dialog open={!!decoyEdit} onClose={() => setDecoyEdit(null)} title="Edit decoy" width="32rem">
        {decoyEdit && (
          <div className="space-y-3 max-h-[70vh] overflow-auto pr-0.5">
            <p className="text-xs text-zinc-500">Decoy for <span className="font-medium text-zinc-900">{decoyEdit.name}</span>. Shown when a wrong password is entered. Only folders + TXT/MD.</p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={decoyEdit.enabled} onChange={e => setDecoyEdit(x => x ? { ...x, enabled: e.target.checked } : x)} className="h-4 w-4" /> Enable decoy folder
            </label>
            {decoyEdit.enabled && (
              <>
                <div>
                  <label className="block text-xs font-medium text-zinc-600 mb-1.5">Decoy folder name</label>
                  <input value={decoyEdit.treeName} onChange={e => setDecoyEdit(x => x ? { ...x, treeName: e.target.value } : x)} placeholder="e.g. Notes" className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" />
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-600">Subfolders</p>
                  {decoyEdit.folders.map(f => (
                    <div key={f.id} className="flex gap-2 items-center">
                      <input value={f.name} onChange={e => setDecoyEdit(x => x ? { ...x, folders: x.folders.map(y => y.id === f.id ? { ...y, name: e.target.value } : y) } : x)} placeholder="Subfolder name" className="flex-1 border border-zinc-300 rounded px-2 py-1.5 text-sm" />
                      <button onClick={() => setDecoyEdit(x => x ? { ...x, folders: x.folders.filter(y => y.id !== f.id), docs: x.docs.map(d => d.folderId === f.id ? { ...d, folderId: null } : d) } : x)} className="text-zinc-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  ))}
                  <button onClick={() => setDecoyEdit(x => x ? { ...x, folders: [...x.folders, { id: newDecoyId(), name: '' }] } : x)} className="text-xs border border-zinc-300 rounded px-2.5 py-1.5 hover:bg-zinc-50">+ Subfolder</button>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-medium text-zinc-600">Documents (TXT/MD only)</p>
                  {decoyEdit.docs.map(d => (
                    <div key={d.id} className="border border-zinc-200 rounded p-2 space-y-2">
                      <div className="flex gap-2">
                        <input value={d.name} onChange={e => setDecoyEdit(x => x ? { ...x, docs: x.docs.map(y => y.id === d.id ? { ...y, name: e.target.value } : y) } : x)} placeholder="Document name" className="flex-1 border border-zinc-300 rounded px-2 py-1.5 text-sm" />
                        <select value={d.kind} onChange={e => setDecoyEdit(x => x ? { ...x, docs: x.docs.map(y => y.id === d.id ? { ...y, kind: e.target.value as 'txt' | 'md' } : y) } : x)} className="border border-zinc-300 rounded px-1.5 text-sm bg-white">
                          <option value="txt">TXT</option><option value="md">MD</option>
                        </select>
                        <select value={d.folderId ?? ''} onChange={e => setDecoyEdit(x => x ? { ...x, docs: x.docs.map(y => y.id === d.id ? { ...y, folderId: e.target.value || null } : y) } : x)} className="border border-zinc-300 rounded px-1.5 text-sm bg-white max-w-28">
                          <option value="">Root</option>
                          {decoyEdit.folders.map(f => <option key={f.id} value={f.id}>{f.name || 'Folder'}</option>)}
                        </select>
                        <button onClick={() => setDecoyEdit(x => x ? { ...x, docs: x.docs.filter(y => y.id !== d.id) } : x)} className="text-zinc-400 hover:text-red-600"><Trash2 size={14} /></button>
                      </div>
                      <textarea value={d.text} onChange={e => setDecoyEdit(x => x ? { ...x, docs: x.docs.map(y => y.id === d.id ? { ...y, text: e.target.value } : y) } : x)} placeholder="Decoy text…" className="w-full h-16 border border-zinc-300 rounded p-2 text-sm" />
                    </div>
                  ))}
                  <button onClick={() => setDecoyEdit(x => x ? { ...x, docs: [...x.docs, { id: newDecoyId(), folderId: null, name: '', kind: 'txt' as const, text: '' }] } : x)} className="text-xs border border-zinc-300 rounded px-2.5 py-1.5 hover:bg-zinc-50">+ Document</button>
                </div>
              </>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setDecoyEdit(null)} className="px-3 py-2 text-sm rounded border border-zinc-300 hover:bg-zinc-50">Cancel</button>
              <button onClick={saveDecoyEdit} className="px-4 py-2 text-sm rounded bg-zinc-900 text-white hover:bg-zinc-800">Save decoy</button>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete">
        <div className="space-y-3">
          <p className="text-sm text-zinc-700">Delete <span className="font-medium">{deleteTarget?.name}</span>? {deleteTarget?.type === 'folder' ? 'All contents will be deleted too.' : ''} This cannot be undone.</p>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setDeleteTarget(null)} className="px-3 py-2 text-sm rounded border border-zinc-300 hover:bg-zinc-50">Cancel</button>
            <button onClick={doDelete} className="px-4 py-2 text-sm rounded border border-red-600 text-red-600 hover:bg-red-600 hover:text-white">Delete</button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!viewer || viewerBusy} onClose={closeViewer} title={viewer?.name || (viewerBusy ? 'Opening file…' : 'File viewer')} width="min(96vw, 56rem)">
        {viewerBusy ? (
          <div className="py-12 text-center text-sm text-zinc-500">Decrypting and opening…</div>
        ) : viewerErr ? (
          <div className="space-y-3">
            <p className="text-sm text-red-600">{viewerErr}</p>
            <div className="flex justify-end"><button onClick={closeViewer} className="px-3 py-2 text-sm rounded border border-zinc-300 hover:bg-zinc-50">Close</button></div>
          </div>
        ) : viewer ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
              <span className="truncate">{viewer.mime || viewer.kind.toUpperCase()}</span>
              <div className="flex items-center gap-2 shrink-0">
                {viewer.url && <a href={viewer.url} download={viewer.name} className="px-2 py-1 border border-zinc-300 rounded hover:bg-zinc-50 text-zinc-700">Download</a>}
                <button onClick={closeViewer} className="px-2 py-1 border border-zinc-300 rounded hover:bg-zinc-50 text-zinc-700">Close</button>
              </div>
            </div>
            <div className="rounded border border-zinc-200 bg-zinc-50 overflow-hidden min-h-[200px] max-h-[72vh] flex items-center justify-center">
              {viewer.kind === 'image' ? (
                <img src={viewer.url} alt={viewer.name} className="max-w-full max-h-[72vh] object-contain" />
              ) : (
                <iframe src={viewer.url} title={viewer.name} className="w-full h-[72vh] bg-white" />
              )}
            </div>
          </div>
        ) : null}
      </Dialog>
      <Dialog open={bulkDeleteOpen} onClose={() => setBulkDeleteOpen(false)} title="Delete selected">
        <div className="space-y-3">
          <p className="text-sm text-zinc-700">Delete <span className="font-medium">{selectedCount}</span> selected item{selectedCount === 1 ? '' : 's'}? Folder contents will also be deleted. This cannot be undone.</p>
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setBulkDeleteOpen(false)} className="px-3 py-2 text-sm rounded border border-zinc-300 hover:bg-zinc-50">Cancel</button>
            <button onClick={() => void doBulkDelete()} className="px-4 py-2 text-sm rounded border border-red-600 text-red-600 hover:bg-red-600 hover:text-white">Delete</button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
