import { createContext, useContext, useState, useCallback } from 'react';

const ToastCtx = createContext(null);
export function useToast() {
  return useContext(ToastCtx);
}
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const push = useCallback((msg, kind = '') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3800);
  }, []);
  const api = {
    success: (m) => push(m, 'toast-ok'),
    error: (m) => push(m, 'toast-err'),
    info: (m) => push(m, ''),
  };
  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-sub">{subtitle}</p>}
      </div>
      {actions && <div className="flex gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }) {
  return <div className={`skeleton ${className}`} />;
}

export function EmptyState({ icon, title, sub, action }) {
  return (
    <div className="card card-pad text-center py-14">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="font-bold text-lg text-stone-800 mb-1">{title}</h3>
      {sub && <p className="text-sm text-stone-500 max-w-md mx-auto mb-5">{sub}</p>}
      {action}
    </div>
  );
}

export function Modal({ onClose, children, wide }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={wide ? { maxWidth: 720 } : {}} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="stat-card">
      <div className="stat-num">{value}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="text-xs text-stone-400 mt-1">{sub}</div>}
    </div>
  );
}

export function Field({ label, hint, children }) {
  return (
    <div className="mb-4">
      {label && <label className="label">{label}</label>}
      {children}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}
