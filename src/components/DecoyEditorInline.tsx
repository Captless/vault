import { useEffect, useState, useRef } from 'react';
import { saveDecoyTree } from '../services/decoy.service';
import type { DecoyTree } from '../types';
import EditorView from './EditorView';

interface Props {
  folderId: string;
  docId: string;
  tree: DecoyTree;
  onTreeChange: (t: DecoyTree) => void;
  onClose: () => void;
}

/** Inline decoy document editor — renders inside the explorer main pane
 *  (sidebar + header stay visible), identical UI to the real TXT editor. */
export default function DecoyEditorInline({ folderId, docId, tree, onTreeChange, onClose }: Props) {
  const doc = tree.docs.find(d => d.id === docId) ?? null;
  const [text, setText] = useState(doc?.text ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const textRef = useRef(text);
  useEffect(() => { textRef.current = text; }, [text]);

  // Reset text when switching documents
  useEffect(() => { setText(doc?.text ?? ''); }, [docId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function flush(txtOverride?: string) {
    const txt = txtOverride ?? textRef.current;
    setSaving(true);
    try {
      const nt: DecoyTree = {
        ...tree,
        docs: tree.docs.map(d => d.id === docId ? { ...d, text: txt } : d)
      };
      await saveDecoyTree(folderId, nt);
      onTreeChange(nt);
      setSavedAt(Date.now());
    } finally { setSaving(false); }
  }

  useEffect(() => {
    const t = setTimeout(() => { void flush(); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    return () => { void flush(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!doc) return <div className="h-full flex items-center justify-center text-zinc-500 text-sm">Loading…</div>;

  return (
    <EditorView
      name={doc.name}
      kind={doc.kind}
      text={text}
      saving={saving}
      savedAt={savedAt}
      onTextChange={setText}
      onSave={() => void flush()}
      onClose={() => { void (async () => { await flush(); onClose(); })(); }}
      headerExtras={
        <span className="text-[11px] text-zinc-500 border border-zinc-200 rounded px-1.5 py-0.5">Decoy</span>
      }
      footerNote="Decoy autosaved locally"
      showHeader={false}
    />
  );
}
