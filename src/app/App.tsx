import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { db } from '../db/database';
import SetupPage from '../components/SetupPage';
import LoginPage from '../components/LoginPage';
import ExplorerPage from '../components/ExplorerPage';
import EditorPage from '../components/EditorPage';
import DecoyEditorPage from '../components/DecoyEditorPage';
import SettingsPage from '../components/SettingsPage';
import BackupPage from '../components/BackupPage';

export default function App() {
  const [hasVault, setHasVault] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    db.open().then(() => db.vaultMeta.get('vault')).then(async m => {
      if (m) {
        const { restoreSession } = await import('../services/crypto.service');
        setUnlocked(await restoreSession());
      }
      setHasVault(!!m);
    }).catch(err => {
      console.error('DB open failed', err);
      setLoadError(String(err?.message ?? err));
    });
  }, []);
  if (loadError) return (
    <div className="h-full flex flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-sm text-red-600">Failed to open local database.</p>
      <p className="text-xs text-zinc-500 max-w-md">{loadError}</p>
      <button onClick={async () => { await db.delete(); location.reload(); }} className="bg-zinc-900 text-white px-4 py-2 text-sm">Reset local data & reload</button>
    </div>
  );
  const [unlocked, setUnlocked] = useState(false);
  if (hasVault === null) return <div className="h-full flex items-center justify-center text-sm text-zinc-500">Loading…</div>;
  return (
    <BrowserRouter>
      <Routes>
        {!hasVault && <Route path="/setup" element={<SetupPage onDone={() => { setHasVault(true); setUnlocked(true); }} />} />}
        {hasVault && <Route path="/login" element={<LoginPage onUnlock={() => setUnlocked(true)} />} />}
        {unlocked && <Route path="/app/*" element={<ExplorerPage onLock={() => setUnlocked(false)} />} />}
        <Route path="/editor/:id" element={<EditorPage />} />
        <Route path="/decoy-editor/:folderId/:docId" element={<DecoyEditorPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/backup" element={<BackupPage />} />
        <Route path="*" element={<Navigate to={!hasVault ? '/setup' : unlocked ? '/app' : '/login'} replace />} />
      </Routes>
    </BrowserRouter>
  );
}