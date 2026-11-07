import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { changeMasterPassword } from '../services/crypto.service';

export default function SettingsPage() {
  const nav = useNavigate();
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  async function change() {
    setErr(''); setMsg('');
    const ok = await changeMasterPassword(cur, nw);
    if (ok) { setMsg('Password changed.'); setCur(''); setNw(''); }
    else setErr('Failed — check current password.');
  }
  return (
    <div className="h-full bg-[#fafafa]">
      <div className="max-w-md mx-auto p-6 space-y-6">
        <div className="flex items-center gap-2">
          <button onClick={() => nav('/app')} className="p-1.5 rounded hover:bg-zinc-100 text-zinc-600" aria-label="Back"><ArrowLeft size={16} /></button>
          <h1 className="text-base font-semibold tracking-tight">Settings</h1>
        </div>
        <div className="bg-white border border-zinc-200 rounded-lg divide-y divide-zinc-100">
          <div className="p-4 space-y-3">
            <h2 className="text-sm font-medium">Change master password</h2>
            <p className="text-xs text-zinc-500">Your files stay encrypted with the same key — only the wrapping key changes.</p>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1.5">Current password</label>
              <input type="password" value={cur} onChange={e => setCur(e.target.value)} className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-zinc-600 mb-1.5">New password</label>
              <input type="password" value={nw} onChange={e => setNw(e.target.value)} className="w-full border border-zinc-300 rounded px-3 py-2 text-sm focus:border-zinc-900" />
            </div>
            {msg && <p className="text-xs text-green-700">{msg}</p>}
            {err && <p className="text-xs text-red-600">{err}</p>}
            <button onClick={change} className="bg-zinc-900 text-white px-4 py-2 text-sm rounded hover:bg-zinc-800">Change password</button>
          </div>
        </div>
      </div>
    </div>
  );
}