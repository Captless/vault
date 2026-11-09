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

const FONT_SIZES = [12, 13, 14, 15, 16, 18, 20, 24, 28, 32];

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

  function focusAndSelect(start: number, end: number) {
    requestAnimationFrame(() => {
      const el = taRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  }

  function applyEdit(nextText: string, selStart: number, selEnd: number) {
    onTextChange(nextText);
    focusAndSelect(selStart, selEnd);
  }

  function insertAtCursor(snippet: string, cursorOffset = snippet.length) {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end } = ta;
    const next = text.slice(0, start) + snippet + text.slice(end);
    const pos = start + cursorOffset;
    applyEdit(next, pos, pos);
  }

  function wrap(open: string, close: string) {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end, value } = ta;
    const selected = value.slice(start, end);
    if (selected) {
      const next = value.slice(0, start) + open + selected + close + value.slice(end);
      applyEdit(next, start + open.length, start + open.length + selected.length);
    } else {
      const next = value.slice(0, start) + open + close + value.slice(end);
      const pos = start + open.length;
      applyEdit(next, pos, pos);
    }
  }

  function toggleHeading() {
    if (kind !== 'md') return;
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end, value } = ta;
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = value.indexOf('\n', end);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const allHeaded = lines.every(l => /^##\s/.test(l) || !l.trim());
    const nextBlock = lines.map(l => {
      if (!l.trim() && !allHeaded) return '## ';
      return allHeaded ? l.replace(/^##\s?/, '') : `## ${l.replace(/^#+\s*/, '')}`;
    }).join('\n');
    const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
    applyEdit(next, lineStart, lineStart + nextBlock.length);
  }

  function insertList(listKind: 'ul' | 'ol') {
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end, value } = ta;
    const ulMarker = kind === 'md' ? '- ' : '• '; // txt gets actual bullet point; md uses markdown
    const isUl = (l: string) => kind === 'md' ? /^[-*+]\s+/.test(l) : /^•\s+/.test(l);
    const isOl = (l: string) => /^\d+\.\s+/.test(l);
    const strip = (l: string) => l.replace(/^[-*+•]\s+/, '').replace(/^\d+\.\s+/, '');

    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = value.indexOf('\n', end > start ? end - 1 : end);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const allList = lines.every(l => !l.trim() || (listKind === 'ul' ? isUl(l) : isOl(l)));
    const nextBlock = lines.map((l, i) => {
      if (!l.trim()) return listKind === 'ul' ? ulMarker : `${i + 1}. `;
      if (allList) return strip(l); // toggle off
      const clean = strip(l);
      return listKind === 'ul' ? `${ulMarker}${clean}` : `${i + 1}. ${clean}`;
    }).join('\n');
    const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
    const caret = lineStart + (listKind === 'ul' ? ulMarker.length : 3);
    applyEdit(next, caret, caret);
  }

  function handleEditorKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const ta = taRef.current;
    if (!ta) return;
    const { selectionStart: start, selectionEnd: end, value } = ta;
    const indent = '  '; // 2 spaces (Word-like tab/indent)
    if (start === end) {
      if (e.shiftKey) {
        const lineStart = value.lastIndexOf('\n', start - 1) + 1;
        const line = value.slice(lineStart);
        if (line.startsWith(indent)) applyEdit(value.slice(0, lineStart) + value.slice(lineStart + indent.length), Math.max(lineStart, start - indent.length), Math.max(lineStart, start - indent.length));
        else if (line.startsWith('\t')) applyEdit(value.slice(0, lineStart) + value.slice(lineStart + 1), Math.max(lineStart, start - 1), Math.max(lineStart, start - 1));
      } else {
        insertAtCursor(indent);
      }
      return;
    }
    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    const lineEndIdx = value.indexOf('\n', end - 1);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split('\n');
    const nextBlock = e.shiftKey
      ? lines.map(l => l.startsWith(indent) ? l.slice(indent.length) : l.startsWith('\t') ? l.slice(1) : l).join('\n')
      : lines.map(l => indent + l).join('\n');
    const next = value.slice(0, lineStart) + nextBlock + value.slice(lineEnd);
    applyEdit(next, lineStart, lineStart + nextBlock.length);
  }

  return (
    <div className={`h-full flex flex-col min-h-0 ${showHeader ? 'min-h-[100dvh]' : ''}`} style={{ background: 'var(--app-bg)', color: 'var(--app-text)' }}>
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
            <select value={font} onChange={e => setFont(e.target.value)} className="h-8 border border-zinc-300 rounded px-1.5 text-xs bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-500" aria-label="Font">
              {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <select value={size} onChange={e => setSize(Number(e.target.value))} className="h-8 border border-zinc-300 rounded px-1.5 text-xs bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-500" aria-label="Font size">
              {FONT_SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
            </select>
            <div className="h-4 w-px bg-zinc-200 mx-1" aria-hidden="true" />
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => kind === 'md' && wrap('**', '**')} disabled={kind !== 'md'} className="h-8 min-w-8 px-1.5 text-xs rounded border border-zinc-300 hover:bg-zinc-50 font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed" title={kind === 'md' ? 'Bold (**text**)' : 'Bold (Markdown only)'}>B</button>
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => kind === 'md' && wrap('_', '_')} disabled={kind !== 'md'} className="h-8 min-w-8 px-1.5 text-xs rounded border border-zinc-300 hover:bg-zinc-50 italic focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed" title={kind === 'md' ? 'Italic (_text_)' : 'Italic (Markdown only)'}>I</button>
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => kind === 'md' && wrap('<u>', '</u>')} disabled={kind !== 'md'} className="h-8 min-w-8 px-1.5 text-xs rounded border border-zinc-300 hover:bg-zinc-50 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed" title={kind === 'md' ? 'Underline' : 'Underline (Markdown only)'}>U</button>
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={toggleHeading} disabled={kind !== 'md'} className="h-8 min-w-8 px-1.5 text-xs rounded border border-zinc-300 hover:bg-zinc-50 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed" title={kind === 'md' ? 'Heading' : 'Heading (Markdown only)'}>H</button>
            <div className="h-4 w-px bg-zinc-200 mx-1" aria-hidden="true" />
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => insertList('ul')} className="h-8 px-2 text-xs rounded border border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-500" title="Bullet list">• List</button>
            <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => insertList('ol')} className="h-8 px-2 text-xs rounded border border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-500" title="Numbered list">1. List</button>
            <div className="h-4 w-px bg-zinc-200 mx-1" aria-hidden="true" />
            <button type="button" onMouseDown={e => e.preventDefault()} disabled={kind !== 'md'} onClick={() => {
              if (kind !== 'md') return;
              const ta = taRef.current; if (!ta) return;
              const { selectionStart: s, selectionEnd: end, value } = ta;
              const sel = value.slice(s, end);
              if (sel) {
                const next = value.slice(0, s) + `[${sel}](url)` + value.slice(end);
                applyEdit(next, s + sel.length + 3, s + sel.length + 6);
              } else {
                const next = value.slice(0, s) + '[text](url)' + value.slice(end);
                applyEdit(next, s + 1, s + 5);
              }
            }} className="h-8 px-2 text-xs rounded border border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-500 disabled:opacity-40 disabled:cursor-not-allowed" title={kind === 'md' ? 'Insert link' : 'Link (Markdown only)'}>Link</button>
            <span className="ml-auto text-[11px] text-zinc-400">{kind === 'txt' ? 'Plain text — lists & Tab indent available' : `${text.split(/\s+/).filter(Boolean).length} words`}</span>
          </div>

          <div className="bg-white border border-zinc-200 rounded-b-lg shadow-sm overflow-hidden flex flex-col min-h-0 flex-1">
            {preview && kind === 'md' ? (
              <div className="prose prose-sm max-w-none p-6 flex-1 overflow-auto" style={{ fontFamily: font, fontSize: size, color: 'var(--app-text)' }}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeSanitize]}
                  components={{
                    a: ({ node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" className="underline text-[var(--app-accent)] hover:opacity-80" />,
                  }}
                >{text}</ReactMarkdown>
              </div>
            ) : (
              <textarea
                ref={taRef}
                value={text}
                onChange={e => onTextChange(e.target.value)}
                onKeyDown={handleEditorKeyDown}
                className="editor-content w-full flex-1 min-h-[50vh] p-6 resize-none focus:outline-none"
                style={{ fontFamily: font, fontSize: size, tabSize: 2, background: 'var(--app-surface)', color: 'var(--app-text)' }}
                spellCheck={false}
                placeholder="Write… Use toolbar to format. Tab indents; bullets/numbers insert list markers. Links: [text](url)"
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
