import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { loginVault } from '../services/crypto.service';

export default function LoginPage() {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const ok = await loginVault(pw);
    setBusy(false);
    if (ok) nav('/app'); else setErr('Incorrect password.');
  }
  return (
    <div className="h-full flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-sm border border-zinc-200 bg-white p-8 space-y-4">
        <h1 className="text-lg font-semibold tracking-tight">Unlock vault</h1>
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="Master password" className="w-full border border-zinc-300 px-3 py-2 text-sm" autoFocus />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button disabled={busy} className="w-full bg-zinc-900 text-white py-2 text-sm hover:bg-zinc-800 disabled:opacity-50">{busy?'Unlocking…':'Unlock'}</button>
      </form>
    </div>
  );
}