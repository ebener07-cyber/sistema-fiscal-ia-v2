'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

// Cargar SistemaCompleto solo en el cliente (sin SSR)
const SistemaCompleto = dynamic(() => import('@/components/sistema-completo').then(m => m.SistemaCompleto), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center bg-slate-950">
      <Loader2 className="animate-spin text-violet-500" size={32} />
    </div>
  ),
});

export default function HomePage() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => {
        if (r.ok) setAuthed(true);
        else window.location.href = '/login';
      })
      .catch(() => { window.location.href = '/login'; });
  }, []);

  if (authed === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="animate-spin text-violet-500" size={32} />
      </div>
    );
  }

  if (!authed) return null;

  return <SistemaCompleto />;
}
