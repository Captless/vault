import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../db/database';
import { readText, writeText, getItemMeta } from '../services/item.service';
import EditorView from './EditorView';

export default function EditorPage({ itemId, onClose }: { itemId?: string; onClose?: () => void } = {}) {
  const { id: routeId } = useParams();
  const id = itemId ?? routeId;
  const nav = useNavigate();
  const close = onClose ?? (() => nav('/app'));
  const [item, setItem] = useState<any>(null);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!id) return;
      const it = await db.items.get(id);
      if (cancelled) return;
      if (!it) { close(); return; }
      setItem(it);
      try {
        const m = await getItemMeta(it);
        if (!cancelled) setName(m.name);
      } catch { if (!cancelled) setName('Document'); }
      try {
        const t = await readText(it);
        if (!cancelled) setText(t);
      } catch { if (!cancelled) setText(''); }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const itemRef = useRef<any>(null);
  const textRef = useRef(text);
  useEffect(() => { itemRef.current = item; }, [item]);
  useEffect(() => { textRef.current = text; }, [text]);

  const flushSave = useCallback(async (itm: any, txt: string) => {
    if (!itm) return;
    setSaving(true);
    try {
      await writeText(itm, txt);
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!item) return;
    const t = setTimeout(() => { flushSave(item, text); }, 800);
    return () => clearTimeout(t);
  }, [text, item, flushSave]);

  // Flush pending text when leaving the editor (Back, reload, tab close)
  useEffect(() => {
    const onBeforeUnload = () => {
      const itm = itemRef.current;
      if (itm) void flushSave(itm, textRef.current);
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (itemRef.current) void flushSave(itemRef.current, textRef.current);
      // Leaving the file re-locks its parent folder.
      const pid = itemRef.current?.parentId;
      if (pid) import('../services/crypto.service').then(m => m.setFolderKey(pid, null));
    };
  }, [flushSave]);

  if (!item) return <div className="h-full flex items-center justify-center text-zinc-500 text-sm">Loading…</div>;

  return (
    <>
      <EditorView
        name={name}
        kind={item.kind === 'md' ? 'md' : (item.kind === 'txt' ? 'txt' : (/\.md$/i.test(name) ? 'md' : 'txt'))}
        text={text}
        saving={saving}
        savedAt={savedAt}
        onTextChange={setText}
        onSave={() => flushSave(item, text)}
        onClose={() => { void (async () => { try { await flushSave(item, textRef.current); } catch { /* ignore */ } close(); })(); }}
        headerExtras={null}
        showHeader={!onClose}
      />
    </>
  );
}
