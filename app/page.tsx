'use client';

import { FormEvent, useCallback, useMemo, useRef, useState } from 'react';
import { Ghost, Music2, Sparkles, Youtube } from 'lucide-react';

interface ProgressEvent {
  type: 'progress' | 'done';
  current?: number;
  total?: number;
  track?: string;
  artist?: string;
  videoId?: string;
  playlistUrl?: string | null;
  found?: number;
  error?: string;
}

export default function HomePage() {
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [total, setTotal] = useState(0);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [found, setFound] = useState(0);
  const [history, setHistory] = useState<string[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const progress = useMemo(() => {
    if (!total) return 0;
    return Math.min(100, Math.round((current / total) * 100));
  }, [current, total]);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (!playlistUrl.trim()) return;

      setLoading(true);
      setStatus('Initialisation…');
      setCurrent(0);
      setTotal(0);
      setResultUrl(null);
      setFound(0);
      setHistory([]);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch('/api/convert', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ playlistUrl }),
          signal: controller.signal
        });

        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({ error: 'Requête échouée.' }));
          throw new Error(data.error || 'Requête échouée.');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            const evt: ProgressEvent = JSON.parse(line);

            if (evt.type === 'progress') {
              setTotal(evt.total || 0);
              setCurrent(evt.current || 0);
              if (evt.track) {
                setHistory((prev) => [
                  `${evt.current}/${evt.total}: ${evt.track}${evt.artist ? ' • ' + evt.artist : ''}`,
                  ...prev
                ].slice(0, 4));
              }
            }

            if (evt.type === 'done') {
              setResultUrl(evt.playlistUrl || null);
              setFound(evt.found || 0);
            }
          }
        }

        setStatus('Terminé');
      } catch (err: any) {
        setStatus(err.message || 'Erreur inattendue');
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [playlistUrl]
  );

  const handleAbort = useCallback(() => {
    abortRef.current?.abort();
    setLoading(false);
    setStatus('Annulé');
  }, []);

  return (
    <main className="min-h-screen flex items-center justify-center px-6 py-12">
      <div className="max-w-4xl w-full space-y-10">
        <header className="text-center space-y-4">
          <div className="flex items-center justify-center gap-3 text-brand-200">
            <Ghost className="w-8 h-8" />
            <span className="uppercase tracking-[0.3em] text-sm font-semibold">GhostDL</span>
          </div>
          <h1 className="text-4xl md:text-5xl font-semibold text-white leading-tight">
            Transforme ta playlist Spotify en playlist YouTube <span className="text-brand-400">anonyme</span>
          </h1>
          <p className="text-slate-300 max-w-2xl mx-auto">
            Colle simplement une URL de playlist Spotify publique. Nous trouvons les correspondances sur YouTube et générons un lien prêt à ouvrir.
          </p>
          <div className="flex items-center justify-center gap-3 text-sm text-slate-400">
            <div className="flex items-center gap-2"><Music2 className="w-4 h-4" />Sans connexion Spotify</div>
            <div className="flex items-center gap-2"><Youtube className="w-4 h-4" />Playlist YouTube instantanée</div>
            <div className="flex items-center gap-2"><Sparkles className="w-4 h-4" />100% serverless</div>
          </div>
        </header>

        <section className="glass card-border p-6 md:p-8 rounded-3xl shadow-xl">
          <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-3 md:gap-4">
            <input
              type="url"
              required
              placeholder="https://open.spotify.com/playlist/…"
              value={playlistUrl}
              onChange={(e) => setPlaylistUrl(e.target.value)}
              className="w-full px-4 py-3 rounded-2xl bg-white/5 border border-white/10 focus:border-brand-400 focus:ring-2 focus:ring-brand-500/40 outline-none text-white"
            />
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={loading}
                className="px-5 py-3 rounded-2xl bg-brand-500 hover:bg-brand-400 transition text-white font-semibold shadow-lg disabled:opacity-60 disabled:cursor-not-allowed"
              >
                Convertir
              </button>
              {loading && (
                <button
                  type="button"
                  onClick={handleAbort}
                  className="px-4 py-3 rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 text-slate-200"
                >
                  Stop
                </button>
              )}
            </div>
          </form>

          <div className="mt-6 space-y-3">
            <div className="h-3 w-full bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-brand-400 to-emerald-400 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-sm text-slate-300">
              <span>{status || 'En attente d’une URL…'}</span>
              {total > 0 && (
                <span className="text-slate-400">{current}/{total} pistes</span>
              )}
            </div>
            {history.length > 0 && (
              <div className="text-xs text-slate-400 space-y-1">
                {history.map((line, i) => (
                  <div key={i} className="truncate">{line}</div>
                ))}
              </div>
            )}
          </div>

          {resultUrl && (
            <div className="mt-6 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-400/30 text-emerald-50 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
              <div>
                <p className="text-sm">Playlist prête !</p>
                <p className="font-semibold">{found} vidéos appariées</p>
              </div>
              <a
                href={resultUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-400 text-emerald-950 font-semibold hover:bg-emerald-300 transition"
              >
                Ouvrir sur YouTube
              </a>
            </div>
          )}
        </section>

        <footer className="text-center text-xs text-slate-500">
          Pas de stockage, pas de compte. Toute la logique tourne côté API, parfait pour un déploiement Vercel.
        </footer>
      </div>
    </main>
  );
}
