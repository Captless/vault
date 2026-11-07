import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { changeMasterPassword } from '../services/crypto.service';
import { clearSession } from '../services/crypto.service';

export default function SettingsPage() {
  const nav = useNavigate();
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [msg, setMsg] = useState('');
  async function change() {
    const ok = await changeMasterPassword(cur, nw);
    setMsg(ok ? 'Password changed.' : 'Failed (check current password).');
    if (ok) { setCur(''); setNw(''); }
  }
  return (
    <div className="h-full p-6 max-w-md mx-auto space-y-4">
      <button onClick={()=>nav('/app')} className="text-xs text-zinc-500">← Back</button>
      <h1 className="text-lg font-semibold">Settings</h1>
      <div className="border border-zinc-200 bg-white p-4 space-y-3">
        <h2 className="text-sm font-medium">Change master password</h2>
        <input type="password" value={cur} onChange={e=>setCur(e.target.value)} placeholder="Current password" className="w-full border border-zinc-300 px-3 py-2 text-sm" />
        <input type="password" value={nw} onChange={e=>setNw(e.target.value)} placeholder="New password" className="w-full border border-zinc-300 px-3 py-2 text-sm" />
        <button onClick={change} className="bg-zinc-900 text-white px-3 py-2 text-sm">Change</button>
        {msg && <p className="text-xs text-zinc-600">{msg}</p>}
      </div>
      <button onClick={()=>{ clearSession(); nav('/login'); }} className="text-xs text-red-600">Lock vault</button>
    </div>
  );
}