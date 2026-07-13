'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Mic, MicOff, Volume2, VolumeX, X, Send, Loader2, Sparkles, Zap, Bell,
  CheckCircle2, TrendingUp, TrendingDown, DollarSign, FileText, Calculator,
  Building2, Users, Truck, User, Wallet, ShoppingCart, Package, Banknote,
  BookOpen, Satellite, Bot, Scale, ClipboardList, BarChart3, MessageSquare,
  Moon, Sun, Menu, Search, Pin, StickyNote, AlertTriangle, Clock,
  Upload, FileSpreadsheet, Heart, Home as HomeIcon, Plus, ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { useEmpresa } from '@/components/empresa-provider';
import { useRouter } from 'next/navigation';
import {
  Settings, KeyRound, Trash2, ShieldAlert, Lock,
} from 'lucide-react';

// ====================== TIPOS ======================
interface Stats {
  fiscal: { totalEmitido: number; ivaEmitido: number; totalRecibido: number; ivaRecibido: number; ivaPorPagar: number; utilidadBruta: number; countEmitidas: number; countRecibidas: number; };
  catalogos: { clientes: number; proveedores: number; empleados: number; productos: number; stockBajo: number; };
  abbax: { tareasPend: number; notas: number; recordatorios: number; conversacionesHoy: number; };
  topClientes: Array<{ nombre: string; rfc: string; total: number; count: number; }>;
  fecha: string;
}

const fmt = (n: number) => new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0);

// ====================== SIDEBAR NAV ======================
const NAV = [
  { section: 'Principal', items: [{ id: 'dashboard', label: 'Dashboard', icon: BarChart3 }] },
  {
    section: 'Catálogos',
    items: [
      { id: 'empresas', label: 'Empresas', icon: Building2 },
      { id: 'clientes', label: 'Clientes', icon: Users },
      { id: 'proveedores', label: 'Proveedores', icon: Truck },
      { id: 'empleados', label: 'Empleados', icon: User },
    ],
  },
  {
    section: 'Operación',
    items: [
      { id: 'facturacion', label: 'Facturación CFDI', icon: FileText },
      { id: 'nomina', label: 'Nómina', icon: Wallet },
      { id: 'compras', label: 'Compras', icon: ShoppingCart },
      { id: 'inventario', label: 'Inventario', icon: Package },
      { id: 'bancos', label: 'Bancos + Estados Cta', icon: Banknote },
      { id: 'contabilidad', label: 'Contabilidad', icon: BookOpen },
    ],
  },
  {
    section: 'Fiscal',
    items: [
      { id: 'sat', label: 'SAT / CFDI Upload', icon: Satellite },
      { id: 'ia-fiscal', label: 'IA Fiscal', icon: Bot },
      { id: 'auditoria-fiscal', label: 'Auditoría Fiscal (RAG)', icon: Scale },
      { id: 'imss', label: 'IMSS + Upload', icon: ShieldCheck },
      { id: 'infonavit', label: 'INFONAVIT + Upload', icon: HomeIcon },
      { id: 'tributario', label: 'Tributario', icon: Scale },
      { id: 'diot', label: 'DIOT', icon: FileText },
      { id: 'inegi', label: 'INEGI', icon: BarChart3 },
    ],
  },
  {
    section: 'Análisis',
    items: [
      { id: 'finanzas', label: 'Reestructura Fin.', icon: DollarSign },
      { id: 'crm', label: 'CRM', icon: TrendingUp },
      { id: 'reportes', label: 'Reportes + Excel', icon: ClipboardList },
      { id: 'balance', label: 'Balance General', icon: BookOpen },
    ],
  },
  { section: 'Asistente IA', items: [{ id: 'abbax', label: 'Abbax (Stark)', icon: Zap }] },
];

