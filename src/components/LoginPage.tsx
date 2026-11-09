import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { loginVault } from '../services/crypto.service';
import AuthLayout from './AuthLayout';

export default function LoginPage({ onUnlock }: { onUnlock?: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const ok = await loginVault(pw);
    setBusy(false);
    if (ok) { onUnlock?.(); nav('/app', { replace: true }); } else setErr('Incorrect password.');
  }
  return (
    <AuthLayout>
      <form onSubmit={submit} autoComplete="off" className="bg-white border border-zinc-200 rounded-lg p-6 space-y-4">
        <div className="flex items-center gap-2">
          <ShieldCheck size={18} className="text-zinc-700" />
          <h1 className="text-base font-semibold tracking-tight">Unlock vault</h1>
        </div>
        <input type="text" name="username" autoComplete="username" value="vault" readOnly tabIndex={-1} aria-hidden="true" className="hidden" />
        <div>
          <label htmlFor="vault-master-pw" className="block text-xs font-medium text-zinc-600 mb-1.5">Master password</label>
          <input id="vault-master-pw" name="vault-master-password" type="password" autoComplete="current-password" value={pw} onChange={e => { setPw(e.target.value); setErr(''); }} className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" autoCorrect="off" autoCapitalize="off" spellCheck={false} data-lpignore="true" data-1p-ignore="true" data-form-type="other" />
        </div>
        {err && <p className="text-xs text-red-600">{err}</p>}
        <button disabled={busy} className="w-full bg-zinc-900 text-white py-2 text-sm rounded hover:bg-zinc-800 disabled:opacity-50">{busy ? 'Unlocking…' : 'Unlock'}</button>
      </form>
    </AuthLayout>
  );
}