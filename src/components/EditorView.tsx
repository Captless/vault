import { useState, useRef } from 'react';
import { ArrowLeft, Eye, EyeOff } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

const FONTS = [
  { label: 'Sans (system)', value: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif' },
  { label: 'Inter', value: '"Inter", ui-sans-serif, system-ui, sans-serif' },
  { label: 'Serif (Georgia)', value: 'Georgia, "Times New Roman", serif' },
  { label: 'Mono', value: '"JetBrains Mono", ui-monospace, "Cascadia Mono", monospace' },
];

const COLORS = [
  { label: 'Default', value: '#18181b' },
  { label: 'Muted', value: '#52525b' },
  { label: 'Red', value: '#dc2626' },
  { label: 'Orange', value: '#ea580c' },
  { label: 'Amber', value: '#ca8a04' },
  { label: 'Green', value: '#16a34a' },
  { label: 'Blue', value: '#2563eb' },
  { label: 'Purple', value: '#7c3aed' },
];

type Sel = { start: number; end: number; text: string };

interface Props {
  name: string;
  kind: 'txt' | 'md';
  text: string;
  saving: boolean;
  savedAt: number | null;
  onTextChange: (t: string) => void;
  onSave: () => void;
  onClose: () => void;
  headerExtras?: React.ReactNode;
  footerNote?: string;
  showHeader?: boolean;
}

/** Shared document editor UI — used by real TXT/MD editor and decoy editor
 *  so both views always have identical design (toolbar, card, preview). */
export default function EditorView({ name, kind, text, saving, savedAt, onTextChange, onSave, onClose, headerExtras, footerNote, showHeader = true }: Props) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [font, setFont] = useState(FONTS[0].value);
  const [size, setSize] = useState(14);
  const [color, setColor] = useState('#18181b');
  const [sel, setSel] = useState<Sel>({ start: 0, end: 0, text: '' });

  function readSel() {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end } = ta;
    setSel({ start, end, text: ta.value.slice(start, end) });
  }

  function replaceRange(newText: string) {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end } = ta;
    onTextChange(text.slice(0, start) + newText + text.slice(end));
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      const pos = start + newText.length;
      el.setSelectionRange(pos, pos);
      setSel({ start: pos, end: pos, text: '' });
    });
  }

  function wrap(open: string, close: string, placeholder: string) {
    const s = sel.text || placeholder;
    replaceRange(open + s + close);
  }

  function prefixLines(prefix: string, placeholder: string) {
    const s = sel.text || placeholder;
    const lines = s.split('\n').map(l => l.replace(/^[-•]\s*/, '').replace(/^\d+\.\s*/, ''));
    replaceRange(lines.map(l => prefix + l).join('\n'));
  }

  return (
    <div className="h-full flex flex-col bg-[#fafafa] min-h-0">
      {showHeader && (
        <header className="flex items-center gap-2 border-b border-zinc-200 bg-white px-3 py-2 shrink-0">
          <button onClick={() => { onClose(); }} className="p-1.5 rounded hover:bg-zinc-100 text-zinc-600" aria-label="Back to files">
            <ArrowLeft size={16} />
          </button>
          <span className="text-sm font-medium truncate max-w-56">{name}</span>
          <span className="text-xs text-zinc-400">{saving ? 'Saving…' : savedAt ? 'Saved' : ''}</span>
          <button onClick={onSave} className="text-xs border border-zinc-300 bg-white px-2.5 py-1.5 rounded hover:bg-zinc-50">Save</button>
          <div className="ml-auto flex items-center gap-1.5">
            {kind === 'md' && (
              <button onClick={() => setPreview(p => !p)} className="flex items-center gap-1.5 border border-zinc-300 bg-white px-2.5 py-1.5 text-xs rounded hover:bg-zinc-50">
                {preview ? <EyeOff size={13} /> : <Eye size={13} />} {preview ? 'Edit' : 'Preview'}
              </button>
            )}
            {headerExtras}
          </div>
        </header>
      )}

      <div className={`flex-1 overflow-auto flex justify-center min-h-0 ${showHeader ? 'p-4 sm:p-6' : 'p-0'}`}>
        <div className={`w-full flex flex-col ${showHeader ? 'max-w-3xl' : 'max-w-4xl'}`}>

          <div className="flex flex-wrap items-center gap-1 border border-zinc-200 border-b-0 bg-white rounded-t-lg px-2.5 py-1.5">
            <select value={font} onChange={e => setFont(e.target.value)} className="h-7 border border-zinc-300 rounded px-1.5 text-xs bg-white" aria-label="Font">
              {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <select value={size} onChange={e => setSize(Number(e.target.value))} className="h-7 border border-zinc-300 rounded px-1.5 text-xs bg-white" aria-label="Font size">
              {[12, 13, 14, 15, 16, 18].map(s => <option key={s} value={s}>{s}px</option>)}
            </select>
            <div className="h-4 w-px bg-zinc-200 mx-1" />
            <button onClick={() => wrap('**', '**', 'bold text')} disabled={!sel.text} className="h-7 min-w-7 px-1.5 text-xs rounded border border-zinc-300 hover:bg-zinc-50 font-bold disabled:opacity-40" title="Bold">B</button>
            <button onClick={() => wrap('*', '*', 'italic text')} disabled={!sel.text} className="h-7 min-w-7 px-1.5 text-xs rounded border border-zinc-300 hover:bg-zinc-50 italic disabled:opacity-40" title="Italic">I</button>
            <button onClick={() => wrap('## ', '', 'Heading')} disabled={!sel.text} className="h-7 min-w-7 px-1.5 text-xs rounded border border-zinc-300 hover:bg-zinc-50 font-semibold disabled:opacity-40" title="Heading (markdown)">H</button>
            <div className="h-4 w-px bg-zinc-200 mx-1" />
            <button onClick={() => prefixLines('• ', 'item')} className="h-7 px-2 text-xs rounded border border-zinc-300 hover:bg-zinc-50" title="Bulleted list">• List</button>
            <button onClick={() => prefixLines('1. ', 'item')} className="h-7 px-2 text-xs rounded border border-zinc-300 hover:bg-zinc-50" title="Numbered list">1. List</button>
            <div className="h-4 w-px bg-zinc-200 mx-1" />
            <div className="flex items-center gap-1" role="group" aria-label="Text color">
              {COLORS.map(c => (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => setColor(c.value)}
                  className={`h-5 w-5 rounded-full border ${color === c.value ? 'border-zinc-900 ring-1 ring-zinc-900 ring-offset-1' : 'border-zinc-300 hover:border-zinc-400'}`}
                  style={{ backgroundColor: c.value }}
                  aria-label={c.label}
                  aria-pressed={color === c.value}
                  title={c.label}
                />
              ))}
            </div>
            <span className="ml-auto text-[11px] text-zinc-400">{text.split(/\s+/).filter(Boolean).length} words</span>
          </div>

          <div className="bg-white border border-zinc-200 rounded-b-lg shadow-sm overflow-hidden flex flex-col min-h-0 flex-1">
            {preview && kind === 'md' ? (
              <div className="prose prose-sm max-w-none p-6 flex-1 overflow-auto" style={{ fontFamily: font, fontSize: size, color }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>{text}</ReactMarkdown>
              </div>
            ) : (
              <textarea
                ref={taRef}
                value={text}
                onChange={e => { onTextChange(e.target.value); readSel(); }}
                onSelect={readSel}
                onClick={readSel}
                className="editor-content w-full flex-1 min-h-[50vh] p-6 resize-none focus:outline-none bg-white"
                style={{ fontFamily: font, fontSize: size, color }}
                spellCheck={false}
                placeholder="Write… select text to format with the toolbar above."
              />
            )}
            <div className="border-t border-zinc-100 bg-zinc-50 px-4 py-2 flex items-center justify-between text-[11px] text-zinc-500">
              <span>{kind.toUpperCase()}</span>
              <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-green-500" /> {footerNote ?? 'Autossaved locally'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