// ====================== COMPONENTE PRINCIPAL ======================
export function SistemaCompleto() {
  const [view, setView] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [abbaxOpen, setAbbaxOpen] = useState(false);
  const { theme, toggle } = useTheme();
  const [authChecked, setAuthChecked] = useState(false);
  const [usuario, setUsuario] = useState<any>(null);
  const { empresa, empresas, setEmpresa } = useEmpresa();
  const router = useRouter();

  // Verificar autenticación al cargar
  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(r => {
        if (!r.ok) throw new Error('no-auth');
        return r.json();
      })
      .then(d => { setUsuario(d.usuario); })
      .catch(() => { window.location.href = '/login'; })
      .finally(() => setAuthChecked(true));
  }, []);

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  };

  const cargarStats = useCallback(async () => {
    try {
      const r = await fetch('/api/stats', { credentials: 'include' });
      const d = await r.json();
      return d;
    } catch (e) {
      console.error('Error cargando stats:', e);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    let mounted = true;
    const load = async () => {
      const s = await cargarStats();
      if (mounted && s) setStats(s);
    };
    load();
    const t = setInterval(load, 60000);
    return () => { mounted = false; clearInterval(t); };
  }, [authChecked, cargarStats]);

  if (!authChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950">
        <Loader2 className="animate-spin text-violet-500" size={32} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 dark:from-slate-950 dark:via-violet-950 dark:to-slate-950 transition-colors">
      {/* SIDEBAR */}
      <aside className={cn(
        'fixed top-0 left-0 h-full w-64 bg-slate-950 text-slate-300 z-40 transform transition-transform overflow-y-auto',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        <div className="p-4 border-b border-white/10 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-600 to-fuchsia-600 flex items-center justify-center text-white font-bold text-sm">
            SF
          </div>
          <div>
            <div className="text-white font-bold text-sm">Sistema Fiscal IA</div>
            <div className="text-xs text-slate-400">ERP Completo · v2.0</div>
          </div>
        </div>

        <nav className="p-3">
          {NAV.map((sec) => (
            <div key={sec.section} className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold px-3 mb-1">
                {sec.section}
              </div>
              {sec.items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setView(item.id); setSidebarOpen(false); }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                      view === item.id ? 'bg-violet-600 text-white font-semibold' : 'text-slate-400 hover:bg-white/5 hover:text-white'
                    )}
                  >
                    <Icon size={16} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      {/* Overlay mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* MAIN */}
      <div className="lg:ml-64">
        {/* TOPBAR */}
        <header className="border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-sm sticky top-0 z-20">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setSidebarOpen(true)}>
                <Menu size={18} />
              </Button>
              <div>
                <h1 className="font-bold text-lg capitalize">{NAV.flatMap(s => s.items).find(i => i.id === view)?.label || 'Dashboard'}</h1>
                <p className="text-xs text-muted-foreground">
                  {view === 'dashboard' ? 'Resumen general del sistema' : `Módulo ${view}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative hidden md:block">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar... (Ctrl+K)" className="pl-9 w-56 h-9 text-sm" />
              </div>
              <Button variant="ghost" size="icon" onClick={toggle} title="Modo oscuro (Ctrl+D)">
                {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              </Button>
              <Button variant="ghost" size="icon" title="Notificaciones">
                <Bell size={16} />
              </Button>
              <div className="flex items-center gap-2 bg-violet-100 dark:bg-violet-900/30 px-3 py-1 rounded-full">
                <div className="w-6 h-6 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-bold">
                  HE
                </div>
                <span className="text-xs font-semibold hidden sm:inline">Hernández</span>
              </div>
            </div>
          </div>
        </header>

        {/* CONTENT */}
        <main className="p-4 md:p-6 max-w-7xl mx-auto">
          {view === 'dashboard' && <DashboardView stats={stats} setView={setView} />}
          {view === 'empresas' && <EmpresasView />}
          {view === 'clientes' && <ClientesView />}
          {view === 'proveedores' && <ProveedoresView />}
          {view === 'empleados' && <EmpleadosView />}
          {view === 'facturacion' && <FacturacionView />}
          {view === 'nomina' && <NominaView />}
          {view === 'compras' && <ComprasView />}
          {view === 'inventario' && <InventarioView />}
          {view === 'bancos' && <BancosView />}
          {view === 'contabilidad' && <ContabilidadView />}
          {view === 'sat' && <SatView />}
          {view === 'ia-fiscal' && <IaFiscalView />}
          {view === 'auditoria-fiscal' && <AuditoriaFiscalView />}
          {view === 'imss' && <ImssView />}
          {view === 'infonavit' && <InfonavitView />}
          {view === 'tributario' && <TributarioView />}
          {view === 'diot' && <DiotView />}
          {view === 'inegi' && <InegiView />}
          {view === 'finanzas' && <FinanzasView stats={stats} />}
          {view === 'crm' && <CrmView />}
          {view === 'reportes' && <ReportesView stats={stats} />}
          {view === 'balance' && <BalanceView />}
          {view === 'abbax' && <AbbaxView onDatosActualizados={cargarStats} />}
        </main>
      </div>

      {/* ABBAX FLOTANTE (siempre disponible excepto en vista abbax) */}
      {view !== 'abbax' && (
        <button
          onClick={() => setView('abbax')}
          className="fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-gradient-to-br from-violet-600 to-fuchsia-600 shadow-lg shadow-violet-500/40 flex items-center justify-center text-white hover:scale-105 transition-transform"
          title="Hablar con Abbax"
        >
          <Zap size={22} />
        </button>
      )}
    </div>
  );
}

// ====================== DASHBOARD VIEW ======================
function DashboardView({ stats, setView }: { stats: Stats | null; setView: (v: string) => void }) {
  if (!stats) return <div className="text-center py-20 text-muted-foreground">Cargando dashboard...</div>;

  const kpis = [
    { label: 'Ingresos del mes', value: fmt(stats.fiscal.totalEmitido), sub: `${stats.fiscal.countEmitidas} facturas`, icon: TrendingUp, color: 'text-emerald-600', border: 'border-l-emerald-500' },
    { label: 'Egresos del mes', value: fmt(stats.fiscal.totalRecibido), sub: `${stats.fiscal.countRecibidas} facturas`, icon: TrendingDown, color: 'text-orange-600', border: 'border-l-orange-500' },
    { label: 'Utilidad bruta', value: fmt(stats.fiscal.utilidadBruta), sub: `Margen ${Math.round((stats.fiscal.utilidadBruta / stats.fiscal.totalEmitido) * 100)}%`, icon: DollarSign, color: 'text-blue-600', border: 'border-l-blue-500' },
    { label: 'IVA por pagar', value: fmt(stats.fiscal.ivaPorPagar), sub: 'Vence 17/ago', icon: Calculator, color: 'text-red-600', border: 'border-l-red-500' },
    { label: 'Clientes activos', value: String(stats.catalogos.clientes), sub: 'En catálogo', icon: Users, color: 'text-violet-600', border: 'border-l-violet-500' },
    { label: 'Empleados', value: String(stats.catalogos.empleados), sub: 'Nómina al corriente', icon: User, color: 'text-fuchsia-600', border: 'border-l-fuchsia-500' },
    { label: 'Productos', value: String(stats.catalogos.productos), sub: `${stats.catalogos.stockBajo} stock bajo`, icon: Package, color: 'text-amber-600', border: 'border-l-amber-500' },
    { label: 'Chats con Abbax hoy', value: String(stats.abbax.conversacionesHoy), sub: `${stats.abbax.tareasPend} tareas pend`, icon: Zap, color: 'text-cyan-600', border: 'border-l-cyan-500' },
  ];

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label} className={cn('p-4 border-l-4', k.border)}>
              <div className={cn('flex items-center gap-1.5 mb-1', k.color)}>
                <Icon size={14} />
                <span className="text-[10px] uppercase font-semibold tracking-wide">{k.label}</span>
              </div>
              <div className={cn('text-xl font-bold', k.color)}>{k.value}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">{k.sub}</div>
            </Card>
          );
        })}
      </div>

      {/* Top clientes + alertas */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <TrendingUp size={16} className="text-violet-600" /> Top clientes del mes
          </h3>
          {stats.topClientes.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">Sin facturas emitidas este mes</p>
          ) : (
            <ul className="space-y-2">
              {stats.topClientes.map((c, i) => (
                <li key={c.rfc} className="flex items-center gap-3 text-sm">
                  <span className="w-6 h-6 rounded-full bg-violet-100 text-violet-700 text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate">{c.nombre}</span>
                  <span className="font-semibold text-violet-700">{fmt(c.total)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" /> Alertas activas
          </h3>
          <div className="space-y-2">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-200">
              <strong>IVA vence en 7 días</strong>
              <br />{fmt(stats.fiscal.ivaPorPagar)} · 17/agosto
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 text-xs text-red-800 dark:text-red-200">
              <strong>{stats.abbax.tareasPend} tareas urgentes pendientes</strong>
              <br />Revisa con Abbax
            </div>
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-xs text-blue-800 dark:text-blue-200">
              <strong>Nómina pagada</strong>
              <br />5 empleados · {fmt(92000)}
            </div>
          </div>
        </Card>
      </div>

      {/* Accesos rápidos */}
      <h3 className="font-semibold text-base mt-6">Accesos rápidos</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { id: 'facturacion', label: 'Facturación CFDI', icon: FileText, color: 'text-blue-600' },
          { id: 'sat', label: 'Descarga SAT', icon: Satellite, color: 'text-emerald-600' },
          { id: 'ia-fiscal', label: 'IA Fiscal', icon: Bot, color: 'text-violet-600' },
          { id: 'abbax', label: 'Abbax Stark', icon: Zap, color: 'text-cyan-600' },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <button
              key={m.id}
              onClick={() => setView(m.id)}
              className="bg-white dark:bg-slate-900 border border-l-4 border-l-violet-500 rounded-lg p-4 text-left hover:shadow-md transition-shadow"
            >
              <Icon size={24} className={cn('mb-2', m.color)} />
              <div className="font-semibold text-sm">{m.label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ====================== COMPONENTES DE VISTAS ======================
function useApiData<T>(url: string): { data: T | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(url);
      const d = await r.json();
      setData(d);
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, refresh: load };
}

function DataTableCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-4 py-3 border-b font-semibold text-sm">{title}</div>
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

function EmptyState({ icon: Icon, message }: { icon: any; message: string }) {
  return (
    <div className="text-center py-12 text-muted-foreground">
      <Icon size={36} className="mx-auto mb-2 opacity-40" />
      <p className="text-sm">{message}</p>
    </div>
  );
}

function ClientesView() {
  const { data, loading } = useApiData<{ clientes: any[] }>('/api/clientes');
  if (loading) return <div className="text-center py-20">Cargando clientes...</div>;
  if (!data?.clientes?.length) return <EmptyState icon={Users} message="Sin clientes registrados" />;
  return (
    <DataTableCard title={`Clientes (${data.clientes.length})`}>
      <table className="w-full text-sm">
        <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
          <th className="px-4 py-2">Nombre</th><th className="px-4 py-2">RFC</th>
          <th className="px-4 py-2">Email</th><th className="px-4 py-2">Facturas</th>
          <th className="px-4 py-2">Saldo</th>
        </tr></thead>
        <tbody>
          {data.clientes.map((c) => (
            <tr key={c.id} className="border-b hover:bg-muted/30">
              <td className="px-4 py-2 font-medium">{c.nombre}</td>
              <td className="px-4 py-2 font-mono text-xs">{c.rfc}</td>
              <td className="px-4 py-2 text-muted-foreground">{c.email || '—'}</td>
              <td className="px-4 py-2"><Badge variant="secondary">{c._count.facturas}</Badge></td>
              <td className="px-4 py-2 font-semibold">{fmt(c.saldo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableCard>
  );
}

function ProveedoresView() {
  const { data, loading } = useApiData<{ proveedores: any[] }>('/api/proveedores');
  if (loading) return <div className="text-center py-20">Cargando...</div>;
  if (!data?.proveedores?.length) return <EmptyState icon={Truck} message="Sin proveedores" />;
  return (
    <DataTableCard title={`Proveedores (${data.proveedores.length})`}>
      <table className="w-full text-sm">
        <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
          <th className="px-4 py-2">Nombre</th><th className="px-4 py-2">RFC</th>
          <th className="px-4 py-2">Servicio</th><th className="px-4 py-2">Órdenes</th>
          <th className="px-4 py-2">Saldo</th>
        </tr></thead>
        <tbody>
          {data.proveedores.map((p) => (
            <tr key={p.id} className="border-b hover:bg-muted/30">
              <td className="px-4 py-2 font-medium">{p.nombre}</td>
              <td className="px-4 py-2 font-mono text-xs">{p.rfc}</td>
              <td className="px-4 py-2 text-muted-foreground">{p.servicio || '—'}</td>
              <td className="px-4 py-2"><Badge variant="secondary">{p._count.ordenesCompra}</Badge></td>
              <td className="px-4 py-2 font-semibold">{fmt(p.saldo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableCard>
  );
}

function EmpleadosView() {
  const { data, loading } = useApiData<{ empleados: any[] }>('/api/empleados');
  if (loading) return <div className="text-center py-20">Cargando...</div>;
  if (!data?.empleados?.length) return <EmptyState icon={User} message="Sin empleados" />;
  return (
    <DataTableCard title={`Empleados (${data.empleados.length})`}>
      <table className="w-full text-sm">
        <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
          <th className="px-4 py-2">Nombre</th><th className="px-4 py-2">RFC</th>
          <th className="px-4 py-2">Puesto</th><th className="px-4 py-2">Departamento</th>
          <th className="px-4 py-2">Salario mensual</th><th className="px-4 py-2">Estado</th>
        </tr></thead>
        <tbody>
          {data.empleados.map((e) => (
            <tr key={e.id} className="border-b hover:bg-muted/30">
              <td className="px-4 py-2 font-medium">{e.nombre}</td>
              <td className="px-4 py-2 font-mono text-xs">{e.rfc}</td>
              <td className="px-4 py-2">{e.puesto || '—'}</td>
              <td className="px-4 py-2">{e.departamento || '—'}</td>
              <td className="px-4 py-2 font-semibold">{fmt(e.salarioMensual)}</td>
              <td className="px-4 py-2"><Badge variant={e.status === 'activo' ? 'default' : 'secondary'}>{e.status}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableCard>
  );
}

function FacturacionView() {
  const { data, loading } = useApiData<{ facturas: any[]; total: number; iva: number }>('/api/facturas');
  if (loading) return <div className="text-center py-20">Cargando...</div>;
  if (!data?.facturas?.length) return <EmptyState icon={FileText} message="Sin facturas" />;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 border-l-4 border-l-emerald-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total facturas</div>
          <div className="text-xl font-bold">{data.facturas.length}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-violet-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Monto total</div>
          <div className="text-xl font-bold text-violet-600">{fmt(data.total)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-blue-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">IVA total</div>
          <div className="text-xl font-bold text-blue-600">{fmt(data.iva)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-amber-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Emitidas/Recibidas</div>
          <div className="text-xl font-bold">
            {data.facturas.filter(f => f.direccion === 'emitida').length} / {data.facturas.filter(f => f.direccion === 'recibida').length}
          </div>
        </Card>
      </div>

      <DataTableCard title="Facturas recientes">
        <table className="w-full text-sm">
          <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
            <th className="px-4 py-2">Folio</th><th className="px-4 py-2">Fecha</th>
            <th className="px-4 py-2">RFC contraparte</th><th className="px-4 py-2">Concepto</th>
            <th className="px-4 py-2">Tipo</th><th className="px-4 py-2 text-right">Total</th>
          </tr></thead>
          <tbody>
            {data.facturas.map((f) => (
              <tr key={f.id} className="border-b hover:bg-muted/30">
                <td className="px-4 py-2 font-mono text-xs">{f.folio}</td>
                <td className="px-4 py-2">{new Date(f.fecha).toLocaleDateString('es-MX')}</td>
                <td className="px-4 py-2 font-mono text-xs">{f.receptorRfc || f.emisorRfc}</td>
                <td className="px-4 py-2 truncate max-w-[200px]">{f.concepto || '—'}</td>
                <td className="px-4 py-2">
                  <Badge variant={f.direccion === 'emitida' ? 'default' : 'secondary'}>
                    {f.direccion}
                  </Badge>
                </td>
                <td className="px-4 py-2 text-right font-semibold">{fmt(f.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableCard>
    </div>
  );
}

function NominaView({ empresaId }: { empresaId?: string }) {
  const hoy = new Date();
  const [anioSel, setAnioSel] = useState(hoy.getFullYear());
  const [mesSel, setMesSel] = useState(0); // 0 = Todo el año

  const url = mesSel === 0
    ? `/api/nomina?anio=${anioSel}`
    : `/api/nomina?mes=${mesSel}&anio=${anioSel}`;
  const { data, loading } = useApiData<any>(url, empresaId);

  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const resumen = data?.resumenMensual || [];

  return (
    <div className="space-y-4">
      {/* Selector de año */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-muted-foreground">Año:</span>
        <select value={anioSel} onChange={e => setAnioSel(parseInt(e.target.value))} className="p-1.5 text-xs border rounded-md bg-background">
          {Array.from({ length: 5 }, (_, i) => hoy.getFullYear() - i).map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>

      {/* Pestañas por mes + Todo el año */}
      <div className="flex flex-wrap gap-1 items-center">
        <button
          onClick={() => setMesSel(0)}
          className={cn('px-3 py-2 rounded-lg text-xs font-bold transition-all border mr-2',
            mesSel === 0 ? 'bg-violet-600 text-white border-violet-600 shadow-md'
            : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-100')}
        >
          📅 Todo {anioSel}
        </button>
        <div className="h-8 w-px bg-border mx-1"></div>
        {meses.map((m, i) => {
          const mesNum = i + 1;
          const datosMes = resumen.find((r: any) => r.mes === mesNum);
          const count = datosMes?.count || 0;
          const isActive = mesSel === mesNum;
          const hasData = count > 0;
          return (
            <button key={m} onClick={() => setMesSel(mesNum)}
              className={cn('px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                isActive ? 'bg-violet-600 text-white border-violet-600 shadow-md'
                : hasData ? 'bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800 hover:bg-violet-100'
                : 'bg-muted/30 text-muted-foreground border-transparent hover:bg-muted/50')}
              title={hasData ? `${count} recibo(s) · ${fmt(datosMes.totalNeto)}` : 'Sin recibos'}
            >
              <div className="flex flex-col items-center gap-0.5 min-w-[44px]">
                <span>{m}</span>
                {hasData && <span className={cn('text-[9px] font-bold', isActive ? 'text-white/80' : 'text-violet-500')}>{count}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* KPIs del periodo */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card className="p-3 border-l-4 border-l-violet-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Recibos</div>
          <div className="text-xl font-bold">{data?.count || 0}</div>
        </Card>
        <Card className="p-3 border-l-4 border-l-emerald-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Percepciones</div>
          <div className="text-xl font-bold text-emerald-600">{fmt(data?.totalPercepciones || 0)}</div>
        </Card>
        <Card className="p-3 border-l-4 border-l-red-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Deducciones</div>
          <div className="text-xl font-bold text-red-600">{fmt(data?.totalDeducciones || 0)}</div>
        </Card>
        <Card className="p-3 border-l-4 border-l-blue-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">ISR retenido</div>
          <div className="text-xl font-bold text-blue-600">{fmt(data?.totalISR || 0)}</div>
        </Card>
        <Card className="p-3 border-l-4 border-l-amber-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Neto pagado</div>
          <div className="text-xl font-bold text-amber-600">{fmt(data?.totalNeto || 0)}</div>
        </Card>
      </div>

      {/* Tabla de recibos */}
      {loading ? (
        <div className="text-center py-8">
          {mesSel === 0 ? `Cargando nómina del año ${anioSel}...` : `Cargando nómina de ${meses[mesSel - 1]} ${anioSel}...`}
        </div>
      ) : (data?.recibos?.length || 0) === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Wallet size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">
            {mesSel === 0 ? `No hay recibos de nómina en ${anioSel}` : `No hay recibos en ${meses[mesSel - 1]} ${anioSel}`}
          </p>
          <p className="text-xs mt-1">Sube tus CFDIs de nómina (XML) desde el módulo SAT</p>
        </Card>
      ) : (
        <DataTableCard title={
          mesSel === 0 ? `Nómina — Todo ${anioSel} (${data?.count || 0})` : `Nómina — ${meses[mesSel - 1]} ${anioSel} (${data?.count || 0})`
        }>
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
              <th className="px-4 py-2">Folio</th>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Empleado</th>
              <th className="px-4 py-2">RFC</th>
              <th className="px-4 py-2">Periodo</th>
              <th className="px-4 py-2 text-right">Percepciones</th>
              <th className="px-4 py-2 text-right">ISR</th>
              <th className="px-4 py-2 text-right">IMSS</th>
              <th className="px-4 py-2 text-right">Deducciones</th>
              <th className="px-4 py-2 text-right">Neto</th>
            </tr></thead>
            <tbody>
              {(data?.recibos || []).map((r: any) => (
                <tr key={r.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs">{r.folio}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{new Date(r.fecha).toLocaleDateString('es-MX')}</td>
                  <td className="px-4 py-2 font-medium">{r.empleado?.nombre || '—'}</td>
                  <td className="px-4 py-2 font-mono text-xs">{r.empleado?.rfc || '—'}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{r.periodo || '—'}</td>
                  <td className="px-4 py-2 text-right text-xs text-emerald-600">{fmt(r.totalPercepciones)}</td>
                  <td className="px-4 py-2 text-right text-xs text-blue-600">{fmt(r.isr)}</td>
                  <td className="px-4 py-2 text-right text-xs text-orange-600">{fmt(r.imss)}</td>
                  <td className="px-4 py-2 text-right text-xs text-red-600">{fmt(r.totalDeducciones)}</td>
                  <td className="px-4 py-2 text-right font-bold">{fmt(r.neto)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/30 font-bold">
                <td colSpan={5} className="px-4 py-2 text-right">
                  {mesSel === 0 ? `TOTALES AÑO ${anioSel}:` : `TOTALES ${meses[mesSel - 1]} ${anioSel}:`}
                </td>
                <td className="px-4 py-2 text-right text-emerald-600">{fmt(data?.totalPercepciones || 0)}</td>
                <td className="px-4 py-2 text-right text-blue-600">{fmt(data?.totalISR || 0)}</td>
                <td className="px-4 py-2 text-right text-orange-600">{fmt(data?.totalIMSS || 0)}</td>
                <td className="px-4 py-2 text-right text-red-600">{fmt(data?.totalDeducciones || 0)}</td>
                <td className="px-4 py-2 text-right text-amber-600">{fmt(data?.totalNeto || 0)}</td>
              </tr>
            </tfoot>
          </table>
        </DataTableCard>
      )}
    </div>
  );
}

function ComprasView() {
  const { data, loading } = useApiData<{ ordenes: any[] }>('/api/compras');
  if (loading) return <div className="text-center py-20">Cargando...</div>;
  if (!data?.ordenes?.length) return <EmptyState icon={ShoppingCart} message="Sin órdenes de compra" />;
  return (
    <DataTableCard title={`Órdenes de compra (${data.ordenes.length})`}>
      <table className="w-full text-sm">
        <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
          <th className="px-4 py-2">Folio</th><th className="px-4 py-2">Fecha</th>
          <th className="px-4 py-2">Proveedor</th><th className="px-4 py-2">Concepto</th>
          <th className="px-4 py-2 text-right">Monto</th><th className="px-4 py-2">Estado</th>
        </tr></thead>
        <tbody>
          {data.ordenes.map((o) => (
            <tr key={o.id} className="border-b hover:bg-muted/30">
              <td className="px-4 py-2 font-mono text-xs">{o.folio}</td>
              <td className="px-4 py-2">{new Date(o.fecha).toLocaleDateString('es-MX')}</td>
              <td className="px-4 py-2 font-medium">{o.proveedor.nombre}</td>
              <td className="px-4 py-2 truncate max-w-[200px]">{o.concepto}</td>
              <td className="px-4 py-2 text-right font-semibold">{fmt(o.monto)}</td>
              <td className="px-4 py-2"><Badge variant="default">{o.estado}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableCard>
  );
}

function InventarioView({ empresaId }: { empresaId?: string }) {
  const { data, loading, refresh } = useApiData<{ productos: any[] }>('/api/inventario', empresaId);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ codigo: '', nombre: '', categoria: '', existencia: '0', minimo: '0', precio: '0' });

  const crear = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch('/api/inventario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, empresaId }),
    });
    if (r.ok) {
      setShowForm(false);
      setForm({ codigo: '', nombre: '', categoria: '', existencia: '0', minimo: '0', precio: '0' });
      refresh();
    }
  };

  if (loading) return <div className="text-center py-20">Cargando...</div>;
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm(!showForm)}>
          <Plus size={14} className="mr-2" /> {showForm ? 'Cancelar' : 'Nuevo producto'}
        </Button>
      </div>
      {showForm && (
        <Card className="p-5">
          <form onSubmit={crear} className="grid md:grid-cols-3 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Código *</label>
              <Input value={form.codigo} onChange={e => setForm({ ...form, codigo: e.target.value })} className="mt-1" required />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Nombre *</label>
              <Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} className="mt-1" required />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Categoría</label>
              <Input value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Existencia</label>
              <Input type="number" value={form.existencia} onChange={e => setForm({ ...form, existencia: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Mínimo</label>
              <Input type="number" value={form.minimo} onChange={e => setForm({ ...form, minimo: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Precio</label>
              <Input type="number" step="0.01" value={form.precio} onChange={e => setForm({ ...form, precio: e.target.value })} className="mt-1" />
            </div>
            <div className="md:col-span-3">
              <Button type="submit">Crear producto</Button>
            </div>
          </form>
        </Card>
      )}
      {(data?.productos?.length || 0) === 0 ? (
        <EmptyState icon={Package} message="Sin productos — agrega tu primer producto" />
      ) : (
        <DataTableCard title={`Productos (${data.productos.length})`}>
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
              <th className="px-4 py-2">Código</th><th className="px-4 py-2">Producto</th>
              <th className="px-4 py-2">Categoría</th><th className="px-4 py-2">Existencia</th>
              <th className="px-4 py-2">Mínimo</th><th className="px-4 py-2 text-right">Precio</th>
              <th className="px-4 py-2">Estado</th>
            </tr></thead>
            <tbody>
              {data.productos.map((p) => (
                <tr key={p.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs">{p.codigo}</td>
                  <td className="px-4 py-2 font-medium">{p.nombre}</td>
                  <td className="px-4 py-2 text-muted-foreground">{p.categoria || '—'}</td>
                  <td className="px-4 py-2">{p.existencia}</td>
                  <td className="px-4 py-2 text-muted-foreground">{p.minimo}</td>
                  <td className="px-4 py-2 text-right font-semibold">{fmt(p.precio)}</td>
                  <td className="px-4 py-2">
                    <Badge variant={p.existencia <= p.minimo ? 'destructive' : 'default'}>
                      {p.existencia <= p.minimo ? 'Bajo' : 'Stock'}
                    </Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableCard>
      )}
    </div>
  );
}

function BancosView({ empresaId }: { empresaId?: string }) {
  const { data, loading, refresh } = useApiData<{ cuentas: any[]; movimientos: any[] }>('/api/bancos', empresaId);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [showCuentaForm, setShowCuentaForm] = useState(false);
  const [cuentaForm, setCuentaForm] = useState({ banco: '', cuenta: '', saldo: '0', tipo: 'operaciones' });

  const crearCuenta = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch('/api/bancos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...cuentaForm, empresaId }),
    });
    if (r.ok) {
      setShowCuentaForm(false);
      setCuentaForm({ banco: '', cuenta: '', saldo: '0', tipo: 'operaciones' });
      refresh();
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !data?.cuentas?.length) return;
    setUploading(true);
    setUploadMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('cuentaId', data.cuentas[0].id);
      const hoy = new Date();
      formData.append('mes', String(hoy.getMonth() + 1));
      formData.append('anio', String(hoy.getFullYear()));
      const r = await fetch('/api/upload-estado-cuenta', { method: 'POST', body: formData });
      const d = await r.json();
      if (d.success) {
        setUploadMsg(`✅ ${d.message} (${d.movimientosCreados} movimientos nuevos)`);
        refresh();
      } else {
        setUploadMsg(`❌ ${d.error || 'Error al subir archivo'}`);
      }
    } catch (e: any) {
      setUploadMsg(`❌ ${e.message}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (loading) return <div className="text-center py-20">Cargando...</div>;

  return (
    <div className="space-y-4">
      {/* Botón crear cuenta */}
      <div className="flex justify-end">
        <Button onClick={() => setShowCuentaForm(!showCuentaForm)}>
          <Plus size={14} className="mr-2" /> {showCuentaForm ? 'Cancelar' : 'Nueva cuenta bancaria'}
        </Button>
      </div>

      {/* Formulario nueva cuenta */}
      {showCuentaForm && (
        <Card className="p-5">
          <form onSubmit={crearCuenta} className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Banco *</label>
              <Input value={cuentaForm.banco} onChange={e => setCuentaForm({ ...cuentaForm, banco: e.target.value })} placeholder="Banorte" className="mt-1" required />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Cuenta *</label>
              <Input value={cuentaForm.cuenta} onChange={e => setCuentaForm({ ...cuentaForm, cuenta: e.target.value })} placeholder="****4521" className="mt-1" required />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Saldo inicial</label>
              <Input type="number" step="0.01" value={cuentaForm.saldo} onChange={e => setCuentaForm({ ...cuentaForm, saldo: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-muted-foreground">Tipo</label>
              <select value={cuentaForm.tipo} onChange={e => setCuentaForm({ ...cuentaForm, tipo: e.target.value })} className="w-full mt-1 p-2 border rounded-md bg-background text-sm">
                <option value="operaciones">Operaciones</option>
                <option value="ahorro">Ahorro</option>
                <option value="inversion">Inversión</option>
              </select>
            </div>
            <div className="md:col-span-2"><Button type="submit">Crear cuenta</Button></div>
          </form>
        </Card>
      )}

      {/* Cuentas */}
      {(data?.cuentas?.length || 0) > 0 && (
        <div className="grid md:grid-cols-2 gap-3">
          {data.cuentas.map((c) => (
            <Card key={c.id} className="p-5 border-l-4 border-l-emerald-500">
              <div className="text-xs uppercase font-semibold text-muted-foreground">{c.banco} {c.cuenta}</div>
              <div className="text-2xl font-bold text-emerald-600 mt-1">{fmt(c.saldo)}</div>
              <div className="text-xs text-muted-foreground mt-1">{c._count?.movimientos || 0} movimientos · {c.tipo}</div>
            </Card>
          ))}
        </div>
      )}

      {/* Upload estado de cuenta */}
      <Card className="p-5">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Upload size={16} className="text-violet-600" /> Cargar estado de cuenta (PDF/CSV)
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Sube el estado de cuenta de tu banco. Si es CSV, se importan los movimientos automáticamente.
        </p>
        <label className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:border-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors">
          <Upload size={28} className="text-muted-foreground mb-2" />
          <span className="text-sm font-medium">{uploading ? 'Procesando...' : 'Haz clic o arrastra tu archivo aquí'}</span>
          <span className="text-xs text-muted-foreground mt-1">Formatos: CSV (auto-importa), PDF (guarda)</span>
          <input type="file" accept=".csv,.pdf,.xlsx" onChange={handleUpload} disabled={uploading || !data?.cuentas?.length} className="hidden" />
        </label>
        {!data?.cuentas?.length && <p className="text-xs text-amber-600 mt-2">⚠️ Primero crea una cuenta bancaria para poder subir estados de cuenta</p>}
        {uploadMsg && <div className={cn('mt-3 p-2 rounded text-sm', uploadMsg.startsWith('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>{uploadMsg}</div>}
      </Card>

      {/* Movimientos */}
      {(data?.movimientos?.length || 0) > 0 && (
        <DataTableCard title="Movimientos recientes">
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
              <th className="px-4 py-2">Fecha</th><th className="px-4 py-2">Cuenta</th>
              <th className="px-4 py-2">Concepto</th><th className="px-4 py-2 text-right">Monto</th>
              <th className="px-4 py-2">Tipo</th>
            </tr></thead>
            <tbody>
              {(data?.movimientos || []).map((m) => (
                <tr key={m.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-2">{new Date(m.fecha).toLocaleDateString('es-MX')}</td>
                  <td className="px-4 py-2">{m.cuenta?.banco}</td>
                  <td className="px-4 py-2">{m.concepto}</td>
                  <td className={cn('px-4 py-2 text-right font-semibold', m.monto >= 0 ? 'text-emerald-600' : 'text-red-600')}>{m.monto >= 0 ? '+' : ''}{fmt(m.monto)}</td>
                  <td className="px-4 py-2"><Badge variant="secondary">{m.tipo}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableCard>
      )}
      {(data?.cuentas?.length || 0) === 0 && (data?.movimientos?.length || 0) === 0 && (
        <EmptyState icon={Banknote} message="Sin cuentas bancarias — crea tu primera cuenta" />
      )}
    </div>
  );
}

function ContabilidadView() {
  const { data, loading } = useApiData<{ polizas: any[] }>('/api/polizas');
  if (loading) return <div className="text-center py-20">Cargando...</div>;
  if (!data?.polizas?.length) return <EmptyState icon={BookOpen} message="Sin pólizas" />;
  return (
    <DataTableCard title={`Pólizas (${data.polizas.length})`}>
      <table className="w-full text-sm">
        <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
          <th className="px-4 py-2">Folio</th><th className="px-4 py-2">Fecha</th>
          <th className="px-4 py-2">Tipo</th><th className="px-4 py-2">Concepto</th>
          <th className="px-4 py-2 text-right">Cargo</th><th className="px-4 py-2">Estado</th>
        </tr></thead>
        <tbody>
          {data.polizas.map((p) => (
            <tr key={p.id} className="border-b hover:bg-muted/30">
              <td className="px-4 py-2 font-mono text-xs">{p.folio}</td>
              <td className="px-4 py-2">{new Date(p.fecha).toLocaleDateString('es-MX')}</td>
              <td className="px-4 py-2"><Badge variant="secondary">{p.tipo}</Badge></td>
              <td className="px-4 py-2 truncate max-w-[200px]">{p.concepto}</td>
              <td className="px-4 py-2 text-right font-semibold">{fmt(p.cargo)}</td>
              <td className="px-4 py-2">
                <Badge variant={p.estado === 'conciliada' ? 'default' : 'secondary'}>{p.estado}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableCard>
  );
}

function SatView() {
  const [tab, setTab] = useState<'recibidas' | 'emitidas'>('recibidas');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const { data, loading, refresh } = useApiData<{ facturas: any[] }>(`/api/facturas?direccion=${tab === 'recibidas' ? 'recibida' : 'emitida'}&limit=20`);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setUploadMsg('');
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) {
        formData.append('files', files[i]);
      }
      formData.append('direccion', tab === 'recibidas' ? 'recibida' : 'emitida');

      const r = await fetch('/api/upload-cfdi', {
        method: 'POST',
        body: formData,
      });
      const d = await r.json();
      if (d.success) {
        setUploadMsg(`✅ ${d.message}`);
        setResultados(d.detalles || []);
        refresh();
      } else {
        setUploadMsg(`❌ ${d.error || 'Error al subir'}`);
      }
    } catch (e: any) {
      setUploadMsg(`❌ ${e.message}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button
          onClick={() => setTab('recibidas')}
          className={cn('px-4 py-2 font-medium text-sm border-b-2 transition-colors',
            tab === 'recibidas' ? 'border-violet-600 text-violet-600' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          📥 CFDIs Recibidos
        </button>
        <button
          onClick={() => setTab('emitidas')}
          className={cn('px-4 py-2 font-medium text-sm border-b-2 transition-colors',
            tab === 'emitidas' ? 'border-violet-600 text-violet-600' : 'border-transparent text-muted-foreground hover:text-foreground')}
        >
          📤 CFDIs Emitidos
        </button>
      </div>

      {/* Botón eliminar mes */}
      {mesSel !== 0 && (data?.count || 0) > 0 && (
        <div className="flex justify-end">
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (!confirm(`¿Eliminar TODAS las facturas ${tab} de ${meses[mesSel - 1]} ${anioSel}?\n\nSe eliminarán ${data?.count || 0} factura(s). Esta acción no se puede deshacer.`)) return;
              const r = await fetch(`/api/facturas/eliminar-mes?mes=${mesSel}&anio=${anioSel}&direccion=${dirParam}${empresaId ? `&empresaId=${empresaId}` : ''}`, { method: 'DELETE' });
              const d = await r.json();
              if (d.success) { alert(d.message); refresh(); }
              else alert(`Error: ${d.error}`);
            }}
          >
            <Trash2 size={14} className="mr-2" /> Eliminar {meses[mesSel - 1]} {anioSel}
          </Button>
        </div>
      )}

      {/* Upload zone */}
      <Card className="p-5">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Upload size={16} className="text-violet-600" /> Cargar CFDIs ({tab === 'recibidas' ? 'Recibidos' : 'Emitidos'})
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Sube tus archivos XML (y sus PDFs opcionales) del SAT. También puedes subir un ZIP con múltiples XML.
          El sistema parsea automáticamente y guarda las facturas en la base de datos.
        </p>
        <label className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer hover:border-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors">
          <Upload size={32} className="text-muted-foreground mb-2" />
          <span className="text-sm font-medium">
            {uploading ? 'Procesando...' : 'Haz clic o arrastra tus archivos XML/PDF/ZIP aquí'}
          </span>
          <span className="text-xs text-muted-foreground mt-1">Formatos: .xml (parsea), .pdf (guarda), .zip (descomprime)</span>
          <input type="file" accept=".xml,.pdf,.zip" multiple onChange={handleUpload} disabled={uploading} className="hidden" />
        </label>
        {uploadMsg && (
          <div className={cn('mt-3 p-3 rounded text-sm', uploadMsg.startsWith('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>
            {uploadMsg}
          </div>
        )}
        {resultados.length > 0 && (
          <div className="mt-3 max-h-40 overflow-y-auto border rounded">
            {resultados.map((r, i) => (
              <div key={i} className={cn('text-xs px-3 py-1.5 border-b', r.estado === 'error' ? 'bg-red-50' : r.estado === 'duplicado' ? 'bg-yellow-50' : 'bg-emerald-50')}>
                <strong>{r.archivo}</strong>: {r.mensaje}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Facturas cargadas */}
      {loading ? (
        <div className="text-center py-8">Cargando facturas...</div>
      ) : (
        <DataTableCard title={`Facturas ${tab} (${data?.facturas?.length || 0})`}>
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
              <th className="px-4 py-2">Folio</th><th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">{tab === 'recibidas' ? 'Proveedor' : 'Cliente'}</th>
              <th className="px-4 py-2">RFC</th>
              <th className="px-4 py-2 text-right">Total</th>
              <th className="px-4 py-2">UUID</th>
            </tr></thead>
            <tbody>
              {(data?.facturas || []).map((f: any) => (
                <tr key={f.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs">{f.folio}</td>
                  <td className="px-4 py-2">{new Date(f.fecha).toLocaleDateString('es-MX')}</td>
                  <td className="px-4 py-2 font-medium">{tab === 'recibidas' ? f.emisorNombre : f.receptorNombre}</td>
                  <td className="px-4 py-2 font-mono text-xs">{tab === 'recibidas' ? f.emisorRfc : f.receptorRfc}</td>
                  <td className="px-4 py-2 text-right font-semibold">{fmt(f.total)}</td>
                  <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground">{f.uuid?.slice(0, 16)}...</td>
                </tr>
              ))}
            </tbody>
          </table>
        </DataTableCard>
      )}
    </div>
  );
}

function IaFiscalView() {
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 gap-3">
        {[
          { t: 'Simulador ISR', d: 'Calcula ISR mensual/anual', icon: Calculator },
          { t: 'Simulador IVA', d: 'Proyecta IVA acreditable', icon: FileText },
          { t: 'Simulador PTU', d: 'Participación de utilidades', icon: DollarSign },
        ].map((m) => {
          const Icon = m.icon;
          return (
            <Card key={m.t} className="p-5 border-l-4 border-l-violet-500">
              <Icon size={24} className="text-violet-600 mb-2" />
              <h3 className="font-semibold">{m.t}</h3>
              <p className="text-xs text-muted-foreground mt-1">{m.d}</p>
            </Card>
          );
        })}
      </div>
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Bot size={16} className="text-violet-600" /> Chat con IA Fiscal
        </h3>
        <div className="bg-muted/30 p-3 rounded-lg mb-3 text-sm">
          <strong>IA:</strong> Hola, soy tu asistente fiscal. ¿En qué puedo ayudarte?
        </div>
        <div className="flex gap-2">
          <Input placeholder="Escribe tu pregunta fiscal..." />
          <Button>Enviar</Button>
        </div>
      </Card>
    </div>
  );
}

function TributarioView() {
  const obligaciones = [
    { o: 'IVA mensual', p: 'Julio 2026', v: '17/08/2026', m: 36497, e: 'pendiente' },
    { o: 'ISR mensual', p: 'Julio 2026', v: '17/08/2026', m: 40800, e: 'pendiente' },
    { o: 'IVA mensual', p: 'Junio 2026', v: '17/07/2026', m: 8200, e: 'pagado' },
    { o: 'ISR mensual', p: 'Junio 2026', v: '17/07/2026', m: 32100, e: 'pagado' },
    { o: 'DIOT', p: 'Julio 2026', v: '31/07/2026', m: 0, e: 'urgente' },
  ];
  return (
    <DataTableCard title="Calendario tributario">
      <table className="w-full text-sm">
        <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
          <th className="px-4 py-2">Obligación</th><th className="px-4 py-2">Periodo</th>
          <th className="px-4 py-2">Vencimiento</th><th className="px-4 py-2 text-right">Monto</th>
          <th className="px-4 py-2">Estado</th>
        </tr></thead>
        <tbody>
          {obligaciones.map((o, i) => (
            <tr key={i} className="border-b hover:bg-muted/30">
              <td className="px-4 py-2 font-medium">{o.o}</td>
              <td className="px-4 py-2">{o.p}</td>
              <td className="px-4 py-2">{o.v}</td>
              <td className="px-4 py-2 text-right font-semibold">{o.m > 0 ? fmt(o.m) : '—'}</td>
              <td className="px-4 py-2">
                <Badge variant={o.e === 'pagado' ? 'default' : o.e === 'urgente' ? 'destructive' : 'secondary'}>
                  {o.e}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableCard>
  );
}

function FinanzasView({ stats }: { stats: Stats | null }) {
  if (!stats) return <div className="text-center py-20">Cargando...</div>;
  const kpis = [
    { l: 'Patrimonio neto', v: '−$1,164,000', c: 'text-red-600' },
    { l: 'Activo total', v: fmt(1836000), c: 'text-emerald-600' },
    { l: 'Pasivo total', v: fmt(3000000), c: 'text-red-600' },
    { l: 'Tasa de ahorro', v: '8.5%', c: 'text-amber-600' },
    { l: 'Ratio endeudamiento', v: '89.7%', c: 'text-red-600' },
    { l: 'Fondo emergencia', v: '32.5%', c: 'text-amber-600' },
    { l: 'IVA por pagar', v: fmt(stats.fiscal.ivaPorPagar), c: 'text-orange-600' },
    { l: 'Utilidad bruta', v: fmt(stats.fiscal.utilidadBruta), c: 'text-emerald-600' },
  ];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => (
          <Card key={k.l} className="p-4">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">{k.l}</div>
            <div className={cn('text-xl font-bold mt-1', k.c)}>{k.v}</div>
          </Card>
        ))}
      </div>
      <Card className="p-5 border-l-4 border-l-red-500 bg-red-50/50">
        <h3 className="font-semibold flex items-center gap-2 mb-2">
          🎯 Avalancha de deudas
        </h3>
        <p className="text-sm text-muted-foreground">
          Configura tus deudas en el panel de finanzas para activar la estrategia de pago optimizada.
        </p>
      </Card>
    </div>
  );
}

function CrmView() {
  const { data, loading } = useApiData<{ oportunidades: any[] }>('/api/crm');
  if (loading) return <div className="text-center py-20">Cargando...</div>;
  if (!data?.oportunidades?.length) return <EmptyState icon={TrendingUp} message="Sin oportunidades" />;
  return (
    <DataTableCard title={`Oportunidades (${data.oportunidades.length})`}>
      <table className="w-full text-sm">
        <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
          <th className="px-4 py-2">Oportunidad</th><th className="px-4 py-2">Cliente</th>
          <th className="px-4 py-2">Etapa</th><th className="px-4 py-2 text-right">Monto</th>
          <th className="px-4 py-2">Probabilidad</th>
        </tr></thead>
        <tbody>
          {data.oportunidades.map((o) => (
            <tr key={o.id} className="border-b hover:bg-muted/30">
              <td className="px-4 py-2 font-medium">{o.nombre}</td>
              <td className="px-4 py-2">{o.cliente?.nombre || '—'}</td>
              <td className="px-4 py-2"><Badge variant="secondary">{o.etapa}</Badge></td>
              <td className="px-4 py-2 text-right font-semibold">{fmt(o.monto)}</td>
              <td className="px-4 py-2">{o.probabilidad}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DataTableCard>
  );
}

function ReportesView({ stats }: { stats: Stats | null }) {
  if (!stats) return <div className="text-center py-20">Cargando...</div>;
  const meses = [
    { m: 'Febrero', i: 265000, e: 245000 },
    { m: 'Marzo', i: 298000, e: 267000 },
    { m: 'Abril', i: 278000, e: 259000 },
    { m: 'Mayo', i: 310000, e: 278000 },
    { m: 'Junio', i: 305000, e: 285000 },
    { m: 'Julio', i: stats.fiscal.totalEmitido, e: stats.fiscal.totalRecibido },
  ];
  const maxVal = Math.max(...meses.map(m => Math.max(m.i, m.e)));
  return (
    <div className="space-y-4">
      <Card className="p-5">
        <h3 className="font-semibold mb-3">📊 Ingresos vs Egresos (6 meses)</h3>
        <div className="flex items-end gap-3 h-48 border-b">
          {meses.map((m) => (
            <div key={m.m} className="flex-1 flex flex-col items-center gap-1 justify-end h-full">
              <div className="w-full flex justify-center gap-1 h-full items-end">
                <div className="bg-emerald-500 rounded-t" style={{ width: '40%', height: `${(m.i / maxVal) * 100}%` }} />
                <div className="bg-orange-500 rounded-t" style={{ width: '40%', height: `${(m.e / maxVal) * 100}%` }} />
              </div>
              <span className="text-[10px] text-muted-foreground">{m.m}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-emerald-500 rounded"></span> Ingresos</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 bg-orange-500 rounded"></span> Egresos</span>
        </div>
      </Card>

      {/* Exportar a Excel */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <FileSpreadsheet size={18} className="text-emerald-600" /> Exportar a Excel
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Genera archivos Excel con el concentrado de facturas o nómina del mes seleccionado.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <FileText size={16} className="text-violet-600" /> Concentrado de Facturas
            </h4>
            <p className="text-xs text-muted-foreground mb-3">
              Hojas: Emitidas, Recibidas, Resumen IVA. Incluye folio, UUID, cliente/proveedor, montos.
            </p>
            <Button
              onClick={() => {
                const hoy = new Date();
                window.open(`/api/export/facturas?mes=${hoy.getMonth() + 1}&anio=${hoy.getFullYear()}`, '_blank');
              }}
            >
              <FileSpreadsheet size={14} className="mr-2" /> Descargar Excel Facturas
            </Button>
          </div>

          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <Wallet size={16} className="text-amber-600" /> Concentrado de Nómina
            </h4>
            <p className="text-xs text-muted-foreground mb-3">
              Hojas: Nómina Detallada, Resumen. Incluye empleado, RFC, percepciones, ISR, IMSS, neto.
            </p>
            <Button
              variant="secondary"
              onClick={() => {
                const hoy = new Date();
                window.open(`/api/export/nomina?mes=${hoy.getMonth() + 1}&anio=${hoy.getFullYear()}`, '_blank');
              }}
            >
              <FileSpreadsheet size={14} className="mr-2" /> Descargar Excel Nómina
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ====================== AUDITORÍA FISCAL VIEW (RAG con leyes) ======================
function AuditoriaFiscalView() {
  const [pregunta, setPregunta] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [respuesta, setRespuesta] = useState('');
  const [leyesDetectadas, setLeyesDetectadas] = useState<string[]>([]);
  const [articulosCargados, setArticulosCargados] = useState(0);
  const [historial, setHistorial] = useState<Array<{ pregunta: string; respuesta: string; leyes: string[]; articulos: number }>>([]);
  const [stats, setStats] = useState<any>(null);

  useEffect(() => {
    fetch('/api/auditoria-fiscal').then(r => r.json()).then(setStats).catch(() => {});
  }, []);

  const consultar = async () => {
    if (!pregunta.trim() || procesando) return;
    setProcesando(true);
    setRespuesta('');
    setLeyesDetectadas([]);
    setArticulosCargados(0);

    try {
      const res = await fetch('/api/auditoria-fiscal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pregunta }),
      });

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acum = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'leyes_detectadas') setLeyesDetectadas(evt.leyes);
            else if (evt.type === 'articulos_cargados') setArticulosCargados(evt.count);
            else if (evt.type === 'token') {
              acum += evt.content;
              setRespuesta(acum);
            } else if (evt.type === 'done') {
              setRespuesta(evt.full);
              setHistorial(h => [{ pregunta, respuesta: evt.full, leyes: evt.leyes, articulos: evt.articulos }, ...h]);
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setRespuesta(`❌ Error: ${e.message}`);
    } finally {
      setProcesando(false);
      setPregunta('');
    }
  };

  const ejemplos = [
    '¿Qué dice el artículo 27 de la LISR sobre quién está obligado a pagar ISR?',
    '¿Cuáles son las deducciones autorizadas para personas físicas?',
    '¿Qué tasa de IVA aplica y cuándo se puede acreditar?',
    '¿Qué obligaciones tiene el patrón respecto al IMSS?',
    '¿Cómo se calcula el aguinaldo según la LFT?',
    '¿Qué es el crédito INFONAVIT y cómo se obtiene?',
    '¿Qué sanciones impone el Código Fiscal por no emitir CFDI?',
  ];

  return (
    <div className="space-y-4">
      {/* Stats del knowledge base */}
      {stats && (
        <Card className="p-4 bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <h3 className="font-bold flex items-center gap-2">
                <Scale size={18} /> Knowledge Base Legal Cargado
              </h3>
              <p className="text-sm text-white/80 mt-1">
                {stats.totalLeyes} leyes · {stats.totalArticulos.toLocaleString('es-MX')} artículos · {(stats.totalCaracteres / 1000000).toFixed(1)}M caracteres
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {stats.leyes?.map((l: any) => (
                <span key={l.abreviatura} className="bg-white/20 px-2 py-1 rounded text-xs">
                  {l.abreviatura} ({l.articulos})
                </span>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Consulta */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Scale size={18} className="text-violet-600" /> Consulta las leyes fiscales
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Abbax consultará las leyes mexicanas (LISR, LIVA, CFF, LFT, LSS, LINFONAVIT, LFPDPPP) y responderá citando artículos específicos.
        </p>
        <div className="flex gap-2">
          <Input
            value={pregunta}
            onChange={e => setPregunta(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); consultar(); } }}
            placeholder="Ej: ¿Qué dice el artículo 27 de la LISR?"
            disabled={procesando}
            className="flex-1"
          />
          <Button onClick={consultar} disabled={!pregunta.trim() || procesando}>
            {procesando ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </Button>
        </div>

        {/* Ejemplos */}
        {!procesando && !respuesta && (
          <div className="mt-3 flex flex-wrap gap-2">
            {ejemplos.map((e, i) => (
              <button
                key={i}
                onClick={() => setPregunta(e)}
                className="text-xs px-3 py-1.5 rounded-full bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 hover:bg-violet-100 dark:hover:bg-violet-900/40 transition"
              >
                {e}
              </button>
            ))}
          </div>
        )}

        {/* Estado de carga */}
        {procesando && (
          <div className="mt-3 flex items-center gap-3 text-sm">
            <Loader2 size={14} className="animate-spin text-violet-600" />
            {leyesDetectadas.length > 0 && (
              <span className="text-violet-600">
                ⚖️ Consultando: {leyesDetectadas.join(', ')} · {articulosCargados} artículos cargados
              </span>
            )}
          </div>
        )}

        {/* Respuesta */}
        {respuesta && (
          <div className="mt-4">
            {leyesDetectadas.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {leyesDetectadas.map(l => (
                  <Badge key={l} variant="secondary" className="text-xs">{l}</Badge>
                ))}
                <Badge variant="outline" className="text-xs">{articulosCargados} artículos consultados</Badge>
              </div>
            )}
            <div className="bg-muted/50 rounded-lg p-4 text-sm whitespace-pre-wrap">{respuesta}</div>
          </div>
        )}
      </Card>

      {/* Historial */}
      {historial.length > 0 && (
        <Card className="p-4">
          <h4 className="font-semibold text-sm mb-2">Consultas anteriores</h4>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {historial.map((h, i) => (
              <details key={i} className="border rounded-lg p-2">
                <summary className="cursor-pointer text-sm font-medium">
                  ❓ {h.pregunta}
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({h.leyes.join(', ')}, {h.articulos} arts.)
                  </span>
                </summary>
                <div className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground">{h.respuesta.slice(0, 500)}...</div>
              </details>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

// ====================== DIOT VIEW ======================
function DiotView() {
  const [periodo, setPeriodo] = useState({ mes: new Date().getMonth() + 1, anio: new Date().getFullYear() });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/diot?mes=${periodo.mes}&anio=${periodo.anio}`);
      const d = await r.json();
      setData(d);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, [periodo]);

  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="font-semibold flex items-center gap-2">
            <FileText size={18} className="text-violet-600" /> DIOT — Declaración Informativa de Operaciones con Terceros
          </h3>
          <div className="flex gap-2">
            <select
              value={periodo.mes}
              onChange={e => setPeriodo({ ...periodo, mes: parseInt(e.target.value) })}
              className="p-2 border rounded-md bg-background text-sm"
            >
              {meses.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
            <input
              type="number"
              value={periodo.anio}
              onChange={e => setPeriodo({ ...periodo, anio: parseInt(e.target.value) })}
              className="p-2 border rounded-md bg-background text-sm w-24"
            />
            <Button
              variant="secondary"
              onClick={() => window.open(`/api/diot?mes=${periodo.mes}&anio=${periodo.anio}&formato=excel`, '_blank')}
            >
              <FileSpreadsheet size={14} className="mr-2" /> Descargar Excel
            </Button>
          </div>
        </div>

        <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg text-sm mb-4">
          <strong>📋 ¿Qué es el DIOT?</strong> Es la declaración mensual al SAT donde reportas a tus proveedores
          y el IVA acreditable. Vence los primeros 10 días del mes siguiente.
        </div>

        {loading ? (
          <div className="text-center py-8">Generando DIOT...</div>
        ) : data ? (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <Card className="p-3">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">Proveedores</div>
                <div className="text-xl font-bold">{data.totalProveedores}</div>
              </Card>
              <Card className="p-3">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">Base grabable</div>
                <div className="text-xl font-bold text-violet-600">{fmt(data.totalBaseGrabable)}</div>
              </Card>
              <Card className="p-3">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">IVA acreditable</div>
                <div className="text-xl font-bold text-emerald-600">{fmt(data.totalIVAAcreditable)}</div>
              </Card>
            </div>

            <DataTableCard title={`Proveedores del periodo (${data.proveedores.length})`}>
              <table className="w-full text-sm">
                <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
                  <th className="px-4 py-2">RFC</th><th className="px-4 py-2">Nombre</th>
                  <th className="px-4 py-2">Tipo tercero</th><th className="px-4 py-2 text-right">Base</th>
                  <th className="px-4 py-2 text-right">IVA</th><th className="px-4 py-2">Facturas</th>
                </tr></thead>
                <tbody>
                  {data.proveedores.map((p: any, i: number) => (
                    <tr key={i} className="border-b hover:bg-muted/30">
                      <td className="px-4 py-2 font-mono text-xs">{p.rfc}</td>
                      <td className="px-4 py-2 font-medium">{p.nombre}</td>
                      <td className="px-4 py-2">15 (Proveedor)</td>
                      <td className="px-4 py-2 text-right">{fmt(p.baseGrabable)}</td>
                      <td className="px-4 py-2 text-right text-emerald-600">{fmt(p.ivaAcreditable)}</td>
                      <td className="px-4 py-2"><Badge variant="secondary">{p.facturas}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </DataTableCard>
          </>
        ) : null}
      </Card>
    </div>
  );
}

// ====================== INEGI VIEW ======================
function InegiView() {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/inegi?anio=${anio}`);
      const d = await r.json();
      setData(d);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, [anio]);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="font-semibold flex items-center gap-2">
            <BarChart3 size={18} className="text-violet-600" /> Reporte INEGI — Estadística Empresarial
          </h3>
          <div className="flex gap-2">
            <input
              type="number"
              value={anio}
              onChange={e => setAnio(parseInt(e.target.value))}
              className="p-2 border rounded-md bg-background text-sm w-24"
            />
            <Button
              variant="secondary"
              onClick={() => window.open(`/api/inegi?anio=${anio}&formato=excel`, '_blank')}
            >
              <FileSpreadsheet size={14} className="mr-2" /> Descargar Excel
            </Button>
          </div>
        </div>

        <div className="bg-emerald-50 dark:bg-emerald-900/20 p-3 rounded-lg text-sm mb-4">
          <strong>📊 ¿Qué es el reporte INEGI?</strong> El INEGI solicita información estadística anual
          sobre personal ocupado, remuneraciones, ingresos, gastos y activos. Se presenta en plataformas
          específicas según la encuesta aplicable.
        </div>

        {loading ? (
          <div className="text-center py-8">Generando reporte...</div>
        ) : data ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <Card className="p-3 border-l-4 border-l-violet-500">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">Personal ocupado</div>
                <div className="text-xl font-bold">{data.personal.personalOcupadoTotal}</div>
              </Card>
              <Card className="p-3 border-l-4 border-l-blue-500">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">Remuneraciones</div>
                <div className="text-xl font-bold text-blue-600">{fmt(data.personal.remuneracionesTotales)}</div>
              </Card>
              <Card className="p-3 border-l-4 border-l-emerald-500">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">Ingresos</div>
                <div className="text-xl font-bold text-emerald-600">{fmt(data.ingresos.ingresosTotales)}</div>
              </Card>
              <Card className="p-3 border-l-4 border-l-red-500">
                <div className="text-[10px] uppercase font-semibold text-muted-foreground">Gastos</div>
                <div className="text-xl font-bold text-red-600">{fmt(data.gastos.gastosTotales)}</div>
              </Card>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <Card className="p-4">
                <h4 className="font-semibold text-sm mb-2">Ingresos por tipo</h4>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between"><span>Venta de bienes:</span><strong>{fmt(data.ingresos.ventasBienes)}</strong></div>
                  <div className="flex justify-between"><span>Servicios:</span><strong>{fmt(data.ingresos.servicios)}</strong></div>
                  <div className="flex justify-between"><span>IVA trasladado:</span><strong>{fmt(data.ingresos.ivaTrasladado)}</strong></div>
                </div>
              </Card>
              <Card className="p-4">
                <h4 className="font-semibold text-sm mb-2">Gastos por tipo</h4>
                <div className="text-xs space-y-1">
                  <div className="flex justify-between"><span>Materias primas:</span><strong>{fmt(data.gastos.comprasMateriasPrimas)}</strong></div>
                  <div className="flex justify-between"><span>Operación:</span><strong>{fmt(data.gastos.gastosOperacion)}</strong></div>
                  <div className="flex justify-between"><span>IVA acreditable:</span><strong>{fmt(data.gastos.ivaAcreditable)}</strong></div>
                </div>
              </Card>
            </div>

            <Card className="p-4 mt-3">
              <h4 className="font-semibold text-sm mb-2">Existencias y activos fijos</h4>
              <div className="text-xs space-y-1">
                <div className="flex justify-between"><span>Total inventario:</span><strong>{fmt(data.existencias.totalInventario)}</strong></div>
                <div className="flex justify-between"><span>Total activos fijos:</span><strong>{fmt(data.activosFijos.totalActivosFijos)}</strong></div>
                <div className="flex justify-between border-t mt-1 pt-1">
                  <span className="font-semibold">Utilidad operativa:</span>
                  <strong className={data.resumen.utilidadOperativa >= 0 ? 'text-emerald-600' : 'text-red-600'}>
                    {fmt(data.resumen.utilidadOperativa)}
                  </strong>
                </div>
              </div>
            </Card>
          </>
        ) : null}
      </Card>
    </div>
  );
}

// ====================== BALANCE GENERAL VIEW ======================
function BalanceView() {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/balance?anio=${anio}`);
      const d = await r.json();
      setData(d);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, [anio]);

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
          <h3 className="font-semibold flex items-center gap-2">
            <BookOpen size={18} className="text-violet-600" /> Balance General — Estado de Situación Financiera
          </h3>
          <div className="flex gap-2">
            <input
              type="number"
              value={anio}
              onChange={e => setAnio(parseInt(e.target.value))}
              className="p-2 border rounded-md bg-background text-sm w-24"
            />
            <Button
              variant="secondary"
              onClick={() => window.open(`/api/balance?anio=${anio}&formato=excel`, '_blank')}
            >
              <FileSpreadsheet size={14} className="mr-2" /> Descargar Excel
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8">Generando balance...</div>
        ) : data ? (
          <div className="grid md:grid-cols-2 gap-4">
            {/* ACTIVOS */}
            <Card className="p-4 border-l-4 border-l-emerald-500">
              <h4 className="font-bold text-emerald-600 mb-3">ACTIVOS — Total: {fmt(data.activos.total)}</h4>
              <div className="space-y-2 text-sm">
                <div className="font-semibold text-xs uppercase text-muted-foreground">Circulante ({fmt(data.activos.circulante.total)})</div>
                <div className="flex justify-between pl-3"><span>Efectivo y bancos:</span><strong>{fmt(data.activos.circulante.efectivoBancos)}</strong></div>
                <div className="flex justify-between pl-3"><span>Cuentas por cobrar:</span><strong>{fmt(data.activos.circulante.cuentasPorCobrar)}</strong></div>
                <div className="flex justify-between pl-3"><span>IVA acreditable:</span><strong>{fmt(data.activos.circulante.ivaAcreditable)}</strong></div>
                <div className="font-semibold text-xs uppercase text-muted-foreground mt-2">Fijo ({fmt(data.activos.fijo.total)})</div>
                <div className="flex justify-between pl-3"><span>Inventario:</span><strong>{fmt(data.activos.fijo.inventario)}</strong></div>
              </div>
            </Card>

            {/* PASIVOS + CAPITAL */}
            <div className="space-y-3">
              <Card className="p-4 border-l-4 border-l-red-500">
                <h4 className="font-bold text-red-600 mb-3">PASIVOS — Total: {fmt(data.pasivos.total)}</h4>
                <div className="space-y-2 text-sm">
                  <div className="font-semibold text-xs uppercase text-muted-foreground">Circulante ({fmt(data.pasivos.circulante.total)})</div>
                  <div className="flex justify-between pl-3"><span>IVA por pagar:</span><strong>{fmt(data.pasivos.circulante.ivaPorPagar)}</strong></div>
                  <div className="flex justify-between pl-3"><span>Cuentas por pagar:</span><strong>{fmt(data.pasivos.circulante.cuentasPorPagar)}</strong></div>
                </div>
              </Card>

              <Card className="p-4 border-l-4 border-l-violet-500">
                <h4 className="font-bold text-violet-600 mb-3">CAPITAL — Total: {fmt(data.capital.total)}</h4>
                <div className="text-sm">
                  <div className="flex justify-between"><span>Capital contable:</span><strong>{fmt(data.capital.capitalContable)}</strong></div>
                </div>
              </Card>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}

// ====================== EMPRESAS VIEW (con alta + constancia fiscal) ======================
function EmpresasView() {
  const { data, loading, refresh } = useApiData<{ empresas: any[] }>('/api/empresas');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nombre: '', rfc: '', regimenFiscal: '', email: '', telefono: '', direccion: '' });
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [procesandoConstancia, setProcesandoConstancia] = useState(false);
  const [datosConstancia, setDatosConstancia] = useState<any>(null);
  const [msgConstancia, setMsgConstancia] = useState('');

  const handleUploadConstancia = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setProcesandoConstancia(true);
    setError('');
    setMsgConstancia('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('crearEmpresa', 'false'); // Solo extraer datos, el usuario confirma

      const r = await fetch('/api/upload-constancia-fiscal', {
        method: 'POST',
        body: formData,
      });
      const d = await r.json();

      if (d.success) {
        setDatosConstancia(d.datos);
        setMsgConstancia(`✅ Constancia procesada. Datos extraídos del SAT. Revisa y confirma.`);

        // Auto-completar el formulario
        setForm({
          nombre: d.datos.nombre || '',
          rfc: d.datos.rfc || '',
          regimenFiscal: d.datos.regimenFiscalDescripcion
            ? `${d.datos.regimenFiscalDescripcion}${d.datos.regimenFiscalCodigo ? ` (${d.datos.regimenFiscalCodigo})` : ''}`
            : (d.datos.tipoPersona === 'MORAL' ? 'Persona Moral' : 'Persona Física'),
          email: '',
          telefono: '',
          direccion: d.datos.domicilio || `CP ${d.datos.codigoPostal}`,
        });
        setShowForm(true); // Mostrar el formulario con los datos pre-cargados
      } else {
        setError(d.error || 'Error al procesar la constancia');
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setProcesandoConstancia(false);
      e.target.value = '';
    }
  };

  const crearDesdeConstancia = async () => {
    if (!datosConstancia) return;
    setCreating(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', new Blob(), 'dummy'); // No re-subir, usar datos ya extraídos
      // Mejor: crear directamente vía API de empresas
      const r = await fetch('/api/empresas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || 'Error al crear empresa');
      } else {
        setShowForm(false);
        setForm({ nombre: '', rfc: '', regimenFiscal: '', email: '', telefono: '', direccion: '' });
        setDatosConstancia(null);
        setMsgConstancia('');
        refresh();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre || !form.rfc) {
      setError('Nombre y RFC son obligatorios');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const r = await fetch('/api/empresas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || 'Error al crear empresa');
      } else {
        setShowForm(false);
        setForm({ nombre: '', rfc: '', regimenFiscal: '', email: '', telefono: '', direccion: '' });
        setDatosConstancia(null);
        setMsgConstancia('');
        refresh();
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="text-center py-20">Cargando empresas...</div>;

  return (
    <div className="space-y-4">
      <div className="flex justify-between flex-wrap gap-2">
        {/* Botón principal: subir constancia */}
        <label className="cursor-pointer">
          <input type="file" accept=".pdf" onChange={handleUploadConstancia} disabled={procesandoConstancia} className="hidden" />
          <div className="inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-md text-sm font-medium transition cursor-pointer">
            {procesandoConstancia ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {procesandoConstancia ? 'Procesando constancia...' : '📄 Subir Constancia Fiscal (SAT)'}
          </div>
        </label>
        {/* Botón secundario: alta manual */}
        <Button variant="secondary" onClick={() => setShowForm(!showForm)}>
          <Plus size={14} className="mr-2" /> {showForm ? 'Cancelar' : 'Alta manual'}
        </Button>
      </div>

      {/* Mensaje de constancia procesada */}
      {msgConstancia && (
        <div className="bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-300 p-3 rounded-lg text-sm flex items-start gap-2">
          <CheckCircle2 size={16} className="mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p>{msgConstancia}</p>
            {datosConstancia && (
              <div className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                <div><strong>RFC:</strong> {datosConstancia.rfc}</div>
                <div><strong>Nombre:</strong> {datosConstancia.nombre?.slice(0, 30)}</div>
                <div><strong>Tipo:</strong> Persona {datosConstancia.tipoPersona}</div>
                {datosConstancia.regimenFiscalCodigo && (
                  <div><strong>Régimen:</strong> {datosConstancia.regimenFiscalCodigo} - {datosConstancia.regimenFiscalDescripcion?.slice(0, 30)}</div>
                )}
                {datosConstancia.codigoPostal && (
                  <div><strong>CP:</strong> {datosConstancia.codigoPostal}</div>
                )}
                <div><strong>Situación:</strong> {datosConstancia.situacionContribuyente}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {showForm && (
        <Card className="p-5">
          <h3 className="font-semibold mb-4">
            {datosConstancia ? '✅ Datos extraídos de la constancia — revisa y confirma' : 'Alta de empresa (manual)'}
          </h3>
          {error && <div className="bg-red-50 text-red-700 p-2 rounded mb-3 text-sm">{error}</div>}
          <form onSubmit={submit} className="space-y-3">
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase text-muted-foreground">Nombre / Razón social *</label>
                <Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Construcciones Hernández SAC" className="mt-1" required />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-muted-foreground">RFC *</label>
                <Input value={form.rfc} onChange={e => setForm({ ...form, rfc: e.target.value.toUpperCase() })} placeholder="HEH850415ABC" className="mt-1 font-mono" required maxLength={13} />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-muted-foreground">Régimen fiscal</label>
                <Input value={form.regimenFiscal} onChange={e => setForm({ ...form, regimenFiscal: e.target.value })} placeholder="Persona Moral / Persona Física / 601 - General de Ley" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-muted-foreground">Email</label>
                <Input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="admin@empresa.mx" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-muted-foreground">Teléfono</label>
                <Input value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} placeholder="555-123-4567" className="mt-1" />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase text-muted-foreground">Dirección</label>
                <Input value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} placeholder="Av. Reforma 123, CDMX" className="mt-1" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={creating}>
                {creating ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Plus size={14} className="mr-2" />}
                {creating ? 'Creando...' : 'Crear empresa'}
              </Button>
              {datosConstancia && (
                <Button type="button" variant="secondary" onClick={() => { setDatosConstancia(null); setMsgConstancia(''); }}>
                  Limpiar constancia
                </Button>
              )}
            </div>
          </form>
        </Card>
      )}

      <DataTableCard title={`Empresas (${data?.empresas?.length || 0})`}>
        <table className="w-full text-sm">
          <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
            <th className="px-4 py-2">Nombre</th><th className="px-4 py-2">RFC</th>
            <th className="px-4 py-2">Régimen</th><th className="px-4 py-2">Clientes</th>
            <th className="px-4 py-2">Proveedores</th><th className="px-4 py-2">Empleados</th>
            <th className="px-4 py-2">Estado</th>
          </tr></thead>
          <tbody>
            {(data?.empresas || []).map((e: any) => (
              <tr key={e.id} className="border-b hover:bg-muted/30">
                <td className="px-4 py-2 font-medium">{e.nombre}</td>
                <td className="px-4 py-2 font-mono text-xs">{e.rfc}</td>
                <td className="px-4 py-2 text-muted-foreground">{e.regimenFiscal || '—'}</td>
                <td className="px-4 py-2"><Badge variant="secondary">{e._count.clientes}</Badge></td>
                <td className="px-4 py-2"><Badge variant="secondary">{e._count.proveedores}</Badge></td>
                <td className="px-4 py-2"><Badge variant="secondary">{e._count.empleados}</Badge></td>
                <td className="px-4 py-2"><Badge variant={e.status === 'activo' ? 'default' : 'secondary'}>{e.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableCard>
    </div>
  );
}

// ====================== IMSS VIEW ======================
function ImssView() {
  const { data, loading, refresh } = useApiData<any>('/api/imss');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [periodo, setPeriodo] = useState({ mes: new Date().getMonth() + 1, anio: new Date().getFullYear() });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mes', String(periodo.mes));
      formData.append('anio', String(periodo.anio));
      const r = await fetch('/api/upload-imss', { method: 'POST', body: formData });
      const d = await r.json();
      setUploadMsg(d.message || `❌ ${d.error}`);
      if (d.success) refresh();
    } catch (e: any) {
      setUploadMsg(`❌ ${e.message}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (loading) return <div className="text-center py-20">Cargando IMSS...</div>;
  if (!data) return <EmptyState icon={ShieldCheck} message="Sin datos IMSS" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 border-l-4 border-l-violet-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Empleados activos</div>
          <div className="text-xl font-bold">{data.totalEmpleados}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-red-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Cuota patronal</div>
          <div className="text-xl font-bold text-red-600">{fmt(data.totalCuotaPatronal)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-orange-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Cuota obrera</div>
          <div className="text-xl font-bold text-orange-600">{fmt(data.totalCuotaObrero)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-amber-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total a pagar IMSS</div>
          <div className="text-xl font-bold text-amber-600">{fmt(data.totalAPagar)}</div>
        </Card>
      </div>

      <Card className="p-4 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">UMA 2026:</span>
          <span>Diaria: <strong>{fmt(data.uma.diaria)}</strong></span>
          <span>·</span>
          <span>Mensual: <strong>{fmt(data.uma.mensual)}</strong></span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Costo total empresarial (nómina + IMSS patronal): <strong>{fmt(data.costoTotalEmpresarial)}</strong>
        </div>
      </Card>

      {/* Upload PDF IMSS */}
      <Card className="p-5">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Upload size={16} className="text-violet-600" /> Cargar PDF del IMSS (Determinación de cuotas)
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Sube el PDF que descargas del portal del IMSS (IDSE). El sistema lo guarda para tu consulta.
          Las cuotas se calculan automáticamente basándose en tus empleados activos.
        </p>
        <div className="flex gap-2 items-end mb-3">
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">Mes</label>
            <select value={periodo.mes} onChange={e => setPeriodo({ ...periodo, mes: parseInt(e.target.value) })} className="block mt-1 p-2 border rounded-md bg-background text-sm">
              {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">Año</label>
            <input type="number" value={periodo.anio} onChange={e => setPeriodo({ ...periodo, anio: parseInt(e.target.value) })} className="block mt-1 p-2 border rounded-md bg-background text-sm w-24" />
          </div>
        </div>
        <label className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:border-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors">
          <Upload size={28} className="text-muted-foreground mb-2" />
          <span className="text-sm font-medium">{uploading ? 'Procesando...' : 'Haz clic para subir tu PDF del IMSS'}</span>
          <input type="file" accept=".pdf" onChange={handleUpload} disabled={uploading} className="hidden" />
        </label>
        {uploadMsg && (
          <div className={cn('mt-3 p-2 rounded text-sm', uploadMsg.startsWith('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>{uploadMsg}</div>
        )}
      </Card>

      <DataTableCard title="Detalle de cuotas IMSS por empleado">
        <table className="w-full text-sm">
          <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
            <th className="px-4 py-2">Empleado</th><th className="px-4 py-2">RFC</th>
            <th className="px-4 py-2">Salario diario</th><th className="px-4 py-2">SBC</th>
            <th className="px-4 py-2 text-right">Cuota patronal</th>
            <th className="px-4 py-2 text-right">Cuota obrera</th>
            <th className="px-4 py-2 text-right">Total</th>
          </tr></thead>
          <tbody>
            {data.empleados.map((e: any) => (
              <tr key={e.empleadoId} className="border-b hover:bg-muted/30">
                <td className="px-4 py-2 font-medium">{e.nombre}</td>
                <td className="px-4 py-2 font-mono text-xs">{e.rfc}</td>
                <td className="px-4 py-2">{fmt(e.salarioDiario)}</td>
                <td className="px-4 py-2">{fmt(e.sbc)}</td>
                <td className="px-4 py-2 text-right text-red-600">{fmt(e.totalPatronal)}</td>
                <td className="px-4 py-2 text-right text-orange-600">{fmt(e.totalObrero)}</td>
                <td className="px-4 py-2 text-right font-bold">{fmt(e.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableCard>
    </div>
  );
}

// ====================== INFONAVIT VIEW ======================
function InfonavitView() {
  const { data, loading, refresh } = useApiData<any>('/api/infonavit');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [periodo, setPeriodo] = useState({ mes: new Date().getMonth() + 1, anio: new Date().getFullYear() });

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('mes', String(periodo.mes));
      formData.append('anio', String(periodo.anio));
      const r = await fetch('/api/upload-infonavit', { method: 'POST', body: formData });
      const d = await r.json();
      setUploadMsg(d.message || `❌ ${d.error}`);
      if (d.success) refresh();
    } catch (e: any) {
      setUploadMsg(`❌ ${e.message}`);
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

  if (loading) return <div className="text-center py-20">Cargando INFONAVIT...</div>;
  if (!data) return <EmptyState icon={HomeIcon} message="Sin datos INFONAVIT" />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 border-l-4 border-l-emerald-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Empleados activos</div>
          <div className="text-xl font-bold">{data.totalEmpleados}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-emerald-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Aportación patronal (5%)</div>
          <div className="text-xl font-bold text-emerald-600">{fmt(data.totalAportacionPatronal)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-amber-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Retención obrera</div>
          <div className="text-xl font-bold text-amber-600">{fmt(data.totalRetencionObrera)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-violet-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total INFONAVIT</div>
          <div className="text-xl font-bold text-violet-600">{fmt(data.total)}</div>
        </Card>
      </div>

      <Card className="p-4 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800">
        <div className="flex items-center gap-2 text-sm">
          <Heart size={14} className="text-emerald-600" />
          <span className="font-semibold">Aportación patronal 5%</span>
          <span>·</span>
          <span>Tope SBC: <strong>{fmt(data.topeSBC)}</strong> (25 UMA diarias)</span>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          La aportación patronal del 5% va al fondo de vivienda de cada empleado.
          La retención obrera aplica solo si el empleado tiene crédito INFONAVIT.
        </div>
      </Card>

      {/* Upload PDF INFONAVIT */}
      <Card className="p-5">
        <h3 className="font-semibold mb-2 flex items-center gap-2">
          <Upload size={16} className="text-violet-600" /> Cargar PDF del INFONAVIT (Estado de cuenta)
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Sube el PDF que descargas del portal INFONAVIT (Mi Subcuenta). El sistema lo guarda para tu consulta.
          Las aportaciones se calculan automáticamente basándose en tus empleados activos.
        </p>
        <div className="flex gap-2 items-end mb-3">
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">Mes</label>
            <select value={periodo.mes} onChange={e => setPeriodo({ ...periodo, mes: parseInt(e.target.value) })} className="block mt-1 p-2 border rounded-md bg-background text-sm">
              {['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'].map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">Año</label>
            <input type="number" value={periodo.anio} onChange={e => setPeriodo({ ...periodo, anio: parseInt(e.target.value) })} className="block mt-1 p-2 border rounded-md bg-background text-sm w-24" />
          </div>
        </div>
        <label className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:border-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors">
          <Upload size={28} className="text-muted-foreground mb-2" />
          <span className="text-sm font-medium">{uploading ? 'Procesando...' : 'Haz clic para subir tu PDF del INFONAVIT'}</span>
          <input type="file" accept=".pdf" onChange={handleUpload} disabled={uploading} className="hidden" />
        </label>
        {uploadMsg && (
          <div className={cn('mt-3 p-2 rounded text-sm', uploadMsg.startsWith('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>{uploadMsg}</div>
        )}
      </Card>

      <DataTableCard title="Detalle de aportaciones INFONAVIT por empleado">
        <table className="w-full text-sm">
          <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
            <th className="px-4 py-2">Empleado</th><th className="px-4 py-2">RFC</th>
            <th className="px-4 py-2">Salario mensual</th><th className="px-4 py-2">SBC</th>
            <th className="px-4 py-2 text-right">Aportación patronal</th>
            <th className="px-4 py-2 text-right">Retención obrera</th>
            <th className="px-4 py-2 text-right">Total</th>
          </tr></thead>
          <tbody>
            {data.empleados.map((e: any) => (
              <tr key={e.empleadoId} className="border-b hover:bg-muted/30">
                <td className="px-4 py-2 font-medium">{e.nombre}</td>
                <td className="px-4 py-2 font-mono text-xs">{e.rfc}</td>
                <td className="px-4 py-2">{fmt(e.salarioMensual)}</td>
                <td className="px-4 py-2">{fmt(e.sbc)}</td>
                <td className="px-4 py-2 text-right text-emerald-600">{fmt(e.totalPatronal)}</td>
                <td className="px-4 py-2 text-right text-amber-600">{fmt(e.totalObrero)}</td>
                <td className="px-4 py-2 text-right font-bold">{fmt(e.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableCard>
    </div>
  );
}

// ====================== ABBAX VIEW (completo) ======================
function AbbaxView({ onDatosActualizados }: { onDatosActualizados: () => void }) {
  const [mensajes, setMensajes] = useState<Array<{ id: string; rol: string; contenido: string; tools?: any[]; isStreaming?: boolean }>>([]);
  const [input, setInput] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [tareas, setTareas] = useState<any[]>([]);
  const [notas, setNotas] = useState<any[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/conversaciones').then(r => r.json()).then(d => {
      if (d.conversaciones?.length) {
        setMensajes(d.conversaciones.map((c: any, i: number) => ({ id: c.id || `prev-${i}`, rol: c.rol, contenido: c.contenido })));
      } else {
        setMensajes([{ id: 'welcome', rol: 'asistente', contenido: '⚡ Abbax en línea. A ver, Jefe, qué desastre tenemos hoy. Toca el micrófono o escribe.' }]);
      }
    });
    cargarTareasNotas();
  }, []);

  const cargarTareasNotas = async () => {
    const [t, n] = await Promise.all([
      fetch('/api/tareas?estado=pendiente').then(r => r.json()),
      fetch('/api/notas').then(r => r.json()),
    ]);
    setTareas(t.tareas || []);
    setNotas(n.notas || []);
  };

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [mensajes]);

  const enviar = async (texto: string) => {
    if (!texto.trim() || procesando) return;
    const userMsg = { id: `u-${Date.now()}`, rol: 'usuario', contenido: texto };
    const asstId = `a-${Date.now()}`;
    setMensajes(p => [...p, userMsg, { id: asstId, rol: 'asistente', contenido: '', isStreaming: true }]);
    setInput('');
    setProcesando(true);

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: texto, historial: mensajes.slice(-10).map(m => ({ rol: m.rol, contenido: m.contenido })) }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let acum = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'token') {
              acum += evt.content;
              setMensajes(p => p.map(m => m.id === asstId ? { ...m, contenido: acum } : m));
            } else if (evt.type === 'done') {
              setMensajes(p => p.map(m => m.id === asstId ? { ...m, contenido: evt.full, isStreaming: false } : m));
              onDatosActualizados();
              cargarTareasNotas();
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setMensajes(p => p.map(m => m.id === asstId ? { ...m, contenido: `⚠️ Error: ${e.message}`, isStreaming: false } : m));
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className="grid lg:grid-cols-5 gap-4">
      {/* Chat */}
      <Card className="lg:col-span-3 flex flex-col h-[640px] overflow-hidden">
        <div className="bg-gradient-to-r from-violet-700 to-fuchsia-700 text-white p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-slate-950/40 border border-cyan-400/30 flex items-center justify-center">
            <Zap size={20} className="text-cyan-400" />
          </div>
          <div className="flex-1">
            <div className="font-bold flex items-center gap-2">ABBAX <Badge variant="secondary" className="text-[10px]">🔊 TTS</Badge></div>
            <div className="text-xs text-white/80">En línea · 22 tools activas</div>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {mensajes.map(m => (
            <div key={m.id} className={cn('flex', m.rol === 'usuario' ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                m.rol === 'usuario' ? 'bg-violet-600 text-white' : 'bg-muted'
              )}>
                {m.contenido || (m.isStreaming ? '...' : '')}
                {m.isStreaming && m.contenido && <span className="inline-block w-1 h-3 bg-violet-500 ml-1 animate-pulse" />}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t p-3 flex gap-2">
          <Button size="icon" className="rounded-full"><Mic size={16} /></Button>
          <Input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') enviar(input); }}
            placeholder="Escribe o usa el micrófono"
            disabled={procesando}
          />
          <Button size="icon" className="rounded-full" onClick={() => enviar(input)} disabled={!input.trim() || procesando}>
            {procesando ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          </Button>
        </div>
      </Card>

      {/* Paneles laterales */}
      <div className="lg:col-span-2 space-y-3">
        <Card className="p-4">
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-violet-600" /> Tareas ({tareas.length})
          </h3>
          {tareas.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">Sin tareas pendientes</p>
          ) : (
            tareas.map(t => (
              <div key={t.id} className="text-xs border rounded p-2 mb-1.5">
                <div className="font-medium">{t.titulo}</div>
                <div className="flex gap-1 mt-1">
                  <Badge variant="secondary" className="text-[10px]">{t.prioridad}</Badge>
                  {t.origen === 'voz' && <span className="text-[10px]">🎤</span>}
                </div>
              </div>
            ))
          )}
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold text-sm mb-2 flex items-center gap-2">
            <StickyNote size={14} className="text-amber-500" /> Notas ({notas.length})
          </h3>
          {notas.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3">Sin notas</p>
          ) : (
            notas.map(n => (
              <div key={n.id} className="bg-amber-100 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 rounded p-2 mb-1.5 text-xs">
                <div className="font-bold">{n.titulo}</div>
                <div className="whitespace-pre-wrap mt-1">{n.contenido}</div>
              </div>
            ))
          )}
        </Card>
      </div>
    </div>
  );
}

