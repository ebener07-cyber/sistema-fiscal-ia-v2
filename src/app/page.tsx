'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function HomePage() {
  const [status, setStatus] = useState<'loading' | 'authed' | 'redirect'>('loading');

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => {
        if (r.ok) setStatus('authed');
        else setStatus('redirect');
      })
      .catch(() => setStatus('redirect'));
  }, []);

  useEffect(() => {
    if (status === 'redirect') {
      window.location.href = '/login';
    }
  }, [status]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="animate-spin text-violet-500" size={32} />
      </div>
    );
  }

  if (status === 'redirect') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="animate-spin text-violet-500" size={32} />
      </div>
    );
  }

  // Solo cargar el sistema completo cuando sabemos que está autenticado
  const SistemaCompleto = require('@/components/sistema-completo').SistemaCompleto;
  return <SistemaCompleto />;
}
