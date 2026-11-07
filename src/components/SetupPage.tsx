import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { setupVault } from '../services/crypto.service';
import AuthLayout from './AuthLayout';

export default function SetupPage({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [show, setShow] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw.length < 8) { setErr('Password must be at least 8 characters.'); return; }
    if (pw !== pw2) { setErr('Passwords do not match.'); return; }
    setBusy(true);
    try { await setupVault(pw); onDone(); nav('/app'); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }
  return (
    <AuthLayout>
      <form onSubmit={submit} className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-zinc-700" />
          <h1 className="text-base font-semibold tracking-tight">Create master password</h1>
        </div>
        <p className="text-xs text-zinc-500 leading-relaxed">This password encrypts your entire vault. There is no recovery — keep it safe.</p>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1.5">Master password</label>
          <div className="relative">
            <input type={show ? 'text' : 'password'} value={pw} onChange={e => { setPw(e.target.value); setErr(''); }} className="w-full border border-zinc-300 rounded px-3 py-2 text-sm pr-9 focus:border-zinc-900" autoFocus />
            <button type="button" onClick={() => setShow(s => !s)} className="absolute right-2 top-2.5 text-zinc-500">{show ? <EyeOff size={15} /> : <Eye size={15} />}</button>
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-zinc-600 mb-1.5">Confirm</label>
          <input type={show ? 'text' : 'password'} value={pw2} onChange={e => { setPw2(e.target.value); setErr(''); }} className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" />
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button disabled={busy} className="w-full bg-zinc-900 text-white py-2 text-sm rounded hover:bg-zinc-800 disabled:opacity-50">{busy ? 'Creating…' : 'Create vault'}</button>
      </form>
    </AuthLayout>
  );
}