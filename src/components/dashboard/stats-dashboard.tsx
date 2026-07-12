'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { CheckCircle2, AlertTriangle, Bell, StickyNote, MessageSquare, TrendingUp, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ArcReactor } from '@/components/abbax/arc-reactor';

interface Stats {
  tareas: {
    pendientes: number;
    completadas: number;
    urgentes: number;
    total: number;
    productividad: number;
  };
  notas: { activas: number };
  recordatorios: {
    proximos: number;
    hoy: number;
    lista: Array<{ id: string; titulo: string; fechaHora: string }>;
  };
  conversaciones: { hoy: number; mes: number };
  topTareas: Array<{ id: string; titulo: string; prioridad: string }>;
  fecha: string;
}

interface Props {
  refreshKey: number;
}

export function StatsDashboard({ refreshKey }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/stats');
      const d = await r.json();
      setStats(d);
    } catch (e) {
      console.error('Error cargando stats:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
    // Refrescar cada 30 segundos
    const t = setInterval(cargar, 30000);
    return () => clearInterval(t);
  }, [cargar, refreshKey]);

  if (loading || !stats) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-3">
          <ArcReactor size={32} state="thinking" />
          <span className="text-sm text-muted-foreground">Cargando estadísticas...</span>
        </div>
      </Card>
    );
  }

  const cards = [
    {
      label: 'Tareas pendientes',
      value: stats.tareas.pendientes,
      sub: `${stats.tareas.urgentes} urgentes`,
      icon: <CheckCircle2 size={16} />,
      color: 'text-violet-600',
      bg: 'bg-violet-50',
    },
    {
      label: 'Productividad',
      value: `${stats.tareas.productividad}%`,
      sub: `${stats.tareas.completadas}/${stats.tareas.total} completadas`,
      icon: <TrendingUp size={16} />,
      color: 'text-emerald-600',
      bg: 'bg-emerald-50',
    },
    {
      label: 'Notas activas',
      value: stats.notas.activas,
      sub: 'En tu tablero',
      icon: <StickyNote size={16} />,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
    },
    {
      label: 'Recordatorios próximos',
      value: stats.recordatorios.proximos,
      sub: `${stats.recordatorios.hoy} hoy`,
      icon: <Bell size={16} />,
      color: 'text-orange-600',
      bg: 'bg-orange-50',
    },
    {
      label: 'Conversaciones hoy',
      value: stats.conversaciones.hoy,
      sub: `${stats.conversaciones.mes} este mes`,
      icon: <MessageSquare size={16} />,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
    },
  ];

  return (
    <div className="space-y-3">
      {/* KPI cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <Card key={c.label} className={cn('p-3 border-l-4', c.bg)} style={{ borderLeftColor: 'currentColor' }}>
            <div className={cn('flex items-center gap-1.5 mb-1', c.color)}>
              {c.icon}
              <span className="text-[11px] uppercase font-semibold tracking-wide">{c.label}</span>
            </div>
            <div className={cn('text-2xl font-bold', c.color)}>{c.value}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{c.sub}</div>
          </Card>
        ))}
      </div>

      {/* Top tareas + próximos recordatorios */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Top tareas */}
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Zap size={14} className="text-violet-600" />
            <h3 className="font-semibold text-sm">Top tareas prioritarias</h3>
          </div>
          {stats.topTareas.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">Sin tareas pendientes. Día libre, Jefe.</p>
          ) : (
            <ul className="space-y-1.5">
              {stats.topTareas.map((t, i) => (
                <li key={t.id} className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      'w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0',
                      t.prioridad === 'urgente'
                        ? 'bg-red-500 text-white'
                        : t.prioridad === 'alta'
                        ? 'bg-orange-500 text-white'
                        : t.prioridad === 'media'
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-400 text-white'
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="truncate">{t.titulo}</span>
                  <span className="ml-auto text-[10px] text-muted-foreground uppercase">{t.prioridad}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Próximos recordatorios */}
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-2">
            <Clock size={14} className="text-orange-600" />
            <h3 className="font-semibold text-sm">Próximos recordatorios</h3>
          </div>
          {stats.recordatorios.lista.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">Sin recordatorios próximos.</p>
          ) : (
            <ul className="space-y-1.5">
              {stats.recordatorios.lista.map((r) => {
                const fecha = new Date(r.fechaHora);
                const ahora = new Date();
                const diff = fecha.getTime() - ahora.getTime();
                const horas = Math.floor(diff / 3600000);
                const dias = Math.floor(horas / 24);
                const txt = diff < 0 ? 'Vencido' : dias > 0 ? `En ${dias}d` : horas > 0 ? `En ${horas}h` : 'Pronto';
                return (
                  <li key={r.id} className="flex items-center gap-2 text-xs">
                    <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0 animate-pulse" />
                    <span className="truncate flex-1">{r.titulo}</span>
                    <span className="text-[10px] text-orange-600 font-semibold">{txt}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
