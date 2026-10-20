import { useEffect, useState } from 'react';
import { ToastProvider } from './components/ui';
import { getToken, authFetch } from './auth';
import AuthPages from './pages/AuthPages';
import Shell, { KnowledgeBases, ApiKeys, Team } from './pages/Shell';
import KBDetail from './pages/KBDetail';
import WidgetPage from './pages/WidgetPage';

function parseHash() {
  const h = window.location.hash.replace(/^#/, '');
  if (h.startsWith('/share/')) return { page: 'share', slug: h.slice(7) };
  if (h.startsWith('/widget/')) return { page: 'widget', slug: h.slice(8) };
  return null;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [view, setView] = useState({ page: 'kbs' });
  const [pub, setPub] = useState(parseHash());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const onHash = () => setPub(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (pub) { setReady(true); return; } // public pages need no auth
    if (!getToken()) { setReady(true); return; }
    authFetch('/api/auth/me').then((r) => r.json()).then((d) => {
      setUser(d.user); setReady(true);
    }).catch(() => setReady(true));
  }, [pub]);

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>;

  // public routes (share page + embed widget) — no login
  if (pub?.page === 'widget') return <WidgetPage slug={pub.slug} embed />;
  if (pub?.page === 'share') return <WidgetPage slug={pub.slug} />;

  return (
    <ToastProvider>
      {!user ? (
        <AuthPages onAuth={setUser} />
      ) : (
        <Shell user={user} view={view} setView={setView}>
          {view.page === 'kbs' && <KnowledgeBases setView={setView} />}
          {view.page === 'kb' && <KBDetail kbId={view.kbId} setView={setView} />}
          {view.page === 'keys' && <ApiKeys />}
          {view.page === 'team' && <Team user={user} />}
        </Shell>
      )}
    </ToastProvider>
  );
}
