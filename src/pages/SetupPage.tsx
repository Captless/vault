import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setupVault } from '../services/crypto.service';

export default function SetupPage({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    if (pw !== pw2) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try {
      await setupVault(pw);
      onDone();
      nav('/app');
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }
  return (
    <div className="h-full flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm border border-zinc-200 bg-white p-8 space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">Create master password</h1>
        <p className="text-xs text-zinc-500">This password encrypts your entire vault. It cannot be recovered.</p>
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Master password" className="w-full border border-zinc-300 px-3 py-2 text-sm" />
        <input type="password" value={pw2} onChange={e=>setPw2(e.target.value)} placeholder="Confirm password" className="w-full border border-zinc-300 px-3 py-2 text-sm" />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button disabled={busy} className="w-full bg-zinc-900 text-white py-2 text-sm hover:bg-zinc-800 disabled:opacity-50">{busy?'Creating…':'Create vault'}</button>
      </form>
    </div>
  );
}