'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SistemaCompleto } from '@/components/sistema-completo';
import { Loader2 } from 'lucide-react';

export default function HomePage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => {
        if (r.ok) setAuthed(true);
        else router.push('/login');
      })
      .catch(() => router.push('/login'));
  }, [router]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
        <div className="text-center max-w-md">
          <p className="text-red-500 mb-4">{error}</p>
          <button onClick={() => router.push('/login')} className="text-violet-500 underline">
            Volver al login
          </button>
        </div>
      </div>
    );
  }

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
