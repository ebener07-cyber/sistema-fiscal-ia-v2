'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Loader2, Lock, Mail, Building2 } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/auth/me').then(r => {
      if (r.ok) router.push('/');
      else setChecking(false);
    }).catch(() => setChecking(false));
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const r = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || 'Error al iniciar sesión');
      } else {
        router.push('/');
        router.refresh();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="animate-spin text-violet-500" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-950 via-violet-950 to-slate-950 p-4">
      <Card className="w-full max-w-md p-8 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-violet-500/20 shadow-2xl">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-xl bg-gradient-to-br from-violet-600 to-fuchsia-600 mb-4 shadow-lg shadow-violet-500/30">
            <Building2 className="text-white" size={28} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Sistema Fiscal IA</h1>
          <p className="text-sm text-muted-foreground mt-1">ERP fiscal con IA · Inicia sesión</p>
        </div>
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-400 p-3 rounded-lg text-sm mb-4">
            {error}
          </div>
        )}
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground mb-1 block">Email</label>
            <div className="relative">
              <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="admin@empresa.mx" className="pl-10" required />
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground mb-1 block">Contraseña</label>
            <div className="relative">
              <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" className="pl-10" required />
            </div>
          </div>
          <Button type="submit" disabled={loading} className="w-full bg-violet-600 hover:bg-violet-700">
            {loading ? <Loader2 size={16} className="animate-spin mr-2" /> : null}
            {loading ? 'Iniciando...' : 'Iniciar sesión'}
          </Button>
        </form>
        <div className="mt-6 p-3 bg-violet-50 dark:bg-violet-900/20 rounded-lg text-xs text-violet-700 dark:text-violet-300">
          <p className="font-semibold mb-1">Credenciales de prueba:</p>
          <p>📧 admin@hernandez.mx</p>
          <p>🔑 admin123</p>
        </div>
      </Card>
    </div>
  );
}
