import { useEffect } from 'react';

export default function Dialog({ open, onClose, title, children, width }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog-backdrop fixed inset-0 z-30 flex items-start justify-center sm:items-center bg-black/20 p-4" onClick={onClose}>
      <div className="dialog-panel w-full bg-white rounded-lg border border-zinc-200 shadow-lg" style={{ maxWidth: width ?? '24rem' }} onClick={e => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-zinc-500 hover:text-zinc-900 text-lg leading-none">✕</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}