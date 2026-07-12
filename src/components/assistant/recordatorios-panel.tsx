'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Trash2, Loader2, Bell, Clock, Repeat } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Recordatorio {
  id: string;
  titulo: string;
  descripcion: string | null;
  recurrencia: string;
  fechaHora: string;
  estado: string;
  origen: string;
  createdAt: string;
}

const RECURRENCIA_LABEL: Record<string, string> = {
  unica: 'Único',
  diario: 'Diario',
  semanal: 'Semanal',
  mensual: 'Mensual',
};

function relativo(fechaIso: string): { texto: string; urgente: boolean } {
  const fecha = new Date(fechaIso);
  const ahora = new Date();
  const diff = fecha.getTime() - ahora.getTime();
  const minutos = Math.floor(diff / 60000);
  const horas = Math.floor(minutos / 60);
  const dias = Math.floor(horas / 24);

  if (diff < 0) return { texto: 'Vencido', urgente: true };
  if (minutos < 60) return { texto: `En ${minutos} min`, urgente: minutos < 30 };
  if (horas < 24) return { texto: `En ${horas}h`, urgente: horas < 3 };
  if (dias === 1) return { texto: 'Mañana', urgente: false };
  if (dias < 7) return { texto: `En ${dias} días`, urgente: false };
  return {
    texto: fecha.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }),
    urgente: false,
  };
}

export function RecordatoriosPanel({ refreshKey }: { refreshKey: number }) {
  const [recs, setRecs] = useState<Recordatorio[]>([]);
  const [loading, setLoading] = useState(true);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/recordatorios');
      const d = await r.json();
      setRecs(d.recordatorios || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar, refreshKey]);

  const eliminar = async (id: string) => {
    await fetch(`/api/recordatorios/${id}`, { method: 'DELETE' });
    cargar();
  };

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <Bell size={18} className="text-orange-500" />
          Recordatorios
          {recs.length > 0 && (
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{recs.length}</span>
          )}
        </h2>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin text-muted-foreground" size={20} />
        </div>
      ) : recs.length === 0 ? (
        <div className="text-center py-6 text-sm text-muted-foreground">
          <Bell size={28} className="mx-auto mb-2 opacity-40" />
          Sin recordatorios
          <br />
          <span className="text-xs">
            Di: <em>&quot;Recuérdame...&quot;</em>
          </span>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {recs.map((r) => {
            const rel = relativo(r.fechaHora);
            return (
              <div
                key={r.id}
                className={cn(
                  'flex items-start gap-2 p-2.5 rounded-lg border bg-card hover:bg-accent/30 transition',
                  rel.urgente && 'border-orange-400 bg-orange-50'
                )}
              >
                <div
                  className={cn(
                    'mt-0.5 w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0',
                    rel.urgente
                      ? 'bg-orange-500 text-white animate-pulse'
                      : 'bg-muted text-muted-foreground'
                  )}
                >
                  <Clock size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium line-clamp-1">{r.titulo}</span>
                    {r.recurrencia !== 'unica' && (
                      <Badge variant="outline" className="text-[10px] gap-0.5">
                        <Repeat size={9} />
                        {RECURRENCIA_LABEL[r.recurrencia]}
                      </Badge>
                    )}
                    {r.origen === 'voz' && <span className="text-[10px]">🎤</span>}
                  </div>
                  {r.descripcion && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {r.descripcion}
                    </p>
                  )}
                  <div className="flex items-center gap-2 mt-1 text-xs">
                    <span
                      className={cn(
                        'font-semibold',
                        rel.urgente ? 'text-orange-700' : 'text-muted-foreground'
                      )}
                    >
                      {rel.texto}
                    </span>
                    <span className="text-muted-foreground">
                      ·{' '}
                      {new Date(r.fechaHora).toLocaleString('es-MX', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => eliminar(r.id)}
                  className="h-7 w-7 text-muted-foreground hover:text-red-600"
                >
                  <Trash2 size={14} />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
