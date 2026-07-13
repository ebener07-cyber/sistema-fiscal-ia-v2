'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Loader2, Shield, Users, Plus, Trash2, KeyRound, Lock, Mail,
} from 'lucide-react';

interface Usuario {
  id: string;
  email: string;
  nombre: string;
  rol: string;
  empresaId: string | null;
  createdAt: string;
  empresa?: { nombre: string; rfc: string } | null;
}

interface Empresa {
  id: string;
  nombre: string;
  rfc: string;
}

export default function AdminPage() {
  const router = useRouter();
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    email: '', nombre: '', password: '', rol: 'usuario', empresaId: '',
  });
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const load = async () => {
    try {
      const [u, e] = await Promise.all([
        fetch('/api/usuarios').then(r => r.json()),
        fetch('/api/empresas').then(r => r.json()),
      ]);
      if (u.usuarios) setUsuarios(u.usuarios);
      if (e.empresas) setEmpresas(e.empresas);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Verificar auth
    fetch('/api/auth/me').then(r => {
      if (!r.ok) router.push('/login');
      else load();
    }).catch(() => router.push('/login'));
  }, [router]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.nombre || !form.password) {
      setError('Email, nombre y password son obligatorios');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const r = await fetch('/api/usuarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || 'Error al crear usuario');
      } else {
        setShowForm(false);
        setForm({ email: '', nombre: '', password: '', rol: 'usuario', empresaId: '' });
        load();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const eliminar = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar al usuario "${nombre}"?`)) return;
    try {
      const r = await fetch(`/api/usuarios/${id}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) alert(d.error || 'Error');
      else load();
    } catch (e: any) {
      alert(e.message);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="animate-spin text-violet-500" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="bg-violet-600 text-white p-3 rounded-xl">
              <Shield size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Panel de Administración</h1>
              <p className="text-sm text-muted-foreground">
                Gestión de usuarios y permisos
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push('/')}>
              ← Volver al sistema
            </Button>
            <Button onClick={() => setShowForm(!showForm)}>
              <Plus size={16} className="mr-2" /> Nuevo usuario
            </Button>
          </div>
        </div>

        {/* Stats rápidas */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="p-4 border-l-4 border-l-violet-500">
            <div className="flex items-center gap-2">
              <Users className="text-violet-500" size={18} />
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                Total usuarios
              </div>
            </div>
            <div className="text-2xl font-bold mt-1">{usuarios.length}</div>
          </Card>
          <Card className="p-4 border-l-4 border-l-blue-500">
            <div className="flex items-center gap-2">
              <Shield className="text-blue-500" size={18} />
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                Administradores
              </div>
            </div>
            <div className="text-2xl font-bold mt-1">
              {usuarios.filter(u => u.rol === 'admin').length}
            </div>
          </Card>
          <Card className="p-4 border-l-4 border-l-emerald-500">
            <div className="flex items-center gap-2">
              <KeyRound className="text-emerald-500" size={18} />
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                Usuarios regulares
              </div>
            </div>
            <div className="text-2xl font-bold mt-1">
              {usuarios.filter(u => u.rol === 'usuario').length}
            </div>
          </Card>
          <Card className="p-4 border-l-4 border-l-amber-500">
            <div className="flex items-center gap-2">
              <Lock className="text-amber-500" size={18} />
              <div className="text-[10px] uppercase font-semibold text-muted-foreground">
                Empresas
              </div>
            </div>
            <div className="text-2xl font-bold mt-1">{empresas.length}</div>
          </Card>
        </div>

        {/* Formulario alta */}
        {showForm && (
          <Card className="p-5">
            <h2 className="font-semibold mb-4 flex items-center gap-2">
              <Plus size={18} /> Nuevo usuario
            </h2>
            <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold">Nombre completo</label>
                <Input
                  value={form.nombre}
                  onChange={e => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Juan Pérez"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold">Email</label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={e => setForm({ ...form, email: e.target.value })}
                  placeholder="juan@empresa.com"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold">Contraseña</label>
                <Input
                  type="password"
                  value={form.password}
                  onChange={e => setForm({ ...form, password: e.target.value })}
                  placeholder="••••••••"
                  required
                />
              </div>
              <div>
                <label className="text-xs font-semibold">Rol</label>
                <select
                  value={form.rol}
                  onChange={e => setForm({ ...form, rol: e.target.value })}
                  className="w-full h-10 px-3 rounded-md border bg-background"
                >
                  <option value="usuario">Usuario (acceso a una empresa)</option>
                  <option value="admin">Admin (acceso total)</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-xs font-semibold">
                  Empresa asignada (solo si rol = usuario)
                </label>
                <select
                  value={form.empresaId}
                  onChange={e => setForm({ ...form, empresaId: e.target.value })}
                  className="w-full h-10 px-3 rounded-md border bg-background"
                >
                  <option value="">— Sin empresa (admin) —</option>
                  {empresas.map(emp => (
                    <option key={emp.id} value={emp.id}>
                      {emp.nombre} ({emp.rfc})
                    </option>
                  ))}
                </select>
              </div>
              {error && (
                <div className="md:col-span-2 text-red-600 text-sm">{error}</div>
              )}
              <div className="md:col-span-2 flex gap-2">
                <Button type="submit" disabled={creating}>
                  {creating ? (
                    <>
                      <Loader2 size={14} className="mr-2 animate-spin" /> Creando...
                    </>
                  ) : (
                      'Crear usuario'
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Tabla usuarios */}
        <Card className="p-0 overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="font-semibold flex items-center gap-2">
              <Users size={18} /> Usuarios del sistema ({usuarios.length})
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-[11px] uppercase text-left">
                  <th className="px-4 py-2">Nombre</th>
                  <th className="px-4 py-2">Email</th>
                  <th className="px-4 py-2">Rol</th>
                  <th className="px-4 py-2">Empresa</th>
                  <th className="px-4 py-2">Creado</th>
                  <th className="px-4 py-2 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {usuarios.map(u => (
                  <tr key={u.id} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-2 font-medium">{u.nombre}</td>
                    <td className="px-4 py-2 font-mono text-xs">{u.email}</td>
                    <td className="px-4 py-2">
                      <Badge
                        variant={u.rol === 'admin' ? 'default' : 'secondary'}
                      >
                        {u.rol}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {u.empresa?.nombre || '—'}
                    </td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">
                      {new Date(u.createdAt).toLocaleDateString('es-MX')}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        onClick={() => eliminar(u.id, u.nombre)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 transition"
                      >
                        <Trash2 size={12} /> Eliminar
                      </button>
                    </td>
                  </tr>
                ))}
                {usuarios.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-muted-foreground">
                      No hay usuarios registrados
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
