import { useEffect, useState } from 'react';
import { ToastProvider } from './components/ui';
import ErrorBoundary from './components/ErrorBoundary';
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
  const [products, setProducts] = useState(null);
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
      setUser(d.user); setProducts(d.products || { rcm: true, ai: true }); setReady(true);
    }).catch(() => setReady(true));
  }, [pub]);

  if (!ready) return <div className="min-h-screen flex items-center justify-center text-slate-400">Loading…</div>;

  // public routes (share page + embed widget) — no login
  if (pub?.page === 'widget') return <WidgetPage slug={pub.slug} embed />;
  if (pub?.page === 'share') return <WidgetPage slug={pub.slug} />;

  // Stripe return from AI-plan checkout (?billing=success on /ai/app/)
  const q = new URLSearchParams(window.location.search);
  if (q.get('billing') === 'success' || q.get('billing') === 'cancelled') {
    window.history.replaceState({}, '', '/ai/app/');
  }

  // RCM-Starter-only subscribers don't get the AI app
  if (user && products && products.ai === false) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6" style={{ background: 'linear-gradient(135deg,#0b1120 0%,#1e1b4b 60%,#312e81 100%)' }}>
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4" style={{ background: 'linear-gradient(135deg,#8b5cf6,#6d28d9)' }}>
            <span className="text-white text-2xl font-black">A</span>
          </div>
          <h1 className="text-white text-2xl font-bold mb-2">ClaimPaid AI isn't on your plan</h1>
          <p className="text-violet-200/70 text-sm mb-6">Your RCM Starter subscription covers the RCM dashboard only. Upgrade to RCM Pro + AI to unlock the AI assistant.</p>
          <a href="/app/" className="btn btn-primary w-full !py-3">Back to the RCM app →</a>
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      {!user ? (
        <AuthPages onAuth={setUser} />
      ) : (
        <Shell user={user} view={view} setView={setView}>
          {/* ErrorBoundary resets per view so a crashing tab shows a
              recoverable card instead of blank-screening the whole app. */}
          <ErrorBoundary key={view.page + ':' + (view.kbId || '')} fallbackLabel="This tab">
          {view.page === 'kbs' && <KnowledgeBases setView={setView} />}
          {view.page === 'kb' && <KBDetail kbId={view.kbId} setView={setView} />}
          {view.page === 'keys' && <ApiKeys />}
          {view.page === 'team' && <Team user={user} />}
          </ErrorBoundary>
        </Shell>
      )}
    </ToastProvider>
  );
}
