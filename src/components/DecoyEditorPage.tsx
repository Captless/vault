import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { getDecoyTree, saveDecoyTree } from '../services/decoy.service';
import type { DecoyTree } from '../types';
import EditorView from './EditorView';

export default function DecoyEditorPage() {
  const { folderId, docId } = useParams();
  const nav = useNavigate();
  const [tree, setTree] = useState<DecoyTree | null>(null);
  const [doc, setDoc] = useState<DecoyTree['docs'][number] | null>(null);
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const treeRef = useRef<DecoyTree | null>(null);
  const textRef = useRef('');
  const prevTextRef = useRef('');

  useEffect(() => {
    (async () => {
      const t = await getDecoyTree(folderId!);
      if (!t) { nav('/app'); return; }
      setTree(t);
      const d = t.docs.find(x => x.id === docId);
      if (!d) { nav('/app'); return; }
      setDoc(d);
      setText(d.text);
    })();
  }, [folderId, docId, nav]);

  useEffect(() => { treeRef.current = tree; }, [tree]);
  useEffect(() => { textRef.current = text; }, [text]);

  const flush = useCallback(async (txtOverride?: string) => {
    const t = treeRef.current;
    if (!t || !docId) return;
    const txt = txtOverride ?? textRef.current;
    setSaving(true);
    try {
      const nt: DecoyTree = {
        ...t,
        docs: t.docs.map(d => d.id === docId ? { ...d, text: txt } : d)
      };
      await saveDecoyTree(folderId!, nt);
      setTree(nt);
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }, [docId, folderId]);

  useEffect(() => {
    if (!tree) return;
    const t = setTimeout(() => { void flush(); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    return () => { void flush(prevTextRef.current || textRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!tree || !doc) return <div className="h-full flex items-center justify-center text-zinc-500 text-sm">Loading…</div>;

  return (
    <EditorView
      name={doc.name}
      kind={doc.kind}
      text={text}
      saving={saving}
      savedAt={savedAt}
      onTextChange={(t) => { prevTextRef.current = textRef.current; setText(t); }}
      onSave={() => void flush()}
      onClose={() => { void (async () => { await flush(); nav('/app'); })(); }}
      headerExtras={
        <span className="text-[11px] text-zinc-500 border border-zinc-200 rounded px-1.5 py-0.5">Decoy — does not overwrite real document</span>
      }
      footerNote="Decoy autosaved locally"
    />
  );
}
