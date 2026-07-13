'use client';

import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function HomePage() {
  const [redirecting, setRedirecting] = useState(true);

  useEffect(() => {
    // Verificar si hay token — si no, ir a login
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => {
        if (r.ok) {
          setRedirecting(false);
        } else {
          window.location.href = '/login';
        }
      })
      .catch(() => {
        window.location.href = '/login';
      });
  }, []);

  if (redirecting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="animate-spin text-violet-500" size={32} />
      </div>
    );
  }

  // Importar dinámicamente para evitar errores de SSR/prerender
  const SistemaCompleto = require('@/components/sistema-completo').SistemaCompleto;
  return <SistemaCompleto />;
}
