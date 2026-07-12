'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Trash2, Plus, Loader2, CheckCircle2, Circle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Tarea {
  id: string;
  titulo: string;
  descripcion: string | null;
  prioridad: string;
  estado: string;
  categoria: string | null;
  fechaLimite: string | null;
  completadaEn: string | null;
  origen: string;
  createdAt: string;
}

const PRIORIDAD_COLORS: Record<string, string> = {
  urgente: 'bg-red-100 text-red-700 border-red-300',
  alta: 'bg-orange-100 text-orange-700 border-orange-300',
  media: 'bg-blue-100 text-blue-700 border-blue-300',
  baja: 'bg-gray-100 text-gray-700 border-gray-300',
};

const ESTADO_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  en_progreso: 'En progreso',
  completada: 'Completada',
  cancelada: 'Cancelada',
};

export function TareasPanel({ refreshKey }: { refreshKey: number }) {
  const [tareas, setTareas] = useState<Tarea[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtro, setFiltro] = useState<'pendiente' | 'completada' | 'todas'>('pendiente');
  const [nuevaTarea, setNuevaTarea] = useState('');

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`/api/tareas?estado=${filtro}`);
      const d = await r.json();
      setTareas(d.tareas || []);
    } finally {
      setLoading(false);
    }
  }, [filtro]);

  useEffect(() => {
    cargar();
  }, [cargar, refreshKey]);

  const toggleCompletada = async (t: Tarea) => {
    const nuevoEstado = t.estado === 'completada' ? 'pendiente' : 'completada';
    await fetch(`/api/tareas/${t.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ estado: nuevoEstado }),
    });
    cargar();
  };

  const eliminar = async (id: string) => {
    await fetch(`/api/tareas/${id}`, { method: 'DELETE' });
    cargar();
  };

  const agregar = async () => {
    if (!nuevaTarea.trim()) return;
    await fetch('/api/tareas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ titulo: nuevaTarea, prioridad: 'media' }),
    });
    setNuevaTarea('');
    cargar();
  };

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <CheckCircle2 size={18} className="text-violet-600" />
          Tareas
          {tareas.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {tareas.length}
            </Badge>
          )}
        </h2>
        <div className="flex gap-1 text-xs">
          {(['pendiente', 'completada', 'todas'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFiltro(f)}
              className={cn(
                'px-2 py-1 rounded transition',
                filtro === f
                  ? 'bg-violet-600 text-white'
                  : 'bg-muted hover:bg-muted/70'
              )}
            >
              {ESTADO_LABEL[f] || 'Todas'}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <Input
          value={nuevaTarea}
          onChange={(e) => setNuevaTarea(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && agregar()}
          placeholder="Agregar tarea rápida..."
          className="text-sm"
        />
        <Button size="icon" onClick={agregar}>
          <Plus size={16} />
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin text-muted-foreground" size={20} />
        </div>
      ) : tareas.length === 0 ? (
        <div className="text-center py-6 text-sm text-muted-foreground">
          <Circle size={28} className="mx-auto mb-2 opacity-40" />
          No hay tareas {filtro !== 'todas' && ESTADO_LABEL[filtro]?.toLowerCase()}
          <br />
          <span className="text-xs">
            Di: <em>&quot;Crea una tarea...&quot;</em>
          </span>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
          {tareas.map((t) => (
            <div
              key={t.id}
              className={cn(
                'flex items-start gap-2 p-2.5 rounded-lg border bg-card hover:bg-accent/30 transition',
                t.estado === 'completada' && 'opacity-60'
              )}
            >
              <Checkbox
                checked={t.estado === 'completada'}
                onCheckedChange={() => toggleCompletada(t)}
                className="mt-0.5"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className={cn(
                      'text-sm font-medium',
                      t.estado === 'completada' && 'line-through text-muted-foreground'
                    )}
                  >
                    {t.titulo}
                  </span>
                  <span
                    className={cn(
                      'text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded border',
                      PRIORIDAD_COLORS[t.prioridad] || PRIORIDAD_COLORS.media
                    )}
                  >
                    {t.prioridad}
                  </span>
                  {t.categoria && (
                    <Badge variant="outline" className="text-[10px]">
                      {t.categoria}
                    </Badge>
                  )}
                  {t.origen === 'voz' && (
                    <span className="text-[10px]" title="Creada por voz">
                      🎤
                    </span>
                  )}
                </div>
                {t.descripcion && (
                  <p className="text-xs text-muted-foreground mt-0.5">{t.descripcion}</p>
                )}
                {t.fechaLimite && (
                  <p className="text-[11px] text-orange-600 mt-0.5 flex items-center gap-1">
                    <AlertCircle size={11} />
                    {new Date(t.fechaLimite).toLocaleDateString('es-MX', {
                      day: 'numeric',
                      month: 'short',
                    })}
                  </p>
                )}
              </div>
              <Button
                size="icon"
                variant="ghost"
                onClick={() => eliminar(t.id)}
                className="h-7 w-7 text-muted-foreground hover:text-red-600"
              >
                <Trash2 size={14} />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
