'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, DollarSign, FileText, Calculator } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FiscalStats {
  periodo: { mes: number; anio: number };
  emitidas: { count: number; total: number; iva: number; promedio: number };
  recibidas: { count: number; total: number; iva: number; promedio: number };
  ivaPorPagar: number;
  utilidadBruta: number;
  topClientes: Array<{ nombre: string; rfc: string; total: number; count: number }>;
}

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const fmt = (n: number) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0);

export function FiscalPanel({ refreshKey }: { refreshKey: number }) {
  const [stats, setStats] = useState<FiscalStats | null>(null);
  const [loading, setLoading] = useState(true);
  const hoy = new Date();
  const [mes, setMes] = useState(hoy.getMonth() + 1);
  const [anio, setAnio] = useState(hoy.getFullYear());

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/facturas/stats?mes=${mes}&anio=${anio}`);
      const d = await r.json();
      setStats(d);
    } catch (e) {
      console.error('Error cargando stats fiscales:', e);
    } finally {
      setLoading(false);
    }
  }, [mes, anio]);

  useEffect(() => {
    cargar();
  }, [cargar, refreshKey]);

  const mesAnterior = () => {
    if (mes === 1) {
      setMes(12);
      setAnio(anio - 1);
    } else {
      setMes(mes - 1);
    }
  };
  const mesSiguiente = () => {
    if (mes === 12) {
      setMes(1);
      setAnio(anio + 1);
    } else {
      setMes(mes + 1);
    }
  };

  if (loading || !stats) {
    return (
      <Card className="p-4">
        <div className="text-sm text-muted-foreground">Cargando panel fiscal...</div>
      </Card>
    );
  }

  const utilidadPositiva = stats.utilidadBruta >= 0;

  return (
    <Card className="p-4">
      {/* Header con selector de mes */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <Calculator size={16} className="text-violet-600" />
          Panel Fiscal
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <Button size="sm" variant="outline" onClick={mesAnterior} className="h-6 px-2 text-xs">←</Button>
          <span className="font-medium min-w-[100px] text-center">{MESES[mes - 1]} {anio}</span>
          <Button size="sm" variant="outline" onClick={mesSiguiente} className="h-6 px-2 text-xs">→</Button>
        </div>
      </div>

      {/* KPIs fiscales principales */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 text-emerald-700">
            <TrendingUp size={12} />
            <span className="text-[10px] uppercase font-semibold">Emitido</span>
          </div>
          <div className="text-lg font-bold text-emerald-700">{fmt(stats.emitidas.total)}</div>
          <div className="text-[10px] text-muted-foreground">{stats.emitidas.count} facturas</div>
        </div>
        <div className="bg-orange-50 border border-orange-200 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 text-orange-700">
            <TrendingDown size={12} />
            <span className="text-[10px] uppercase font-semibold">Recibido</span>
          </div>
          <div className="text-lg font-bold text-orange-700">{fmt(stats.recibidas.total)}</div>
          <div className="text-[10px] text-muted-foreground">{stats.recibidas.count} facturas</div>
        </div>
      </div>

      {/* Resumen IVA y utilidad */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        <div className="bg-muted/30 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <DollarSign size={12} />
            <span className="text-[10px] uppercase font-semibold">IVA por pagar</span>
          </div>
          <div className={cn('text-lg font-bold', stats.ivaPorPagar >= 0 ? 'text-red-600' : 'text-green-600')}>
            {fmt(stats.ivaPorPagar)}
          </div>
          <div className="text-[10px] text-muted-foreground">Emitido − Acreditable</div>
        </div>
        <div className="bg-muted/30 rounded-lg p-2.5">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileText size={12} />
            <span className="text-[10px] uppercase font-semibold">Utilidad bruta</span>
          </div>
          <div className={cn('text-lg font-bold', utilidadPositiva ? 'text-green-600' : 'text-red-600')}>
            {fmt(stats.utilidadBruta)}
          </div>
          <div className="text-[10px] text-muted-foreground">Ingresos − Gastos</div>
        </div>
      </div>

      {/* Top clientes */}
      {stats.topClientes.length > 0 && (
        <div>
          <h4 className="text-[10px] uppercase font-semibold text-muted-foreground mb-1.5">
            Top clientes del periodo
          </h4>
          <ul className="space-y-1">
            {stats.topClientes.slice(0, 3).map((c, i) => (
              <li key={c.rfc} className="flex items-center gap-2 text-xs">
                <span className="w-4 h-4 rounded-full bg-violet-100 text-violet-700 text-[9px] font-bold flex items-center justify-center flex-shrink-0">
                  {i + 1}
                </span>
                <span className="truncate flex-1">{c.nombre}</span>
                <span className="font-semibold text-violet-700">{fmt(c.total)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
