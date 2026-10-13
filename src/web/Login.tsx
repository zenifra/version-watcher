import { type FormEvent, useState } from 'react';
import { api } from './api.ts';

export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/login', { method: 'POST', body: { password } });
      onDone();
    } catch {
      setError('Wrong password');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="mx-auto mt-24 flex max-w-xs flex-col gap-3 px-4">
      <h1 className="text-lg font-semibold">Version Watcher</h1>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input type="password" autoFocus required value={password} onChange={(e) => setPassword(e.target.value)}
          className="rounded border border-zinc-300 bg-white px-2 py-1.5" />
      </label>
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      <button disabled={busy} className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50">Sign in</button>
    </form>
  );
}
