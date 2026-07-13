'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { SistemaCompleto } from '@/components/sistema-completo';

export function HomePage() {
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => {
        if (r.ok) setAuthed(true);
        else window.location.href = '/login';
      })
      .catch(() => { window.location.href = '/login'; })
      .finally(() => setLoading(false));
  }, []);

  if (loading || !authed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="animate-spin text-violet-500" size={32} />
      </div>
    );
  }

  return <SistemaCompleto />;
}
