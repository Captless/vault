import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { db } from '../db/database';
import { readText, writeText, getItemMeta, renameItem } from '../services/item.service';
import { setDecoy, getDecoy } from '../services/decoy.service';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

export default function EditorPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [item, setItem] = useState<any>(null);
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [decoy, setDecoyText] = useState('');
  const [showDecoy, setShowDecoy] = useState(false);

  useEffect(() => {
    (async () => {
      const it = await db.items.get(id!);
      if (!it) { nav('/app'); return; }
      setItem(it);
      const m = await getItemMeta(it);
      setName(m.name);
      const t = await readText(it);
      setText(t);
      const d = await getDecoy(it.id);
      setDecoyText(d ?? '');
    })();
  }, [id]);

  useEffect(() => {
    if (!item) return;
    const t = setTimeout(async () => {
      setSaving(true);
      await writeText(item, text);
      setSaving(false);
      setSavedAt(Date.now());
    }, 800);
    return () => clearTimeout(t);
  }, [text, item]);

  async function saveName() {
    if (!item) return;
    await renameItem(item, name);
  }

  async function saveDecoy() {
    if (!item) return;
    await setDecoy(item.id, decoy);
    setShowDecoy(false);
  }

  if (!item) return <div className="h-full flex items-center justify-center text-zinc-500 text-sm">Loading…</div>;

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-4 py-2">
        <button onClick={()=>nav('/app')} className="text-xs text-zinc-500 hover:text-zinc-900">← Back</button>
        <input value={name} onChange={e=>setName(e.target.value)} onBlur={saveName} className="border border-zinc-300 px-2 py-1 text-sm flex-1 max-w-xs" />
        <span className="text-xs text-zinc-400">{saving?'Saving…':savedAt?'Saved':''}</span>
        {item.kind==='md' && <button onClick={()=>setPreview(p=>!p)} className="text-xs border border-zinc-300 px-2 py-1">{preview?'Edit':'Preview'}</button>}
        <button onClick={()=>setShowDecoy(true)} className="text-xs border border-zinc-300 px-2 py-1">Decoy</button>
      </header>
      <div className="flex-1 overflow-hidden">
        {preview && item.kind==='md' ? (
          <div className="prose prose-sm max-w-none p-6 h-full overflow-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{text}</ReactMarkdown>
          </div>
        ) : (
          <textarea value={text} onChange={e=>setText(e.target.value)} className="w-full h-full p-4 font-mono text-sm resize-none focus:outline-none bg-white" spellCheck={false} />
        )}
      </div>

      {showDecoy && (
        <div className="fixed inset-0 bg-black/20 flex items-center justify-center p-4">
          <div className="bg-white border border-zinc-200 p-6 w-full max-w-2xl space-y-3">
            <h2 className="text-sm font-semibold">Decoy content</h2>
            <textarea value={decoy} onChange={e=>setDecoyText(e.target.value)} className="w-full h-48 border border-zinc-300 p-2 text-sm font-mono" />
            <div className="flex gap-2 justify-end">
              <button onClick={()=>setShowDecoy(false)} className="text-xs px-3 py-1.5">Cancel</button>
              <button onClick={saveDecoy} className="text-xs bg-zinc-900 text-white px-3 py-1.5">Save decoy</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}