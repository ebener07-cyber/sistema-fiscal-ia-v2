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
  Upload, FileSpreadsheet, Heart, Home as HomeIcon, Plus, ShieldCheck, Briefcase, RefreshCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from '@/components/theme-provider';
import { useEmpresa } from '@/components/empresa-provider';
import { useToastBridge } from '@/lib/toast';
import { toast } from '@/lib/toast';
import { validarRFC, validarCURP } from '@/lib/rfc-validator';
import { useRouter } from 'next/navigation';
import {
  BarChart, Bar, PieChart, Pie, Cell, ResponsiveContainer,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend,
} from 'recharts';
import {
  Settings, KeyRound, Trash2, ShieldAlert, Lock, Shield,
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
      { id: 'proyectos', label: 'Proyectos', icon: Briefcase },
      { id: 'finanzas', label: 'Reestructura Fin.', icon: DollarSign },
      { id: 'crm', label: 'CRM', icon: TrendingUp },
      { id: 'reportes', label: 'Reportes + Excel', icon: ClipboardList },
      { id: 'balance', label: 'Balance General', icon: BookOpen },
    ],
  },
  { section: 'Asistente IA', items: [{ id: 'abbax', label: 'Abbax (Stark)', icon: Zap }] },
  { section: 'Sistema', items: [{ id: 'admin', label: 'Admin Usuarios', icon: Shield }] },
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
  useToastBridge(); // Inicializa el sistema de toasts global

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
      const url = empresa?.id
        ? `/api/stats?empresaId=${encodeURIComponent(empresa.id)}`
        : '/api/stats';
      const r = await fetch(url, { credentials: 'include' });
      const d = await r.json();
      return d;
    } catch (e) {
      console.error('Error cargando stats:', e);
      return null;
    }
  }, [empresa?.id]);

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
        'fixed top-0 left-0 h-full w-64 bg-slate-950 text-slate-300 z-40 transform transition-transform duration-300 overflow-y-auto',
        'border-r border-white/5',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      )}>
        {/* Brand header */}
        <div className="p-4 border-b border-white/10 flex items-center gap-3 sticky top-0 bg-slate-950 z-10">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 via-fuchsia-600 to-violet-800 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-violet-500/30">
            SF
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-white font-bold text-sm tracking-tight">Sistema Fiscal IA</div>
            <div className="text-[10px] text-slate-400 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              ERP + Abbax · v2.2
            </div>
          </div>
        </div>

        {/* Navegación */}
        <nav className="p-3 pb-20">
          {NAV.map((sec) => (
            <div key={sec.section} className="mb-4">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold px-3 mb-1.5">
                {sec.section}
              </div>
              {sec.items.map((item) => {
                const Icon = item.icon;
                const isActive = view === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => { setView(item.id); setSidebarOpen(false); }}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-all duration-150 group relative',
                      isActive
                        ? 'bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white font-semibold shadow-md shadow-violet-500/30'
                        : 'text-slate-400 hover:bg-white/5 hover:text-white hover:translate-x-0.5'
                    )}
                  >
                    <Icon
                      size={16}
                      className={cn(
                        'transition-transform',
                        isActive ? 'scale-110' : 'group-hover:scale-110'
                      )}
                    />
                    <span className="flex-1 text-left">{item.label}</span>
                    {isActive && (
                      <span className="w-1 h-1 rounded-full bg-white/80" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Footer con info del usuario */}
        {usuario && (
          <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-white/10 bg-slate-950/95 backdrop-blur">
            <div className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/5 transition">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center text-white text-xs font-bold">
                {usuario.nombre?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs text-white font-medium truncate">{usuario.nombre}</div>
                <div className="text-[10px] text-slate-400 truncate">{usuario.email}</div>
              </div>
              <button
                onClick={logout}
                title="Cerrar sesión"
                className="text-slate-500 hover:text-red-400 transition"
              >
                <Lock size={14} />
              </button>
            </div>
          </div>
        )}
      </aside>

      {/* Overlay mobile */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/50 z-30 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* MAIN */}
      <div className="lg:ml-64">
        {/* TOPBAR */}
        <header className="border-b bg-white/80 dark:bg-slate-950/80 backdrop-blur-md sticky top-0 z-20">
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <Button variant="ghost" size="icon" className="lg:hidden flex-shrink-0" onClick={() => setSidebarOpen(true)}>
                <Menu size={18} />
              </Button>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>Sistema Fiscal IA</span>
                  <span>/</span>
                  <span className="text-foreground font-medium capitalize">
                    {NAV.flatMap(s => s.items).find(i => i.id === view)?.label || 'Dashboard'}
                  </span>
                </div>
                <h1 className="font-bold text-base md:text-lg capitalize truncate">
                  {NAV.flatMap(s => s.items).find(i => i.id === view)?.label || 'Dashboard'}
                </h1>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Selector de empresa — más visible */}
              {empresas.length > 0 && (
                <select
                  value={empresa?.id || ''}
                  onChange={(e) => {
                    const sel = empresas.find(em => em.id === e.target.value);
                    if (sel) setEmpresa(sel);
                  }}
                  className="h-9 px-3 pr-8 rounded-lg border bg-background text-sm font-medium hover:bg-muted/50 transition cursor-pointer max-w-[180px] truncate"
                  title="Cambiar empresa activa"
                >
                  {empresas.map((e) => (
                    <option key={e.id} value={e.id}>{e.nombre}</option>
                  ))}
                </select>
              )}

              <div className="relative hidden md:block">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar... (Ctrl+K)" className="pl-9 w-48 lg:w-56 h-9 text-sm" />
              </div>
              <Button variant="ghost" size="icon" onClick={toggle} title="Modo oscuro/claro" className="h-9 w-9">
                {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
              </Button>
              <Button variant="ghost" size="icon" title="Notificaciones" className="h-9 w-9 relative">
                <Bell size={16} />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full" />
              </Button>
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
          {view === 'nomina' && <NominaView empresaId={empresa?.id} />}
          {view === 'compras' && <ComprasView />}
          {view === 'inventario' && <InventarioView empresaId={empresa?.id} />}
          {view === 'bancos' && <BancosView empresaId={empresa?.id} />}
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
          {view === 'proyectos' && <ProyectosView />}
          {view === 'abbax' && <AbbaxView onDatosActualizados={cargarStats} />}
          {view === 'admin' && <AdminView />}
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
  const { theme } = useTheme();
  if (!stats) return <LoadingView message="Cargando dashboard..." />;

  const kpis = [
    { label: 'Ingresos del mes', value: fmt(stats.fiscal.totalEmitido), sub: `${stats.fiscal.countEmitidas} facturas`, icon: TrendingUp, color: 'text-emerald-600', border: 'border-l-emerald-500' },
    { label: 'Egresos del mes', value: fmt(stats.fiscal.totalRecibido), sub: `${stats.fiscal.countRecibidas} facturas`, icon: TrendingDown, color: 'text-orange-600', border: 'border-l-orange-500' },
    { label: 'Utilidad bruta', value: fmt(stats.fiscal.utilidadBruta), sub: stats.fiscal.totalEmitido > 0 ? `Margen ${Math.round((stats.fiscal.utilidadBruta / stats.fiscal.totalEmitido) * 100)}%` : 'Margen 0%', icon: DollarSign, color: 'text-blue-600', border: 'border-l-blue-500' },
    { label: 'IVA por pagar', value: fmt(stats.fiscal.ivaPorPagar), sub: 'Vence próximo mes', icon: Calculator, color: 'text-red-600', border: 'border-l-red-500' },
    { label: 'Clientes activos', value: String(stats.catalogos.clientes), sub: 'En catálogo', icon: Users, color: 'text-violet-600', border: 'border-l-violet-500' },
    { label: 'Empleados', value: String(stats.catalogos.empleados), sub: 'Nómina al corriente', icon: User, color: 'text-fuchsia-600', border: 'border-l-fuchsia-500' },
    { label: 'Productos', value: String(stats.catalogos.productos), sub: `${stats.catalogos.stockBajo} stock bajo`, icon: Package, color: 'text-amber-600', border: 'border-l-amber-500' },
    { label: 'Chats con Abbax hoy', value: String(stats.abbax.conversacionesHoy), sub: `${stats.abbax.tareasPend} tareas pend`, icon: Zap, color: 'text-cyan-600', border: 'border-l-cyan-500' },
  ];

  // Datos para gráficos
  const chartData = [
    { name: 'Ingresos', value: stats.fiscal.totalEmitido, fill: '#10b981' },
    { name: 'Egresos', value: stats.fiscal.totalRecibido, fill: '#f97316' },
    { name: 'Utilidad', value: stats.fiscal.utilidadBruta, fill: '#7c3aed' },
  ];

  const distribucionData = [
    { name: 'Facturas emitidas', value: stats.fiscal.countEmitidas, fill: '#7c3aed' },
    { name: 'Facturas recibidas', value: stats.fiscal.countRecibidas, fill: '#3b82f6' },
  ];

  const textColor = theme === 'dark' ? '#94a3b8' : '#475569';
  const gridColor = theme === 'dark' ? '#1e293b' : '#e2e8f0';

  return (
    <div className="space-y-5 animate-fade-in">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Card key={k.label} className={cn('p-4 border-l-4 card-hover', k.border)}>
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

      {/* Charts: Ingresos vs Egresos + Distribución */}
      <div className="grid md:grid-cols-3 gap-4">
        {/* Bar chart: Ingresos vs Egresos vs Utilidad */}
        <Card className="p-5 md:col-span-2 card-hover">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <BarChart3 size={16} className="text-violet-600" /> Resumen financiero del mes
          </h3>
          {stats.fiscal.totalEmitido === 0 && stats.fiscal.totalRecibido === 0 ? (
            <EmptyState icon={BarChart3} message="Sin datos financieros este mes" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
                  <XAxis dataKey="name" tick={{ fontSize: 12, fill: textColor }} />
                  <YAxis tick={{ fontSize: 11, fill: textColor }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                  <RechartsTooltip
                    formatter={(value: any) => [fmt(value), 'Monto']}
                    contentStyle={{
                      backgroundColor: theme === 'dark' ? '#1e293b' : '#fff',
                      border: `1px solid ${gridColor}`,
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Bar dataKey="value" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* Dona: Distribución de facturas */}
        <Card className="p-5 card-hover">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <FileText size={16} className="text-violet-600" /> Distribución de facturas
          </h3>
          {stats.fiscal.countEmitidas === 0 && stats.fiscal.countRecibidas === 0 ? (
            <EmptyState icon={FileText} message="Sin facturas este mes" />
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={distribucionData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                    label={(entry: any) => `${entry.value}`}
                    labelLine={false}
                  >
                    {distribucionData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.fill} />
                    ))}
                  </Pie>
                  <RechartsTooltip
                    formatter={(value: any, name: any) => [`${value} factura(s)`, name]}
                    contentStyle={{
                      backgroundColor: theme === 'dark' ? '#1e293b' : '#fff',
                      border: `1px solid ${gridColor}`,
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: '11px' }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div>

      {/* Top clientes + alertas */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card className="p-5 card-hover">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <TrendingUp size={16} className="text-violet-600" /> Top clientes del mes
          </h3>
          {stats.topClientes.length === 0 ? (
            <EmptyState icon={Users} message="Sin facturas emitidas este mes" />
          ) : (
            <ul className="space-y-2">
              {stats.topClientes.map((c, i) => (
                <li key={c.rfc} className="flex items-center gap-3 text-sm">
                  <span className="w-6 h-6 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="flex-1 truncate">{c.nombre}</span>
                  <span className="font-semibold text-violet-700 dark:text-violet-300">{fmt(c.total)}</span>
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
function useApiData<T>(url: string, empresaId?: string | null): { data: T | null; loading: boolean; refresh: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);

  // Construir URL con query param empresaId si está disponible
  const urlConEmpresa = (() => {
    if (!empresaId) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}empresaId=${encodeURIComponent(empresaId)}`;
  })();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(urlConEmpresa, { credentials: 'include' });
      const d = await r.json();
      setData(d);
    } finally {
      setLoading(false);
    }
  }, [urlConEmpresa]);

  useEffect(() => { load(); }, [load]);
  return { data, loading, refresh: load };
}

function DataTableCard({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card className="overflow-hidden animate-fade-in">
      <div className="px-4 py-3 border-b font-semibold text-sm flex items-center justify-between gap-2">
        <span>{title}</span>
        {action}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </Card>
  );
}

function EmptyState({ icon: Icon, message, action }: { icon: any; message: string; action?: React.ReactNode }) {
  return (
    <div className="empty-state animate-fade-in">
      <Icon size={40} className="empty-state-icon" />
      <p className="text-sm mb-3">{message}</p>
      {action}
    </div>
  );
}

/** Skeleton loader para tablas */
function TableSkeleton({ cols = 5, rows = 5 }: { cols?: number; rows?: number }) {
  return (
    <div className="p-4 space-y-3">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <div key={c} className="skeleton h-4 flex-1" style={{ width: `${100 / cols}%` }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Loading state estándar para todas las vistas */
function LoadingView({ message = 'Cargando...' }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3">
      <Loader2 className="animate-spin text-primary" size={32} />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

/** Error state estándar */
function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="empty-state animate-fade-in">
      <AlertTriangle size={40} className="empty-state-icon text-amber-500" />
      <p className="text-sm mb-3">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw size={14} className="mr-2" /> Reintentar
        </Button>
      )}
    </div>
  );
}

function ClientesView() {
  const { empresa } = useEmpresa();
  const { data, loading } = useApiData<{ clientes: any[] }>('/api/clientes', empresa?.id);
  if (loading) return <LoadingView message="Cargando clientes..." />;
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
  const { empresa } = useEmpresa();
  const { data, loading } = useApiData<{ proveedores: any[] }>('/api/proveedores', empresa?.id);
  if (loading) return <LoadingView message="Cargando..." />;
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
  const { empresa } = useEmpresa();
  const { data, loading } = useApiData<{ empleados: any[] }>('/api/empleados', empresa?.id);
  if (loading) return <LoadingView message="Cargando..." />;
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
  const { empresa } = useEmpresa();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [filtroDir, setFiltroDir] = useState<'todas' | 'emitida' | 'recibida'>('todas');

  const url = (() => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (filtroDir !== 'todas') params.set('direccion', filtroDir);
    if (empresa?.id) params.set('empresaId', empresa.id);
    return `/api/facturas?${params}`;
  })();

  const { data, loading, refresh } = useApiData<any>(url);

  if (loading) return <LoadingView message="Cargando facturas..." />;
  if (!data?.facturas?.length) return <EmptyState icon={FileText} message="Sin facturas cargadas. Sube tus CFDIs desde el módulo SAT." />;

  const facturas = data.facturas || [];
  const totalCount = data.totalCount || 0;
  const pagination = data.pagination || { page: 1, pageSize: 50, totalPages: 1, hasNext: false, hasPrev: false };

  // Contar emitidas/recibidas del totalCount por separado
  const emitidas = facturas.filter((f: any) => f.direccion === 'emitida').length;
  const recibidas = facturas.filter((f: any) => f.direccion === 'recibida').length;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 border-l-4 border-l-emerald-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total facturas</div>
          <div className="text-xl font-bold">{totalCount.toLocaleString('es-MX')}</div>
          <div className="text-[10px] text-muted-foreground">En el sistema</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-violet-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Monto página actual</div>
          <div className="text-xl font-bold text-violet-600">{fmt(data.total)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-blue-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">IVA página actual</div>
          <div className="text-xl font-bold text-blue-600">{fmt(data.iva)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-amber-500">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">En esta página</div>
          <div className="text-xl font-bold">{emitidas}E / {recibidas}R</div>
        </Card>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1">
          <button
            onClick={() => { setFiltroDir('todas'); setPage(1); }}
            className={cn('px-3 py-1.5 text-xs rounded-md border transition',
              filtroDir === 'todas' ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-muted')}
          >
            Todas
          </button>
          <button
            onClick={() => { setFiltroDir('emitida'); setPage(1); }}
            className={cn('px-3 py-1.5 text-xs rounded-md border transition',
              filtroDir === 'emitida' ? 'bg-emerald-600 text-white border-emerald-600' : 'border-border hover:bg-muted')}
          >
            ↗ Emitidas
          </button>
          <button
            onClick={() => { setFiltroDir('recibida'); setPage(1); }}
            className={cn('px-3 py-1.5 text-xs rounded-md border transition',
              filtroDir === 'recibida' ? 'bg-orange-600 text-white border-orange-600' : 'border-border hover:bg-muted')}
          >
            ↙ Recibidas
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Por página:</span>
          <select
            value={pageSize}
            onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }}
            className="h-8 px-2 rounded-md border bg-background text-xs"
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={200}>200</option>
            <option value={500}>500</option>
          </select>
        </div>
      </div>

      {/* Tabla */}
      <DataTableCard
        title={`Facturas (${facturas.length} de ${totalCount.toLocaleString('es-MX')})`}
        action={
          <button
            onClick={refresh}
            className="text-xs text-violet-600 hover:underline"
            title="Recargar"
          >
            <RefreshCw size={12} className="inline" /> Actualizar
          </button>
        }
      >
        <table className="w-full text-sm">
          <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
            <th className="px-4 py-2">Folio</th><th className="px-4 py-2">Fecha</th>
            <th className="px-4 py-2">RFC contraparte</th><th className="px-4 py-2">Concepto</th>
            <th className="px-4 py-2">Tipo</th><th className="px-4 py-2 text-right">Total</th>
          </tr></thead>
          <tbody>
            {facturas.map((f: any) => (
              <tr key={f.id} className="border-b hover:bg-muted/30">
                <td className="px-4 py-2 font-mono text-xs">{f.serie || ''}{f.folio}</td>
                <td className="px-4 py-2">{new Date(f.fecha).toLocaleDateString('es-MX')}</td>
                <td className="px-4 py-2 font-mono text-xs">{f.receptorRfc || f.emisorRfc}</td>
                <td className="px-4 py-2 truncate max-w-[200px]" title={f.concepto || ''}>{f.concepto || '—'}</td>
                <td className="px-4 py-2">
                  <Badge variant={f.direccion === 'emitida' ? 'default' : 'secondary'}>
                    {f.direccion === 'emitida' ? '↗ E' : '↙ R'}
                  </Badge>
                  {f.tipoComprobante === 'E' && <span className="ml-1 text-xs text-amber-600">NC</span>}
                </td>
                <td className="px-4 py-2 text-right font-semibold">{fmt(f.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataTableCard>

      {/* Paginación */}
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs text-muted-foreground">
            Página <strong>{pagination.page}</strong> de <strong>{pagination.totalPages}</strong>
          </div>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasPrev}
              onClick={() => setPage(1)}
              className="h-8 px-2"
            >
              « Primera
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasPrev}
              onClick={() => setPage(p => Math.max(1, p - 1))}
              className="h-8 px-3"
            >
              ‹ Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasNext}
              onClick={() => setPage(p => p + 1)}
              className="h-8 px-3"
            >
              Siguiente ›
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!pagination.hasNext}
              onClick={() => setPage(pagination.totalPages)}
              className="h-8 px-2"
            >
              Última »
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NominaView({ empresaId }: { empresaId?: string }) {
  const hoy = new Date();
  const [anioSel, setAnioSel] = useState(hoy.getFullYear());
  const [selMes, setSelMes] = useState(0); // 0 = Todo el año

  const url = selMes === 0
    ? `/api/nomina?anio=${anioSel}`
    : `/api/nomina?mes=${selMes}&anio=${anioSel}`;
  const { data, loading, refresh } = useApiData<any>(url, empresaId);

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
      <div className="flex flex-wrap gap-1 items-center justify-between">
        <div className="flex flex-wrap gap-1 items-center">
          <button
            onClick={() => setSelMes(0)}
            className={cn('px-3 py-2 rounded-lg text-xs font-bold transition-all border mr-2',
              selMes === 0 ? 'bg-violet-600 text-white border-violet-600 shadow-md'
              : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-300 dark:border-amber-700 hover:bg-amber-100')}
          >
            📅 Todo {anioSel}
          </button>
          <div className="h-8 w-px bg-border mx-1"></div>
          {meses.map((m, i) => {
            const mesNum = i + 1;
            const datosMes = resumen.find((r: any) => r.mes === mesNum);
            const count = datosMes?.count || 0;
            const isActive = selMes === mesNum;
            const hasData = count > 0;
            return (
              <button key={m} onClick={() => setSelMes(mesNum)}
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

        {/* Botón eliminar mes (solo si hay un mes específico seleccionado y hay recibos) */}
        {selMes !== 0 && (data?.count || 0) > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (!confirm(`¿Eliminar TODOS los recibos de nómina de ${meses[selMes - 1]} ${anioSel}?\n\nSe eliminarán ${data?.count || 0} recibo(s). Esta acción no se puede deshacer.`)) return;
              try {
                const params = new URLSearchParams({
                  mes: String(selMes),
                  anio: String(anioSel),
                });
                if (empresaId) params.set('empresaId', empresaId);
                const r = await fetch(`/api/nomina/eliminar-mes?${params}`, { method: 'DELETE' });
                const d = await r.json();
                if (d.success) { alert(d.message); refresh(); }
                else alert(`Error: ${d.error}`);
              } catch (e: any) { alert(`Error: ${e.message}`); }
            }}
          >
            <Trash2 size={14} className="mr-2" /> Eliminar {meses[selMes - 1]} {anioSel}
          </Button>
        )}
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
          {selMes === 0 ? `Cargando nómina del año ${anioSel}...` : `Cargando nómina de ${meses[selMes - 1]} ${anioSel}...`}
        </div>
      ) : (data?.recibos?.length || 0) === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <Wallet size={32} className="mx-auto mb-2 opacity-40" />
          <p className="text-sm">
            {selMes === 0 ? `No hay recibos de nómina en ${anioSel}` : `No hay recibos en ${meses[selMes - 1]} ${anioSel}`}
          </p>
          <p className="text-xs mt-1">Sube tus CFDIs de nómina (XML) desde el módulo SAT</p>
        </Card>
      ) : (
        <DataTableCard title={
          selMes === 0 ? `Nómina — Todo ${anioSel} (${data?.count || 0})` : `Nómina — ${meses[selMes - 1]} ${anioSel} (${data?.count || 0})`
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
                  {selMes === 0 ? `TOTALES AÑO ${anioSel}:` : `TOTALES ${meses[selMes - 1]} ${anioSel}:`}
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
  const { empresa } = useEmpresa();
  const { data, loading } = useApiData<{ ordenes: any[] }>('/api/compras', empresa?.id);
  if (loading) return <LoadingView message="Cargando..." />;
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

  if (loading) return <LoadingView message="Cargando..." />;
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
  const hoy = new Date();
  const [periodoBanco, setPeriodoBanco] = useState({
    mes: hoy.getMonth() + 1,
    anio: hoy.getFullYear(),
    cuentaId: '',
  });
  const [eliminandoBanco, setEliminandoBanco] = useState(false);

  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

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
    const cuentaIdSel = periodoBanco.cuentaId || data.cuentas[0].id;
    setUploading(true);
    setUploadMsg('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('cuentaId', cuentaIdSel);
      formData.append('mes', String(periodoBanco.mes));
      formData.append('anio', String(periodoBanco.anio));
      if (empresaId) formData.append('empresaId', empresaId);
      const r = await fetch('/api/upload-estado-cuenta', { method: 'POST', body: formData });
      const d = await r.json();
      if (d.success) {
        setUploadMsg(`✅ ${d.message}`);
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

  const eliminarMesBanco = async () => {
    const cuentaIdSel = periodoBanco.cuentaId || data?.cuentas?.[0]?.id;
    if (!cuentaIdSel) {
      toast.warning('Primero crea una cuenta bancaria');
      return;
    }
    const cuenta = data?.cuentas?.find(c => c.id === cuentaIdSel);
    if (!confirm(
      `¿Eliminar TODOS los movimientos de ${meses[periodoBanco.mes - 1]} ${periodoBanco.anio}?\n\n` +
      `Cuenta: ${cuenta?.banco} ${cuenta?.cuenta}\n\n` +
      `Esto te permite volver a subir el estado de cuenta de ese mes.\n\n` +
      `Esta acción no se puede deshacer.`
    )) return;

    setEliminandoBanco(true);
    try {
      const params = new URLSearchParams({
        cuentaId: cuentaIdSel,
        mes: String(periodoBanco.mes),
        anio: String(periodoBanco.anio),
      });
      const r = await fetch(`/api/upload-estado-cuenta?${params}`, { method: 'DELETE' });
      const d = await r.json();
      if (d.success) {
        setUploadMsg(`✅ ${d.message}`);
        toast.success('Movimientos eliminados', d.message);
        refresh();
      } else {
        toast.error('Error', d.error || 'Error');
      }
    } catch (e: any) {
      toast.error('Error', e.message);
    } finally {
      setEliminandoBanco(false);
    }
  };

  if (loading) return <LoadingView message="Cargando..." />;

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
          <Upload size={16} className="text-violet-600" /> Cargar estado de cuenta
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Sube el estado de cuenta de tu banco. <strong>Excel (.xlsx)</strong> y <strong>CSV</strong> se importan automáticamente. PDF se guarda para referencia.
        </p>

        {/* Selector de cuenta + mes + año */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Cuenta</label>
            <select
              value={periodoBanco.cuentaId}
              onChange={e => setPeriodoBanco({ ...periodoBanco, cuentaId: e.target.value })}
              className="w-full h-9 px-2 rounded-md border bg-background text-sm"
            >
              <option value="">— Selecciona —</option>
              {(data?.cuentas || []).map(c => (
                <option key={c.id} value={c.id}>{c.banco} {c.cuenta}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Mes</label>
            <select
              value={periodoBanco.mes}
              onChange={e => setPeriodoBanco({ ...periodoBanco, mes: parseInt(e.target.value) })}
              className="w-full h-9 px-2 rounded-md border bg-background text-sm"
            >
              {meses.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] uppercase font-semibold text-muted-foreground">Año</label>
            <select
              value={periodoBanco.anio}
              onChange={e => setPeriodoBanco({ ...periodoBanco, anio: parseInt(e.target.value) })}
              className="w-full h-9 px-2 rounded-md border bg-background text-sm"
            >
              {Array.from({ length: 5 }, (_, i) => hoy.getFullYear() - i).map(a => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button
              variant="destructive"
              size="sm"
              onClick={eliminarMesBanco}
              disabled={eliminandoBanco || !data?.cuentas?.length}
              className="w-full"
              title="Elimina los movimientos del mes seleccionado para que puedas volver a subir el estado de cuenta"
            >
              {eliminandoBanco ? (
                <Loader2 size={14} className="mr-2 animate-spin" />
              ) : (
                <Trash2 size={14} className="mr-2" />
              )}
              Eliminar mes
            </Button>
          </div>
        </div>

        <label className="border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:border-violet-500 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition-colors">
          <Upload size={28} className="text-muted-foreground mb-2" />
          <span className="text-sm font-medium">{uploading ? 'Procesando...' : 'Haz clic o arrastra tu archivo aquí'}</span>
          <span className="text-xs text-muted-foreground mt-1">
            Formatos: <strong>Excel (.xlsx)</strong> — auto-importa · <strong>CSV</strong> — auto-importa · <strong>PDF</strong> — guarda referencia
          </span>
          <input type="file" accept=".xlsx,.xls,.csv,.pdf" onChange={handleUpload} disabled={uploading || !data?.cuentas?.length} className="hidden" />
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
  const { empresa } = useEmpresa();
  const { data, loading, refresh } = useApiData<{ polizas: any[] }>('/api/polizas', empresa?.id);
  const [generando, setGenerando] = useState(false);
  const hoy = new Date();

  const generarPolizas = async () => {
    if (!empresa?.id) {
      toast.error('Sin empresa', 'Selecciona una empresa primero');
      return;
    }
    setGenerando(true);
    try {
      const r = await fetch('/api/polizas/generar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          empresaId: empresa.id,
          mes: hoy.getMonth() + 1,
          anio: hoy.getFullYear(),
        }),
      });
      const d = await r.json();
      if (d.success) {
        toast.success('Pólizas generadas', d.message);
        refresh();
      } else {
        toast.error('Error', d.error || 'No se pudieron generar');
      }
    } catch (e: any) {
      toast.error('Error', e.message);
    } finally {
      setGenerando(false);
    }
  };

  if (loading) return <LoadingView message="Cargando pólizas..." />;

  // Calcular totales
  const polizas = data?.polizas || [];
  const totalCargos = polizas.reduce((s: number, p: any) => s + (p.cargo || 0), 0);
  const totalAbonos = polizas.reduce((s: number, p: any) => s + (p.abono || 0), 0);
  const cuadrado = Math.abs(totalCargos - totalAbonos) < 0.01;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 border-l-4 border-l-violet-500 card-hover">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total pólizas</div>
          <div className="text-xl font-bold">{polizas.length}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-emerald-500 card-hover">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total cargos</div>
          <div className="text-xl font-bold text-emerald-600">{fmt(totalCargos)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-orange-500 card-hover">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total abonos</div>
          <div className="text-xl font-bold text-orange-600">{fmt(totalAbonos)}</div>
        </Card>
        <Card className={cn('p-4 border-l-4 card-hover', cuadrado ? 'border-l-emerald-500' : 'border-l-red-500')}>
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Estado</div>
          <div className={cn('text-xl font-bold', cuadrado ? 'text-emerald-600' : 'text-red-600')}>
            {cuadrado ? '✓ Cuadrado' : '✗ Descuadre'}
          </div>
          <div className="text-[10px] text-muted-foreground">
            Diferencia: {fmt(Math.abs(totalCargos - totalAbonos))}
          </div>
        </Card>
      </div>

      {/* Botón generar */}
      <div className="flex justify-end">
        <Button onClick={generarPolizas} disabled={generando}>
          {generando ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Sparkles size={14} className="mr-2" />}
          Generar pólizas de {MESES_NOMBRE[hoy.getMonth()]} {hoy.getFullYear()}
        </Button>
      </div>

      {/* Tabla */}
      {polizas.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          message="Sin pólizas generadas. Usa el botón 'Generar pólizas' para crear automáticamente desde facturas y nómina."
        />
      ) : (
        <DataTableCard title={`Pólizas (${polizas.length})`}>
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
              <th className="px-4 py-2">Folio</th>
              <th className="px-4 py-2">Fecha</th>
              <th className="px-4 py-2">Tipo</th>
              <th className="px-4 py-2">Concepto</th>
              <th className="px-4 py-2 text-right">Cargo</th>
              <th className="px-4 py-2 text-right">Abono</th>
              <th className="px-4 py-2">Estado</th>
            </tr></thead>
            <tbody>
              {polizas.map((p: any) => (
                <tr key={p.id} className="border-b hover:bg-muted/30">
                  <td className="px-4 py-2 font-mono text-xs">{p.folio}</td>
                  <td className="px-4 py-2">{new Date(p.fecha).toLocaleDateString('es-MX')}</td>
                  <td className="px-4 py-2">
                    <Badge variant={p.tipo === 'ingreso' ? 'default' : p.tipo === 'egreso' ? 'secondary' : 'outline'}>
                      {p.tipo}
                    </Badge>
                  </td>
                  <td className="px-4 py-2 truncate max-w-[200px]" title={p.concepto}>{p.concepto}</td>
                  <td className="px-4 py-2 text-right font-semibold text-emerald-600">{fmt(p.cargo)}</td>
                  <td className="px-4 py-2 text-right font-semibold text-orange-600">{fmt(p.abono)}</td>
                  <td className="px-4 py-2">
                    <Badge variant={p.estado === 'conciliada' ? 'default' : 'secondary'}>{p.estado}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/30 font-bold">
                <td colSpan={4} className="px-4 py-2 text-right">TOTALES:</td>
                <td className="px-4 py-2 text-right text-emerald-600">{fmt(totalCargos)}</td>
                <td className="px-4 py-2 text-right text-orange-600">{fmt(totalAbonos)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </DataTableCard>
      )}
    </div>
  );
}

function SatView() {
  const { empresa } = useEmpresa();
  const [tab, setTab] = useState<'recibidas' | 'emitidas'>('recibidas');
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [resultados, setResultados] = useState<any[]>([]);
  const [anioSel, setAnioSel] = useState(new Date().getFullYear());
  const [selMes, setSelMes] = useState(0); // 0 = Todo el año
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

  // Reset page cuando cambian los filtros
  useEffect(() => { setPage(1); }, [tab, anioSel, selMes, empresa?.id]);

  // URL con filtro de mes/año/empresa + paginación
  const url = (() => {
    const params = new URLSearchParams({
      direccion: tab === 'recibidas' ? 'recibida' : 'emitida',
      page: String(page),
      pageSize: String(pageSize),
      anio: String(anioSel),
    });
    if (selMes !== 0) params.set('mes', String(selMes));
    if (empresa?.id) params.set('empresaId', empresa.id);
    return `/api/facturas?${params}`;
  })();

  const { data, loading, refresh } = useApiData<any>(url);
  const dirParam = tab === 'recibidas' ? 'recibida' : 'emitida';
  const pagination = data?.pagination || { page: 1, pageSize: 50, totalPages: 1, hasNext: false, hasPrev: false };
  const totalCount = data?.totalCount || 0;

  const [forzarActualizacion, setForzarActualizacion] = useState(false);

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
      if (empresa?.id) formData.append('empresaId', empresa.id);
      if (forzarActualizacion) formData.append('force', 'true');

      const r = await fetch('/api/upload-cfdi', {
        method: 'POST',
        body: formData,
      });
      const d = await r.json();
      if (d.success) {
        setUploadMsg(`✅ ${d.message}`);
        setResultados(d.detalles || []);
        if (forzarActualizacion) {
          toast.success('Facturas actualizadas', `${d.procesados || 0} factura(s) con datos completos`);
        }
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

      {/* Selector de mes/año + Botón eliminar mes */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={anioSel}
            onChange={e => setAnioSel(parseInt(e.target.value))}
            className="h-9 px-3 rounded-md border bg-background text-sm"
          >
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map(a => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <button
            onClick={() => setSelMes(0)}
            className={cn('px-3 py-1.5 text-xs rounded-md border transition',
              selMes === 0 ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-muted')}
          >
            Todo el año
          </button>
          {meses.map((m, i) => {
            const mesNum = i + 1;
            const isActive = selMes === mesNum;
            return (
              <button key={m} onClick={() => setSelMes(mesNum)}
                className={cn('px-2.5 py-1.5 text-xs rounded-md border transition',
                  isActive ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-muted')}
              >
                {m.slice(0, 3)}
              </button>
            );
          })}
        </div>

        {selMes !== 0 && totalCount > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={async () => {
              if (!confirm(`¿Eliminar TODAS las facturas ${tab} de ${meses[selMes - 1]} ${anioSel}?\n\nSe eliminarán ${totalCount} factura(s). Esta acción no se puede deshacer.`)) return;
              const r = await fetch(`/api/facturas/eliminar-mes?mes=${selMes}&anio=${anioSel}&direccion=${dirParam}${empresa?.id ? `&empresaId=${empresa.id}` : ''}`, { method: 'DELETE' });
              const d = await r.json();
              if (d.success) { toast.success('Facturas eliminadas', d.message); refresh(); }
              else toast.error('Error', d.error);
            }}
          >
            <Trash2 size={14} className="mr-2" /> Eliminar {meses[selMes - 1]} {anioSel} ({totalCount})
          </Button>
        )}
      </div>

      {/* Upload zone */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h3 className="font-semibold flex items-center gap-2">
            <Upload size={16} className="text-violet-600" /> Cargar CFDIs ({tab === 'recibidas' ? 'Recibidos' : 'Emitidos'})
          </h3>
          {/* Checkbox para forzar actualización */}
          <label className="flex items-center gap-2 text-xs cursor-pointer bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition">
            <input
              type="checkbox"
              checked={forzarActualizacion}
              onChange={e => setForzarActualizacion(e.target.checked)}
              className="w-4 h-4 accent-amber-600"
            />
            <span className="font-medium text-amber-700 dark:text-amber-300">
              🔄 Forzar actualización
            </span>
          </label>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Sube tus archivos XML (y sus PDFs opcionales) del SAT. También puedes subir un ZIP con múltiples XML.
          El sistema parsea automáticamente y guarda las facturas en la base de datos.
        </p>
        {forzarActualizacion && (
          <div className="mb-3 p-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg text-xs text-amber-700 dark:text-amber-300">
            ⚠️ <strong>Modo actualización activado:</strong> Si los CFDIs ya existen en la base de datos,
            se actualizarán con los datos completos (descuento, impuesto retenido, concepto) en lugar de saltarlos como duplicados.
            Útil cuando subiste facturas antes de que existieran los campos descuento/impuestoRetenido.
          </div>
        )}
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
        <LoadingView message={`Cargando CFDIs ${tab}...`} />
      ) : (data?.facturas?.length || 0) === 0 ? (
        <EmptyState icon={Satellite} message={`Sin CFDIs ${tab} en el período seleccionado`} />
      ) : (
        <>
          <DataTableCard
            title={`CFDIs ${tab} — Mostrando ${(data?.facturas || []).length} de ${totalCount.toLocaleString('es-MX')} factura(s)`}
            action={
              <div className="flex items-center gap-2">
                <select
                  value={pageSize}
                  onChange={e => { setPageSize(parseInt(e.target.value)); setPage(1); }}
                  className="h-7 px-2 rounded border bg-background text-xs"
                >
                  <option value={50}>50</option>
                  <option value={100}>100</option>
                  <option value={200}>200</option>
                  <option value={500}>500</option>
                </select>
                <button
                  onClick={refresh}
                  className="text-xs text-violet-600 hover:underline"
                  title="Recargar"
                >
                  <RefreshCw size={12} className="inline" />
                </button>
              </div>
            }
          >
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
                    <td className="px-4 py-2 font-mono text-xs">{f.serie || ''}{f.folio}</td>
                    <td className="px-4 py-2">{new Date(f.fecha).toLocaleDateString('es-MX')}</td>
                    <td className="px-4 py-2 font-medium">{tab === 'recibidas' ? f.emisorNombre : f.receptorNombre}</td>
                    <td className="px-4 py-2 font-mono text-xs">{tab === 'recibidas' ? f.emisorRfc : f.receptorRfc}</td>
                    <td className="px-4 py-2 text-right font-semibold">{fmt(f.total)}</td>
                    <td className="px-4 py-2 font-mono text-[10px] text-muted-foreground" title={f.uuid}>
                      {f.uuid?.slice(0, 8)}...
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </DataTableCard>

          {/* Paginación SatView */}
          {pagination.totalPages > 1 && (
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="text-xs text-muted-foreground">
                Página <strong>{pagination.page}</strong> de <strong>{pagination.totalPages}</strong> · Total: <strong>{totalCount.toLocaleString('es-MX')}</strong> facturas
              </div>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={() => setPage(1)} className="h-8 px-2">
                  « Primera
                </Button>
                <Button variant="outline" size="sm" disabled={!pagination.hasPrev} onClick={() => setPage(p => Math.max(1, p - 1))} className="h-8 px-3">
                  ‹ Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={() => setPage(p => p + 1)} className="h-8 px-3">
                  Siguiente ›
                </Button>
                <Button variant="outline" size="sm" disabled={!pagination.hasNext} onClick={() => setPage(pagination.totalPages)} className="h-8 px-2">
                  Última »
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function IaFiscalView() {
  const { empresa } = useEmpresa();
  const { data: statsData } = useApiData<any>(`/api/stats?empresaId=${empresa?.id || ''}`, undefined);
  const [simulador, setSimulador] = useState<'isr' | 'iva' | 'ptu'>('isr');
  const [ingresosInput, setIngresosInput] = useState('');
  const [deduccionesInput, setDeduccionesInput] = useState('');
  const [resultado, setResultado] = useState<any>(null);

  // Pre-llenar con datos reales del sistema
  useEffect(() => {
    if (statsData?.fiscal) {
      setIngresosInput(String(Math.round(statsData.fiscal.totalEmitido || 0)));
      setDeduccionesInput(String(Math.round(statsData.fiscal.totalRecibido || 0)));
    }
  }, [statsData]);

  const calcular = () => {
    const ingresos = parseFloat(ingresosInput) || 0;
    const deducciones = parseFloat(deduccionesInput) || 0;
    const utilidad = ingresos - deducciones;

    if (simulador === 'isr') {
      // ISR personas morales 2026: 30% sobre utilidad fiscal
      const isr = utilidad > 0 ? utilidad * 0.30 : 0;
      const utilidadDespuesISR = utilidad - isr;
      setResultado({
        titulo: 'Cálculo de ISR (Persona Moral — 30%)',
        rows: [
          { label: 'Ingresos acumulables', value: ingresos, color: 'text-emerald-600' },
          { label: 'Deducciones autorizadas', value: -deducciones, color: 'text-orange-600' },
          { label: 'Utilidad fiscal', value: utilidad, color: utilidad >= 0 ? 'text-blue-600' : 'text-red-600', bold: true },
          { label: 'ISR (30%)', value: -isr, color: 'text-red-600', bold: true },
          { label: 'Utilidad después de ISR', value: utilidadDespuesISR, color: 'text-violet-600', bold: true },
        ],
        info: `Tasa aplicada: 30% (LISR Art. 9 — Personas morales 2026). Base: $${utilidad.toLocaleString('es-MX')}`,
      });
    } else if (simulador === 'iva') {
      // IVA: 16% trasladado - 16% acreditable
      const ivaTrasladado = ingresos * 0.16;
      const ivaAcreditable = deducciones * 0.16;
      const ivaPorPagar = ivaTrasladado - ivaAcreditable;
      setResultado({
        titulo: 'Cálculo de IVA (16% — LIVA)',
        rows: [
          { label: 'Base gravable (ventas)', value: ingresos, color: 'text-emerald-600' },
          { label: 'IVA trasladado (16%)', value: ivaTrasladado, color: 'text-violet-600' },
          { label: 'Base gravable (compras)', value: deducciones, color: 'text-orange-600' },
          { label: 'IVA acreditable (16%)', value: -ivaAcreditable, color: 'text-blue-600' },
          { label: ivaPorPagar >= 0 ? 'IVA por pagar' : 'IVA a favor', value: ivaPorPagar, color: ivaPorPagar >= 0 ? 'text-red-600' : 'text-emerald-600', bold: true },
        ],
        info: `Tasa: 16% (LIVA Art. 1). Si es a favor, se puede compensar en el siguiente período o solicitar devolución.`,
      });
    } else if (simulador === 'ptu') {
      // PTU: 10% de la utilidad fiscal repartible (después de ISR)
      const utilidadReplicable = utilidad > 0 ? utilidad : 0;
      const ptu = utilidadReplicable * 0.10;
      const isr = utilidad > 0 ? utilidad * 0.30 : 0;
      const utilidadDespuesPTU = utilidad - isr - ptu;
      setResultado({
        titulo: 'Cálculo de PTU (Reparto de Utilidades — LFT Art. 117)',
        rows: [
          { label: 'Utilidad fiscal (ingresos - deducciones)', value: utilidad, color: 'text-blue-600' },
          { label: 'ISR (30%)', value: -isr, color: 'text-red-600' },
          { label: 'Base repartible (utilidad - ISR)', value: utilidad - isr, color: 'text-violet-600' },
          { label: 'PTU (10% de base repartible)', value: -ptu, color: 'text-amber-600', bold: true },
          { label: 'Utilidad neta después de ISR + PTU', value: utilidadDespuesPTU, color: 'text-emerald-600', bold: true },
        ],
        info: `PTU = 10% de la utilidad gravable después de ISR. Se reparte dentro de los 60 días siguientes al cierre del ejercicio (30 mayo).`,
      });
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Selector de simulador */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setSimulador('isr')}
          className={cn('px-4 py-2 rounded-lg text-sm font-semibold border transition flex items-center gap-2',
            simulador === 'isr' ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-muted')}
        >
          <Calculator size={14} /> ISR
        </button>
        <button
          onClick={() => setSimulador('iva')}
          className={cn('px-4 py-2 rounded-lg text-sm font-semibold border transition flex items-center gap-2',
            simulador === 'iva' ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-muted')}
        >
          <FileText size={14} /> IVA
        </button>
        <button
          onClick={() => setSimulador('ptu')}
          className={cn('px-4 py-2 rounded-lg text-sm font-semibold border transition flex items-center gap-2',
            simulador === 'ptu' ? 'bg-violet-600 text-white border-violet-600' : 'border-border hover:bg-muted')}
        >
          <DollarSign size={14} /> PTU
        </button>
      </div>

      {/* Formulario */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          {simulador === 'isr' && <Calculator size={16} className="text-violet-600" />}
          {simulador === 'iva' && <FileText size={16} className="text-violet-600" />}
          {simulador === 'ptu' && <DollarSign size={16} className="text-violet-600" />}
          Simulador de {simulador.toUpperCase()}
          {statsData?.fiscal && (
            <span className="ml-2 text-[10px] bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded">
              ✓ Datos cargados del sistema
            </span>
          )}
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          {simulador === 'isr' && 'Calcula el Impuesto Sobre la Renta para personas morales (30% sobre utilidad fiscal).'}
          {simulador === 'iva' && 'Calcula el IVA por pagar o a favor (16% trasladado menos 16% acreditable).'}
          {simulador === 'ptu' && 'Calcula la Participación de los Trabajadores en las Utilidades (10% de utilidad repartible).'}
        </p>
        <div className="grid md:grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">
              {simulador === 'iva' ? 'Ventas (base gravable)' : 'Ingresos acumulables'}
            </label>
            <Input
              type="number"
              value={ingresosInput}
              onChange={e => setIngresosInput(e.target.value)}
              placeholder="0"
              className="mt-1 font-mono"
            />
            {statsData?.fiscal?.totalEmitido > 0 && (
              <p className="text-[10px] text-emerald-600 mt-1">
                Del sistema: {fmt(statsData.fiscal.totalEmitido)} ({statsData.fiscal.countEmitidas} facturas)
              </p>
            )}
          </div>
          <div>
            <label className="text-xs font-semibold uppercase text-muted-foreground">
              {simulador === 'iva' ? 'Compras (base gravable)' : 'Deducciones autorizadas'}
            </label>
            <Input
              type="number"
              value={deduccionesInput}
              onChange={e => setDeduccionesInput(e.target.value)}
              placeholder="0"
              className="mt-1 font-mono"
            />
            {statsData?.fiscal?.totalRecibido > 0 && (
              <p className="text-[10px] text-orange-600 mt-1">
                Del sistema: {fmt(statsData.fiscal.totalRecibido)} ({statsData.fiscal.countRecibidas} facturas)
              </p>
            )}
          </div>
        </div>
        <Button onClick={calcular}>
          <Sparkles size={14} className="mr-2" /> Calcular {simulador.toUpperCase()}
        </Button>
      </Card>

      {/* Resultado */}
      {resultado && (
        <Card className="p-5 border-l-4 border-l-violet-500 animate-fade-in">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <CheckCircle2 size={16} className="text-emerald-600" /> {resultado.titulo}
          </h3>
          <div className="space-y-2">
            {resultado.rows.map((r: any, i: number) => (
              <div key={i} className={cn('flex justify-between items-center py-1.5 border-b last:border-0', r.bold && 'font-bold')}>
                <span className="text-sm text-muted-foreground">{r.label}</span>
                <span className={cn('text-sm font-mono', r.color)}>
                  {r.value >= 0 ? fmt(r.value) : `(${fmt(Math.abs(r.value))})`}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 p-2 bg-blue-50 dark:bg-blue-900/20 rounded text-xs text-blue-700 dark:text-blue-300">
            ℹ️ {resultado.info}
          </div>
        </Card>
      )}

      {/* Chat con IA Fiscal — ahora conecta a Abbax */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Bot size={16} className="text-violet-600" /> Consulta fiscal con IA
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          ¿Tienes dudas sobre ISR, IVA, IMSS, nómina o cualquier ley fiscal? Consulta con Abbax (asistente con RAG de 9 leyes fiscales mexicanas).
        </p>
        <div className="bg-muted/30 p-3 rounded-lg mb-3 text-sm">
          <strong>Abbax:</strong> Soy tu asistente fiscal. Tengo acceso al texto completo de las 9 leyes fiscales mexicanas (LISR, LIVA, CFF, LFT, LSS, LINFONAVIT, LFPDPPP, LGA, DOF). Puedo responder con el artículo exacto citado.
        </div>
        <div className="flex gap-2">
          <Input
            placeholder="Ej: ¿Qué dice el artículo 27 de la LISR?"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                window.location.hash = 'abbax';
                // Disparar evento para abrir Abbax
                window.dispatchEvent(new CustomEvent('abrir-abbax', {
                  detail: { pregunta: (e.target as HTMLInputElement).value }
                }));
                (e.target as HTMLInputElement).value = '';
              }
            }}
          />
          <Button
            onClick={() => {
              window.dispatchEvent(new CustomEvent('abrir-abbax'));
            }}
          >
            <Zap size={14} className="mr-2" /> Abrir Abbax
          </Button>
        </div>
      </Card>
    </div>
  );
}

function TributarioView() {
  const { empresa } = useEmpresa();
  const { data, loading } = useApiData<any>(`/api/stats?empresaId=${empresa?.id || ''}`, undefined);
  const hoy = new Date();
  const mesActual = hoy.getMonth() + 1;
  const anioActual = hoy.getFullYear();

  if (loading) return <LoadingView message="Calculando obligaciones tributarias..." />;
  if (!data) return <ErrorState message="No se pudieron cargar los datos tributarios" />;

  // Calcular obligaciones reales basadas en los datos del sistema
  const ivaPorPagar = data.fiscal?.ivaPorPagar || 0;
  const totalEmitido = data.fiscal?.totalEmitido || 0;
  const totalRecibido = data.fiscal?.totalRecibido || 0;
  const utilidadBruta = data.fiscal?.utilidadBruta || 0;

  // ISR estimado (30% para persona moral, ~25% efectivo para persona física con actividad empresarial)
  const isrEstimado = utilidadBruta * 0.30;

  // Calcular fechas de vencimiento
  // IVA e ISR: día 17 del mes siguiente
  // DIOT: último día del mes siguiente
  const fechaIVA_ISR = new Date(anioActual, mesActual, 17);
  const fechaDIOT = new Date(anioActual, mesActual + 1, 0); // último día del mes siguiente

  // Generar obligaciones dinámicamente
  const obligaciones = [
    {
      o: 'IVA mensual',
      p: `${MESES_NOMBRE[mesActual - 1]} ${anioActual}`,
      v: fechaIVA_ISR.toLocaleDateString('es-MX'),
      m: ivaPorPagar,
      e: ivaPorPagar > 0 ? 'pendiente' : 'pagado',
      dias: Math.ceil((fechaIVA_ISR.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)),
    },
    {
      o: 'ISR mensual (estimado)',
      p: `${MESES_NOMBRE[mesActual - 1]} ${anioActual}`,
      v: fechaIVA_ISR.toLocaleDateString('es-MX'),
      m: isrEstimado,
      e: isrEstimado > 0 ? 'pendiente' : 'pagado',
      dias: Math.ceil((fechaIVA_ISR.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)),
    },
    {
      o: 'DIOT',
      p: `${MESES_NOMBRE[mesActual - 1]} ${anioActual}`,
      v: fechaDIOT.toLocaleDateString('es-MX'),
      m: 0,
      e: 'urgente',
      dias: Math.ceil((fechaDIOT.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)),
    },
    {
      o: 'Nómina (IMSS + INFONAVIT)',
      p: `${MESES_NOMBRE[mesActual - 1]} ${anioActual}`,
      v: new Date(anioActual, mesActual, 20).toLocaleDateString('es-MX'),
      m: (data.catalogos?.empleados || 0) * 1500, // Estimación: $1500 por empleado
      e: 'pendiente',
      dias: Math.ceil((new Date(anioActual, mesActual, 20).getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)),
    },
  ];

  // Calcular alertas
  const alertas: any[] = [];
  if (ivaPorPagar > 0) {
    alertas.push({
      nivel: 'warning',
      titulo: 'IVA por pagar',
      desc: `Tienes ${fmt(ivaPorPagar)} de IVA por pagar del mes actual. Vence el ${fechaIVA_ISR.toLocaleDateString('es-MX')}.`,
    });
  }
  if (isrEstimado > 0) {
    alertas.push({
      nivel: 'warning',
      titulo: 'ISR estimado',
      desc: `ISR mensual estimado: ${fmt(isrEstimado)} (30% de utilidad bruta ${fmt(utilidadBruta)}).`,
    });
  }

  const totalPendiente = obligaciones.reduce((s: number, o: any) => s + (o.e !== 'pagado' ? o.m : 0), 0);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* KPIs tributarios */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 border-l-4 border-l-violet-500 card-hover">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">IVA por pagar</div>
          <div className={cn('text-xl font-bold', ivaPorPagar > 0 ? 'text-red-600' : 'text-emerald-600')}>{fmt(ivaPorPagar)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-amber-500 card-hover">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">ISR estimado (30%)</div>
          <div className="text-xl font-bold text-amber-600">{fmt(isrEstimado)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-emerald-500 card-hover">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Utilidad bruta</div>
          <div className={cn('text-xl font-bold', utilidadBruta >= 0 ? 'text-emerald-600' : 'text-red-600')}>{fmt(utilidadBruta)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-red-500 card-hover">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Total pendiente</div>
          <div className="text-xl font-bold text-red-600">{fmt(totalPendiente)}</div>
        </Card>
      </div>

      {/* Alertas */}
      {alertas.length > 0 && (
        <Card className="p-4 bg-amber-50/50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800">
          <h3 className="font-semibold mb-2 flex items-center gap-2 text-sm">
            <AlertTriangle size={14} className="text-amber-500" /> Alertas tributarias
          </h3>
          <div className="space-y-1">
            {alertas.map((a, i) => (
              <div key={i} className="text-xs text-amber-700 dark:text-amber-300">
                <strong>{a.titulo}:</strong> {a.desc}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Calendario */}
      <DataTableCard title={`Calendario tributario — ${MESES_NOMBRE[mesActual - 1]} ${anioActual}`}>
        <table className="w-full text-sm">
          <thead><tr className="bg-muted/50 text-[11px] uppercase text-left">
            <th className="px-4 py-2">Obligación</th>
            <th className="px-4 py-2">Periodo</th>
            <th className="px-4 py-2">Vencimiento</th>
            <th className="px-4 py-2">Días restantes</th>
            <th className="px-4 py-2 text-right">Monto estimado</th>
            <th className="px-4 py-2">Estado</th>
          </tr></thead>
          <tbody>
            {obligaciones.map((o: any, i: number) => (
              <tr key={i} className="border-b hover:bg-muted/30">
                <td className="px-4 py-2 font-medium">{o.o}</td>
                <td className="px-4 py-2">{o.p}</td>
                <td className="px-4 py-2">{o.v}</td>
                <td className="px-4 py-2">
                  <span className={cn(
                    'text-xs font-semibold px-2 py-0.5 rounded',
                    o.dias < 0 ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' :
                    o.dias <= 7 ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
                    'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  )}>
                    {o.dias < 0 ? `Vencido ${Math.abs(o.dias)}d` : `${o.dias}d`}
                  </span>
                </td>
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

      {/* Resumen fiscal del mes */}
      <Card className="p-5 bg-violet-50/30 dark:bg-violet-900/10">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Calculator size={16} className="text-violet-600" /> Resumen fiscal del mes
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Facturas emitidas</div>
            <div className="font-bold text-emerald-600">{fmt(totalEmitido)}</div>
            <div className="text-[10px] text-muted-foreground">{data.fiscal?.countEmitidas || 0} factura(s)</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">Facturas recibidas</div>
            <div className="font-bold text-orange-600">{fmt(totalRecibido)}</div>
            <div className="text-[10px] text-muted-foreground">{data.fiscal?.countRecibidas || 0} factura(s)</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-muted-foreground">IVA traslado</div>
            <div className="font-bold text-violet-600">{fmt(data.fiscal?.ivaEmitido || 0)}</div>
            <div className="text-[10px] text-muted-foreground">IVA acreditable: {fmt(data.fiscal?.ivaRecibido || 0)}</div>
          </div>
        </div>
      </Card>
    </div>
  );
}

const MESES_NOMBRE = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function FinanzasView({ stats }: { stats: Stats | null }) {
  const { empresa } = useEmpresa();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [prestamosTexto, setPrestamosTexto] = useState('');
  const [showPrestamosForm, setShowPrestamosForm] = useState(false);

  const cargarAnalisis = useCallback((prestamos?: string) => {
    if (!empresa?.id) return;
    setLoading(true);
    const params = new URLSearchParams({ empresaId: empresa.id });
    if (prestamos && prestamos.trim()) {
      params.set('prestamos', prestamos.trim());
    }
    fetch(`/api/finanzas/analisis?${params}`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  }, [empresa?.id]);

  useEffect(() => {
    cargarAnalisis();
  }, [cargarAnalisis]);

  if (loading) return <LoadingView message="Analizando finanzas con datos de bancos..." />;
  if (!data) return <ErrorState message="No se pudo cargar el análisis financiero" />;

  const ind = data.indicadores || {};
  const flujo = data.flujoMensual || [];
  const alertas = data.alertas || [];
  const sugerencias = data.sugerencias || [];
  const cuentas = data.cuentasBancarias || [];

  // Datos para gráfico de flujo
  const flujoChartData = flujo.filter(f => f.ingresos > 0 || f.egresos > 0).map(f => ({
    name: f.mesNombre.slice(0, 3),
    Ingresos: f.ingresos,
    Egresos: -f.egresos,
    Neto: f.flujoNeto,
  }));

  // Color según score
  const scoreColor = data.score >= 80 ? 'text-emerald-600' : data.score >= 60 ? 'text-amber-600' : 'text-red-600';
  const scoreBg = data.score >= 80 ? 'border-l-emerald-500 bg-emerald-50/30' : data.score >= 60 ? 'border-l-amber-500 bg-amber-50/30' : 'border-l-red-500 bg-red-50/30';

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Calificación principal */}
      <Card className={cn('p-6 border-l-4', scoreBg)}>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs uppercase font-semibold text-muted-foreground">Calificación Financiera</div>
            <div className={cn('text-3xl font-bold mt-1', scoreColor)}>{data.calificacion}</div>
            <div className="text-sm text-muted-foreground mt-1">
              Score: <strong>{data.score}/100</strong> · Análisis del {data.anio}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase font-semibold text-muted-foreground">Saldo en bancos</div>
            <div className={cn('text-3xl font-bold mt-1', ind.saldoBancos >= 0 ? 'text-emerald-600' : 'text-red-600')}>
              {fmt(ind.saldoBancos)}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              ≈ {ind.mesesReservaNomina.toFixed(1)} meses de nómina
            </div>
          </div>
        </div>
      </Card>

      {/* Indicadores principales */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card className="p-4 border-l-4 border-l-emerald-500 card-hover">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Ingresos {data.anio}</div>
          <div className="text-xl font-bold text-emerald-600">{fmt(ind.totalEmitido)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-orange-500 card-hover">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Gastos {data.anio}</div>
          <div className="text-xl font-bold text-orange-600">{fmt(ind.totalRecibido)}</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-violet-500 card-hover">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">Utilidad operativa</div>
          <div className={cn('text-xl font-bold', ind.utilidadOperativa >= 0 ? 'text-violet-600' : 'text-red-600')}>
            {fmt(ind.utilidadOperativa)}
          </div>
          <div className="text-[10px] text-muted-foreground">Margen: {ind.margenUtilidad?.toFixed(1)}%</div>
        </Card>
        <Card className="p-4 border-l-4 border-l-red-500 card-hover">
          <div className="text-[10px] uppercase font-semibold text-muted-foreground">IVA por pagar</div>
          <div className="text-xl font-bold text-red-600">{fmt(ind.ivaPorPagar)}</div>
        </Card>
      </div>

      {/* Razones financieras */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Calculator size={16} className="text-violet-600" /> Razones Financieras
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="border rounded-lg p-3">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">Razón Corriente</div>
            <div className={cn('text-2xl font-bold', ind.razonCorriente >= 1.5 ? 'text-emerald-600' : ind.razonCorriente >= 1 ? 'text-amber-600' : 'text-red-600')}>
              {ind.razonCorriente?.toFixed(2)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              {ind.razonCorriente >= 1.5 ? '✅ Saludable (>1.5)' : ind.razonCorriente >= 1 ? '⚠️ Aceptable (>1)' : '🚨 Crítico (<1)'}
            </div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">Razón Rápida (Acid Test)</div>
            <div className={cn('text-2xl font-bold', ind.razonRapida >= 1 ? 'text-emerald-600' : 'text-amber-600')}>
              {ind.razonRapida?.toFixed(2)}
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Liquidez inmediata sin inventarios
            </div>
          </div>
          <div className="border rounded-lg p-3">
            <div className="text-[10px] uppercase font-semibold text-muted-foreground">Endeudamiento CP</div>
            <div className={cn('text-2xl font-bold', ind.razonEndeudamiento <= 0.5 ? 'text-emerald-600' : ind.razonEndeudamiento <= 0.7 ? 'text-amber-600' : 'text-red-600')}>
              {(ind.razonEndeudamiento * 100)?.toFixed(1)}%
            </div>
            <div className="text-[10px] text-muted-foreground mt-1">
              Pasivos circ. / Activos circ.
            </div>
          </div>
        </div>
      </Card>

      {/* Gráfico de flujo de caja */}
      {flujoChartData.length > 0 && (
        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <BarChart3 size={16} className="text-violet-600" /> Flujo de Caja Mensual
          </h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={flujoChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                <RechartsTooltip
                  formatter={(value: any, name: any) => [fmt(value), name]}
                  contentStyle={{ backgroundColor: 'var(--popover)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }}
                />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="Ingresos" fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Egresos" fill="#f97316" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Neto" fill="#7c3aed" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* Alertas críticas */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <AlertTriangle size={16} className={cn(alertas.some(a => a.nivel === 'critico') ? 'text-red-500' : 'text-amber-500')} />
          Alertas Financieras ({alertas.length})
        </h3>
        <div className="space-y-2">
          {alertas.map((a, i) => (
            <div
              key={i}
              className={cn(
                'border rounded-lg p-3',
                a.nivel === 'critico' ? 'border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800' :
                a.nivel === 'warning' ? 'border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800' :
                'border-emerald-200 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800'
              )}
            >
              <div className={cn(
                'font-semibold text-sm',
                a.nivel === 'critico' ? 'text-red-700 dark:text-red-300' :
                a.nivel === 'warning' ? 'text-amber-700 dark:text-amber-300' :
                'text-emerald-700 dark:text-emerald-300'
              )}>
                {a.titulo}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{a.descripcion}</div>
              <div className="text-xs font-medium mt-2 flex items-start gap-1">
                <span className="text-violet-600">💡</span>
                <span>{a.recomendacion}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Sugerencias expertas */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <Sparkles size={16} className="text-violet-600" /> Sugerencias de Experto Financiero
        </h3>
        <div className="grid md:grid-cols-2 gap-3">
          {sugerencias.map((s, i) => (
            <div key={i} className="border rounded-lg p-3 hover:bg-muted/30 transition card-hover">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="font-semibold text-sm">{s.titulo}</div>
                <Badge variant={s.tipo === 'corto' ? 'default' : s.tipo === 'mediano' ? 'secondary' : 'outline'}>
                  {s.tipo === 'corto' ? 'Inmediato' : s.tipo === 'mediano' ? 'Mediano plazo' : 'Largo plazo'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground">{s.descripcion}</p>
              <div className="text-xs text-emerald-600 font-medium mt-2">
                📈 {s.impactoEstimado}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Cuentas bancarias */}
      {cuentas.length > 0 && (
        <Card className="p-5">
          <h3 className="font-semibold mb-3 flex items-center gap-2">
            <Banknote size={16} className="text-emerald-600" /> Cuentas Bancarias ({cuentas.length})
          </h3>
          <div className="grid md:grid-cols-2 gap-3">
            {cuentas.map((c, i) => (
              <div key={i} className="border rounded-lg p-3">
                <div className="text-xs text-muted-foreground">{c.banco}</div>
                <div className="font-mono text-sm">{c.cuenta}</div>
                <div className={cn('text-lg font-bold mt-1', c.saldo >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                  {fmt(c.saldo)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">{c.movimientos} movimientos</div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Análisis de préstamos — campo de texto */}
      <Card className="p-5 border-l-4 border-l-amber-500 bg-amber-50/20">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-semibold flex items-center gap-2">
            <Wallet size={16} className="text-amber-600" /> Préstamos y Deudas
          </h3>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPrestamosForm(!showPrestamosForm)}
          >
            {showPrestamosForm ? 'Cancelar' : (data.analisisPrestamos ? 'Editar' : 'Agregar')} préstamos
          </Button>
        </div>

        {data.analisisPrestamos && !showPrestamosForm && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <div className="bg-background rounded p-2 border text-center">
                <div className="text-[10px] uppercase text-muted-foreground">Deuda total</div>
                <div className="text-lg font-bold text-red-600">{fmt(data.analisisPrestamos.totalDeuda)}</div>
              </div>
              <div className="bg-background rounded p-2 border text-center">
                <div className="text-[10px] uppercase text-muted-foreground">Pago mensual est.</div>
                <div className="text-lg font-bold text-amber-600">{fmt(data.analisisPrestamos.pagoMensualEstimado)}</div>
              </div>
              <div className="bg-background rounded p-2 border text-center">
                <div className="text-[10px] uppercase text-muted-foreground">Score con deuda</div>
                <div className={cn('text-lg font-bold', data.analisisPrestamos.scoreConDeuda >= 60 ? 'text-emerald-600' : 'text-red-600')}>
                  {data.analisisPrestamos.scoreConDeuda}/100
                </div>
              </div>
              <div className="bg-background rounded p-2 border text-center">
                <div className="text-[10px] uppercase text-muted-foreground">Razón cte. con deuda</div>
                <div className={cn('text-lg font-bold', data.analisisPrestamos.impactoEnRazones.razonCorrienteConDeuda >= 1.5 ? 'text-emerald-600' : 'text-red-600')}>
                  {data.analisisPrestamos.impactoEnRazones.razonCorrienteConDeuda.toFixed(2)}
                </div>
              </div>
            </div>
            <pre className="text-xs whitespace-pre-wrap font-mono bg-background p-3 rounded border">
{data.analisisPrestamos.redaccion}
            </pre>
          </div>
        )}

        {showPrestamosForm && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Describe tus préstamos y deudas actuales. Incluye montos, tipos (tarjeta, nómina, hipoteca, etc.) y bancos/financieras.
              La IA detectará automáticamente los montos y tipos para incorporarlos al análisis financiero.
            </p>
            <textarea
              value={prestamosTexto}
              onChange={e => setPrestamosTexto(e.target.value)}
              placeholder="Ejemplo:&#10;- Tarjeta de crédito Banorte: $45,000&#10;- Préstamo de nómina: $80,000 con Santander&#10;- Crédito automotriz Ford: $150,000&#10;- Financiera Coppel: $12,000"
              className="w-full min-h-[120px] p-3 rounded-lg border bg-background text-sm font-mono"
              autoFocus
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  cargarAnalisis(prestamosTexto);
                  setShowPrestamosForm(false);
                  toast.success('Préstamos analizados', 'Se incorporaron al análisis financiero');
                }}
                disabled={!prestamosTexto.trim()}
              >
                <Sparkles size={14} className="mr-2" /> Analizar con IA
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setPrestamosTexto('');
                  setShowPrestamosForm(false);
                  cargarAnalisis();
                }}
              >
                Limpiar y quitar
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Resumen ejecutivo */}
      <Card className="p-5 bg-violet-50/30 dark:bg-violet-900/10 border-violet-200 dark:border-violet-800">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <ClipboardList size={16} className="text-violet-600" /> Resumen Ejecutivo
        </h3>
        <pre className="text-xs whitespace-pre-wrap font-mono bg-background/50 p-4 rounded-lg border">
{data.resumenEjecutivo}
        </pre>
      </Card>
    </div>
  );
}

function CrmView() {
  const { empresa } = useEmpresa();
  const { data, loading } = useApiData<{ oportunidades: any[] }>('/api/crm', empresa?.id);
  if (loading) return <LoadingView message="Cargando..." />;
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
  const { empresa } = useEmpresa();
  if (!stats) return <LoadingView message="Cargando datos..." />;
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
                const params = new URLSearchParams({
                  mes: String(hoy.getMonth() + 1),
                  anio: String(hoy.getFullYear()),
                });
                if (empresa?.id) params.set('empresaId', empresa.id);
                window.open(`/api/export/facturas?${params}`, '_blank');
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
                const params = new URLSearchParams({
                  mes: String(hoy.getMonth() + 1),
                  anio: String(hoy.getFullYear()),
                });
                if (empresa?.id) params.set('empresaId', empresa.id);
                window.open(`/api/export/nomina?${params}`, '_blank');
              }}
            >
              <FileSpreadsheet size={14} className="mr-2" /> Descargar Excel Nómina
            </Button>
          </div>
        </div>
      </Card>

      {/* Concentrado mensual tipo Excel del usuario + Conciliación */}
      <Card className="p-5">
        <h3 className="font-semibold mb-3 flex items-center gap-2">
          <FileSpreadsheet size={18} className="text-violet-600" /> Concentrado Anual (estilo Excel SAT)
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Genera un Excel con la MISMA estructura que tu concentrado manual: una hoja por mes (Ene-Dic) con
          todos los CFDIs emitidos/recibidos, una hoja "Concentrado" con totales por mes, y una hoja "NOMINA"
          con los recibos de nómina. Excluye CFDIs tipo Pago y Cancelados automáticamente.
        </p>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <FileText size={16} className="text-violet-600" /> Concentrado completo
            </h4>
            <p className="text-xs text-muted-foreground mb-3">
              Excel con 14 hojas (12 meses + Concentrado + Nómina). Formato idéntico a tu Excel ELECTRONICMA.
            </p>
            <Button
              onClick={() => {
                const params = new URLSearchParams({ anio: String(new Date().getFullYear()) });
                if (empresa?.id) params.set('empresaId', empresa.id);
                window.open(`/api/export/concentrado?${params}`, '_blank');
              }}
            >
              <FileSpreadsheet size={14} className="mr-2" /> Descargar Concentrado
            </Button>
          </div>

          <div className="border rounded-lg p-4">
            <h4 className="font-semibold mb-2 flex items-center gap-2">
              <AlertTriangle size={16} className="text-amber-500" /> Conciliación Excel vs Sistema
            </h4>
            <p className="text-xs text-muted-foreground mb-3">
              Sube tu Excel del SAT y te dice qué CFDIs faltan en el sistema, cuáles están de más, y diferencias de monto.
            </p>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".xlsx,.xls"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f || !empresa?.id) return;
                  const fd = new FormData();
                  fd.append('file', f);
                  fd.append('empresaId', empresa.id);
                  try {
                    const r = await fetch('/api/conciliacion', { method: 'POST', body: fd });
                    const d = await r.json();
                    if (d.error) {
                      toast.error('Error en conciliación', d.error);
                    } else {
                      toast.success('Conciliación lista', d.message);
                      // Mostrar resumen
                      const resumen = `=== CONCILIACIÓN ===\n\nCoincidencias: ${d.coincidencias}\nFaltantes en BD: ${d.faltantesEnBD}\nExtra en BD: ${d.extraEnBD}\nDiferencias de monto: ${d.diferenciasMonto}\n\nNÓMINA:\nExcel: ${d.nominasExcel}\nBD: ${d.nominasBD}\nFaltantes: ${d.nominasFaltantes}\n\nDetalle de faltantes (primeros 10):\n${d.detalleFaltantes.slice(0, 10).map((f: any) => `- ${f.hoja} | ${f.uuid.slice(0, 8)}... | $${f.total} | ${f.rfcReceptor}`).join('\n')}`;
                      alert(resumen);
                    }
                  } catch (e: any) {
                    toast.error('Error', e.message);
                  }
                  e.target.value = '';
                }}
                className="hidden"
              />
              <div className="inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-md text-sm font-medium transition cursor-pointer">
                <AlertTriangle size={14} /> Subir Excel y conciliar
              </div>
            </label>
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
  const { empresa } = useEmpresa();
  const [periodo, setPeriodo] = useState({ mes: new Date().getMonth() + 1, anio: new Date().getFullYear() });
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        mes: String(periodo.mes),
        anio: String(periodo.anio),
      });
      if (empresa?.id) params.set('empresaId', empresa.id);
      const r = await fetch(`/api/diot?${params}`);
      const d = await r.json();
      setData(d);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, [periodo, empresa?.id]);

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
  const { empresa } = useEmpresa();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ anio: String(anio) });
      if (empresa?.id) params.set('empresaId', empresa.id);
      const r = await fetch(`/api/inegi?${params}`);
      const d = await r.json();
      setData(d);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, [anio, empresa?.id]);

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
  const { empresa } = useEmpresa();
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const cargar = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ anio: String(anio) });
      if (empresa?.id) params.set('empresaId', empresa.id);
      const r = await fetch(`/api/balance?${params}`);
      const d = await r.json();
      setData(d);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, [anio, empresa?.id]);

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
  const { empresa, setEmpresa } = useEmpresa();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ nombre: '', rfc: '', regimenFiscal: '', email: '', telefono: '', direccion: '' });
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [procesandoConstancia, setProcesandoConstancia] = useState(false);
  const [datosConstancia, setDatosConstancia] = useState<any>(null);
  const [msgConstancia, setMsgConstancia] = useState('');
  const [eliminando, setEliminando] = useState<string | null>(null);

  const handleEliminar = async (id: string, nombre: string, rfc: string) => {
    const totalRel = 0; // ya viene en _count
    const confirmar = window.confirm(
      `¿Eliminar la empresa "${nombre}" (RFC: ${rfc})?\n\n` +
      `Se eliminarán TODOS sus datos relacionados:\n` +
      `• Facturas y CFDIs\n` +
      `• Empleados y Recibos de nómina\n` +
      `• Clientes y Proveedores\n` +
      `• Productos e Inventario\n` +
      `• Cuentas bancarias y Movimientos\n\n` +
      `Esta acción NO se puede deshacer.`
    );
    if (!confirmar) return;

    setEliminando(id);
    try {
      const r = await fetch(`/api/empresas/${id}`, { method: 'DELETE' });
      const d = await r.json();
      if (!r.ok) {
        toast.error('Error al eliminar', d.error || 'Error al eliminar empresa');
      } else {
        toast.success('Empresa eliminada', `Se eliminó "${nombre}" y todos sus datos`);
        // Si la empresa eliminada era la seleccionada, limpiar selección
        if (empresa?.id === id) {
          setEmpresa(null);
        }
        refresh();
      }
    } catch (e: any) {
      toast.error('Error', e.message);
    } finally {
      setEliminando(null);
    }
  };

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
    // Validar RFC mexicano
    const rfcCheck = validarRFC(form.rfc);
    if (!rfcCheck.valido) {
      setError(`RFC inválido: ${rfcCheck.mensaje}`);
      return;
    }
    setCreating(true);
    setError('');
    try {
      const r = await fetch('/api/empresas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, rfc: rfcCheck.formateado }),
      });
      const d = await r.json();
      if (!r.ok) {
        setError(d.error || 'Error al crear empresa');
        toast.error('Error al crear empresa', d.error);
      } else {
        toast.success('Empresa creada', `${form.nombre} (${rfcCheck.formateado})`);
        setShowForm(false);
        setForm({ nombre: '', rfc: '', regimenFiscal: '', email: '', telefono: '', direccion: '' });
        setDatosConstancia(null);
        setMsgConstancia('');
        refresh();
      }
    } catch (e: any) {
      setError(e.message);
      toast.error('Error', e.message);
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <LoadingView message="Cargando empresas..." />;

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
            <th className="px-4 py-2 text-right">Acciones</th>
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
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => handleEliminar(e.id, e.nombre, e.rfc)}
                    disabled={eliminando === e.id}
                    title="Eliminar empresa y todos sus datos"
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {eliminando === e.id ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} />
                    )}
                    {eliminando === e.id ? 'Eliminando...' : 'Eliminar'}
                  </button>
                </td>
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
  const { empresa } = useEmpresa();
  const { data, loading, refresh } = useApiData<any>('/api/imss', empresa?.id);
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
      if (empresa?.id) formData.append('empresaId', empresa.id);
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

  if (loading) return <LoadingView message="Cargando IMSS..." />;
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
  const { empresa } = useEmpresa();
  const { data, loading, refresh } = useApiData<any>('/api/infonavit', empresa?.id);
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
      if (empresa?.id) formData.append('empresaId', empresa.id);
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

  if (loading) return <LoadingView message="Cargando INFONAVIT..." />;
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


// ====================== ADMIN VIEW (gestión de usuarios) ======================
function AdminView() {
  const router = useRouter();

  useEffect(() => {
    // Redirige a la página /admin completa
    router.push('/admin');
  }, [router]);

  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="animate-spin text-violet-500" size={32} />
      <span className="ml-3 text-muted-foreground">Redirigiendo a panel de administración...</span>
    </div>
  );
}

// ====================== PROYECTOS VIEW ======================
function ProyectosView() {
  const { empresa } = useEmpresa();
  const { data, loading, refresh } = useApiData<{ proyectos: any[] }>('/api/proyectos', empresa?.id);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    nombre: '', codigo: '', descripcion: '', clienteId: '', presupuesto: '',
    fechaInicio: '', fechaFin: '',
  });
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [proyectoExpandido, setProyectoExpandido] = useState<string | null>(null);
  const [clientes, setClientes] = useState<any[]>([]);
  const [facturasSinProyecto, setFacturasSinProyecto] = useState<any[]>([]);
  const [showAsignar, setShowAsignar] = useState<string | null>(null);
  const [facturasSeleccionadas, setFacturasSeleccionadas] = useState<Set<string>>(new Set());
  const [conciliacion, setConciliacion] = useState<any>(null);
  const [showConciliacion, setShowConciliacion] = useState(false);

  // Cargar conciliación: PRIMERO auto-crea proyectos desde conceptos, DESPUÉS muestra conciliación
  const cargarConciliacion = async () => {
    if (!empresa?.id) return;
    try {
      // 1. Auto-crear proyectos y asignar facturas
      toast.info('Analizando conceptos...', 'Detectando proyectos automáticamente');
      const postRes = await fetch(`/api/proyectos/conciliacion?empresaId=${empresa.id}`, { method: 'POST' });
      const postData = await postRes.json();

      if (postData.success) {
        toast.success('Proyectos detectados', postData.message);
        refresh(); // Recargar la lista de proyectos
      }

      // 2. Cargar conciliación con bancos
      const r = await fetch(`/api/proyectos/conciliacion?empresaId=${empresa.id}`);
      const d = await r.json();
      setConciliacion(d);
      setShowConciliacion(true);
    } catch (e: any) {
      toast.error('Error', e.message);
    }
  };

  // Cargar clientes para el formulario
  useEffect(() => {
    if (empresa?.id) {
      fetch(`/api/clientes?empresaId=${empresa.id}`)
        .then(r => r.json())
        .then(d => setClientes(d.clientes || []))
        .catch(() => {});
    }
  }, [empresa?.id]);

  // Cargar facturas sin proyecto para asignación manual
  const cargarFacturasSinProyecto = async () => {
    if (!empresa?.id) return;
    try {
      const r = await fetch(`/api/facturas?limit=100&empresaId=${empresa.id}`);
      const d = await r.json();
      setFacturasSinProyecto((d.facturas || []).filter((f: any) => !f.proyectoId));
    } catch {}
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre) { setError('Nombre es obligatorio'); return; }
    setCreating(true); setError('');
    try {
      const r = await fetch('/api/proyectos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, empresaId: empresa?.id }),
      });
      const d = await r.json();
      if (!r.ok) setError(d.error || 'Error');
      else {
        setShowForm(false);
        setForm({ nombre: '', codigo: '', descripcion: '', clienteId: '', presupuesto: '', fechaInicio: '', fechaFin: '' });
        refresh();
      }
    } catch (e: any) { setError(e.message); }
    finally { setCreating(false); }
  };

  const toggleSeleccion = (id: string) => {
    const nueva = new Set(facturasSeleccionadas);
    if (nueva.has(id)) nueva.delete(id); else nueva.add(id);
    setFacturasSeleccionadas(nueva);
  };

  const asignarFacturas = async (proyectoId: string) => {
    if (facturasSeleccionadas.size === 0) {
      toast.warning('Selecciona al menos una factura');
      return;
    }
    try {
      const r = await fetch(`/api/proyectos/${proyectoId}/asignar-factura`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ facturaIds: Array.from(facturasSeleccionadas) }),
      });
      const d = await r.json();
      if (d.ok) {
        toast.success('Facturas asignadas', d.message);
        setShowAsignar(null);
        setFacturasSeleccionadas(new Set());
        refresh();
      } else {
        toast.error('Error', d.error || 'Error');
      }
    } catch (e: any) { toast.error('Error', e.message); }
  };

  const eliminarProyecto = async (id: string, nombre: string) => {
    if (!confirm(`¿Eliminar el proyecto "${nombre}"?\n\nLas facturas asociadas NO se eliminan, solo se desvinculan.`)) return;
    try {
      await fetch(`/api/proyectos/${id}`, { method: 'DELETE' });
      refresh();
    } catch (e: any) { alert(e.message); }
  };

  if (loading) return <LoadingView message="Cargando proyectos..." />;

  const proyectos = data?.proyectos || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Briefcase size={20} className="text-violet-600" /> Proyectos
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Agrupa facturas emitidas y recibidas por obra/servicio. Calcula utilidad y margen por proyecto.
            Detecta proyectos automáticamente desde el concepto de la factura.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={cargarConciliacion} title="Detecta proyectos y cruza con bancos">
            <RefreshCw size={14} className="mr-2" /> Conciliar con bancos
          </Button>
          <Button onClick={() => setShowForm(!showForm)}>
            <Plus size={14} className="mr-2" /> {showForm ? 'Cancelar' : 'Nuevo proyecto'}
          </Button>
        </div>
      </div>

      {/* Panel de conciliación */}
      {showConciliacion && conciliacion && (
        <Card className="p-5 border-l-4 border-l-amber-500 bg-amber-50/30 animate-fade-in">
          <div className="flex justify-between items-start mb-3">
            <h3 className="font-semibold flex items-center gap-2">
              <RefreshCw size={16} className="text-amber-600" /> Conciliación automática
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setShowConciliacion(false)}>✕</Button>
          </div>

          {/* KPIs de conciliación */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-background rounded-lg p-3 border">
              <div className="text-[10px] uppercase text-muted-foreground">Facturas analizadas</div>
              <div className="text-xl font-bold">{conciliacion.totalFacturas}</div>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-900/20 rounded-lg p-3 border border-emerald-200">
              <div className="text-[10px] uppercase text-muted-foreground">Pagadas</div>
              <div className="text-xl font-bold text-emerald-600">{conciliacion.totalPagadas}</div>
            </div>
            <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-3 border border-red-200">
              <div className="text-[10px] uppercase text-muted-foreground">Pendientes</div>
              <div className="text-xl font-bold text-red-600">{conciliacion.totalPendientes}</div>
            </div>
            <div className="bg-violet-50 dark:bg-violet-900/20 rounded-lg p-3 border border-violet-200">
              <div className="text-[10px] uppercase text-muted-foreground">% Cobranza</div>
              <div className="text-xl font-bold text-violet-600">{conciliacion.porcentajeCobranza}%</div>
            </div>
          </div>

          {/* Proyectos detectados automáticamente */}
          {conciliacion.porProyecto && conciliacion.porProyecto.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold mb-2">📁 Proyectos detectados desde conceptos ({conciliacion.proyectosDetectados})</h4>
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {conciliacion.porProyecto.slice(0, 15).map((p: any, i: number) => (
                  <div key={i} className="bg-background border rounded-lg p-3">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm truncate">{p.nombre}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {p.countFacturas} factura(s) · Emitido: {fmt(p.totalEmitido)} · Recibido: {fmt(p.totalRecibido)}
                        </div>
                      </div>
                      <div className="flex gap-2 text-xs">
                        <span className="px-2 py-1 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                          {p.pagadas} pagadas
                        </span>
                        <span className="px-2 py-1 rounded bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300">
                          {p.pendientes} pendientes
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Por cliente */}
          {conciliacion.porCliente && conciliacion.porCliente.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold mb-2">👥 Por cliente</h4>
              <div className="overflow-x-auto bg-background rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left">Cliente</th>
                      <th className="px-3 py-2 text-right">Facturas</th>
                      <th className="px-3 py-2 text-right">Total</th>
                      <th className="px-3 py-2 text-right">Pagadas</th>
                      <th className="px-3 py-2 text-right">Pendientes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conciliacion.porCliente.slice(0, 15).map((c: any, i: number) => (
                      <tr key={i} className="border-b hover:bg-muted/30">
                        <td className="px-3 py-2 font-medium truncate max-w-xs">{c.nombre}</td>
                        <td className="px-3 py-2 text-right">{c.count}</td>
                        <td className="px-3 py-2 text-right font-mono">{fmt(c.total)}</td>
                        <td className="px-3 py-2 text-right text-emerald-600">{c.pagadas}</td>
                        <td className="px-3 py-2 text-right text-red-600">{c.pendientes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Formulario nuevo proyecto */}
      {showForm && (
        <Card className="p-5">
          <h3 className="font-semibold mb-4">Crear nuevo proyecto</h3>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold">Nombre del proyecto *</label>
              <Input value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej. Construcción casa cliente X" required />
            </div>
            <div>
              <label className="text-xs font-semibold">Código (opcional)</label>
              <Input value={form.codigo} onChange={e => setForm({ ...form, codigo: e.target.value })} placeholder="Ej. PROY-001, OB-2024-01" />
              <p className="text-[10px] text-muted-foreground mt-1">
                Si usas este código en la descripción de un CFDI, se asociará automáticamente.
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-semibold">Descripción</label>
              <Input value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Detalle del proyecto" />
            </div>
            <div>
              <label className="text-xs font-semibold">Cliente</label>
              <select
                value={form.clienteId}
                onChange={e => setForm({ ...form, clienteId: e.target.value })}
                className="w-full h-10 px-3 rounded-md border bg-background"
              >
                <option value="">— Sin cliente —</option>
                {clientes.map((c) => (
                  <option key={c.id} value={c.id}>{c.nombre} ({c.rfc})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold">Presupuesto (MXN)</label>
              <Input type="number" value={form.presupuesto} onChange={e => setForm({ ...form, presupuesto: e.target.value })} placeholder="0.00" />
            </div>
            <div>
              <label className="text-xs font-semibold">Fecha inicio</label>
              <Input type="date" value={form.fechaInicio} onChange={e => setForm({ ...form, fechaInicio: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-semibold">Fecha fin estimada</label>
              <Input type="date" value={form.fechaFin} onChange={e => setForm({ ...form, fechaFin: e.target.value })} />
            </div>
            {error && <div className="md:col-span-2 text-red-600 text-sm">{error}</div>}
            <div className="md:col-span-2">
              <Button type="submit" disabled={creating}>
                {creating ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Plus size={14} className="mr-2" />}
                Crear proyecto
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* Lista de proyectos */}
      {proyectos.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Briefcase size={40} className="mx-auto mb-3 opacity-40" />
          <p className="text-sm">Aún no hay proyectos. Crea uno para agrupar facturas.</p>
        </Card>
      ) : (
        proyectos.map((p: any) => (
          <Card key={p.id} className="overflow-hidden">
            {/* Header del proyecto */}
            <div
              className="p-4 cursor-pointer hover:bg-muted/30 transition"
              onClick={() => setProyectoExpandido(proyectoExpandido === p.id ? null : p.id)}
            >
              <div className="flex justify-between items-start gap-3 flex-wrap">
                <div className="flex-1 min-w-[200px]">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold">{p.nombre}</h3>
                    {p.codigo && <Badge variant="outline" className="font-mono text-xs">{p.codigo}</Badge>}
                    <Badge variant={p.estado === 'activo' ? 'default' : 'secondary'}>{p.estado}</Badge>
                  </div>
                  {p.cliente && (
                    <p className="text-xs text-muted-foreground mt-1">
                      👤 {p.cliente.nombre} · {p.cliente.rfc}
                    </p>
                  )}
                  {p.descripcion && (
                    <p className="text-xs text-muted-foreground mt-1">{p.descripcion}</p>
                  )}
                </div>
                <div className="text-right text-xs">
                  <div className="text-muted-foreground">{p.totales.countFacturas} factura(s)</div>
                  <div className="text-emerald-600 font-semibold mt-1">
                    Emitido: {fmt(p.totales.totalEmitido)}
                  </div>
                  <div className="text-orange-600">
                    Recibido: {fmt(p.totales.totalRecibido)}
                  </div>
                  <div className={p.totales.utilidad >= 0 ? 'text-violet-600 font-bold mt-1' : 'text-red-600 font-bold mt-1'}>
                    Utilidad: {fmt(p.totales.utilidad)} ({p.totales.margen.toFixed(1)}%)
                  </div>
                </div>
              </div>

              {/* Barra de presupuesto */}
              {p.presupuesto > 0 && (
                <div className="mt-3">
                  <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
                    <span>Presupuesto: {fmt(p.presupuesto)}</span>
                    <span>{p.totales.porcentajePresupuesto.toFixed(1)}% usado · Resta: {fmt(p.totales.restantePresupuesto)}</span>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full transition-all',
                        p.totales.porcentajePresupuesto > 100 ? 'bg-red-500' :
                        p.totales.porcentajePresupuesto > 80 ? 'bg-amber-500' : 'bg-violet-500'
                      )}
                      style={{ width: `${Math.min(100, p.totales.porcentajePresupuesto)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Detalle expandido */}
            {proyectoExpandido === p.id && (
              <div className="border-t bg-muted/20 p-4 space-y-3">
                <div className="flex justify-between items-center flex-wrap gap-2">
                  <h4 className="text-sm font-semibold">
                    📋 Facturas del proyecto ({p.facturas.length})
                  </h4>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowAsignar(showAsignar === p.id ? null : p.id);
                        if (showAsignar !== p.id) {
                          setFacturasSeleccionadas(new Set());
                          cargarFacturasSinProyecto();
                        }
                      }}
                    >
                      <Plus size={12} className="mr-1" /> Asignar facturas
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        eliminarProyecto(p.id, p.nombre);
                      }}
                    >
                      <Trash2 size={12} className="mr-1" /> Eliminar
                    </Button>
                  </div>
                </div>

                {/* Lista de facturas asignadas */}
                {p.facturas.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-3">
                    Sin facturas asignadas. Usa "Asignar facturas" para vincular.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-muted/50 text-[10px] uppercase text-left">
                          <th className="px-2 py-1">Fecha</th>
                          <th className="px-2 py-1">Folio</th>
                          <th className="px-2 py-1">Tipo</th>
                          <th className="px-2 py-1">Contraparte</th>
                          <th className="px-2 py-1">Concepto</th>
                          <th className="px-2 py-1 text-right">Total</th>
                          <th className="px-2 py-1 text-right">IVA</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.facturas.map((f: any) => (
                          <tr key={f.id} className="border-b hover:bg-muted/30">
                            <td className="px-2 py-1">{new Date(f.fecha).toLocaleDateString('es-MX')}</td>
                            <td className="px-2 py-1 font-mono">{f.serie || ''}{f.folio}</td>
                            <td className="px-2 py-1">
                              <Badge variant={f.direccion === 'emitida' ? 'default' : 'secondary'}>
                                {f.direccion === 'emitida' ? '↗ E' : '↙ R'}
                              </Badge>
                              {f.tipoComprobante === 'E' && <span className="text-amber-600 ml-1">NC</span>}
                            </td>
                            <td className="px-2 py-1">
                              {f.direccion === 'emitida' ? f.receptorNombre : f.emisorNombre}
                            </td>
                            <td className="px-2 py-1 max-w-xs truncate" title={f.concepto || ''}>
                              {f.concepto || '—'}
                            </td>
                            <td className="px-2 py-1 text-right font-mono">{fmt(f.total)}</td>
                            <td className="px-2 py-1 text-right font-mono text-muted-foreground">{fmt(f.totalImpuestos)}</td>
                          </tr>
                        ))}
                        <tr className="bg-muted/30 font-semibold">
                          <td colSpan={5} className="px-2 py-2 text-right">TOTALES:</td>
                          <td className="px-2 py-2 text-right font-mono">{fmt(p.totales.totalEmitido + p.totales.totalRecibido)}</td>
                          <td className="px-2 py-2 text-right font-mono">{fmt(p.totales.ivaEmitido + p.totales.ivaRecibido)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Panel asignar facturas */}
                {showAsignar === p.id && (
                  <Card className="p-3 bg-background">
                    <h5 className="text-xs font-semibold mb-2">
                      Selecciona facturas para asignar a "{p.nombre}"
                    </h5>
                    {facturasSinProyecto.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">
                        No hay facturas sin proyecto. Todas están asignadas o no hay facturas cargadas.
                      </p>
                    ) : (
                      <>
                        <div className="max-h-64 overflow-y-auto border rounded">
                          <table className="w-full text-xs">
                            <thead className="sticky top-0 bg-background">
                              <tr className="text-[10px] uppercase text-left">
                                <th className="px-2 py-1"></th>
                                <th className="px-2 py-1">Fecha</th>
                                <th className="px-2 py-1">Folio</th>
                                <th className="px-2 py-1">Tipo</th>
                                <th className="px-2 py-1">Contraparte</th>
                                <th className="px-2 py-1">Concepto</th>
                                <th className="px-2 py-1 text-right">Total</th>
                              </tr>
                            </thead>
                            <tbody>
                              {facturasSinProyecto.map((f: any) => (
                                <tr key={f.id} className="border-b hover:bg-muted/30 cursor-pointer"
                                    onClick={() => toggleSeleccion(f.id)}>
                                  <td className="px-2 py-1">
                                    <input
                                      type="checkbox"
                                      checked={facturasSeleccionadas.has(f.id)}
                                      onChange={() => toggleSeleccion(f.id)}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                  </td>
                                  <td className="px-2 py-1">{new Date(f.fecha).toLocaleDateString('es-MX')}</td>
                                  <td className="px-2 py-1 font-mono">{f.serie || ''}{f.folio}</td>
                                  <td className="px-2 py-1">
                                    <Badge variant={f.direccion === 'emitida' ? 'default' : 'secondary'}>
                                      {f.direccion === 'emitida' ? '↗ E' : '↙ R'}
                                    </Badge>
                                  </td>
                                  <td className="px-2 py-1">{f.direccion === 'emitida' ? f.receptorNombre : f.emisorNombre}</td>
                                  <td className="px-2 py-1 max-w-xs truncate" title={f.concepto || ''}>{f.concepto || '—'}</td>
                                  <td className="px-2 py-1 text-right font-mono">{fmt(f.total)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div className="flex justify-between items-center mt-2">
                          <span className="text-xs text-muted-foreground">
                            {facturasSeleccionadas.size} seleccionada(s)
                          </span>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" onClick={() => setShowAsignar(null)}>
                              Cancelar
                            </Button>
                            <Button size="sm" onClick={() => asignarFacturas(p.id)}>
                              Asignar {facturasSeleccionadas.size} factura(s)
                            </Button>
                          </div>
                        </div>
                      </>
                    )}
                  </Card>
                )}
              </div>
            )}
          </Card>
        ))
      )}

      {/* Resumen general */}
      {proyectos.length > 0 && (
        <Card className="p-4 bg-violet-50 dark:bg-violet-900/20 border-violet-200 dark:border-violet-800">
          <h3 className="font-semibold text-sm mb-2">📊 Resumen general de proyectos</h3>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
            <div>
              <div className="text-muted-foreground">Proyectos activos</div>
              <div className="text-lg font-bold">{proyectos.filter(p => p.estado === 'activo').length}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Total facturas</div>
              <div className="text-lg font-bold">{proyectos.reduce((s, p) => s + p.totales.countFacturas, 0)}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Total emitido</div>
              <div className="text-lg font-bold text-emerald-600">{fmt(proyectos.reduce((s, p) => s + p.totales.totalEmitido, 0))}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Total recibido</div>
              <div className="text-lg font-bold text-orange-600">{fmt(proyectos.reduce((s, p) => s + p.totales.totalRecibido, 0))}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Utilidad total</div>
              <div className="text-lg font-bold text-violet-600">{fmt(proyectos.reduce((s, p) => s + p.totales.utilidad, 0))}</div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
