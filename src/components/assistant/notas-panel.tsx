'use client';

import { useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Trash2, Plus, Loader2, Pin, StickyNote } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Nota {
  id: string;
  titulo: string;
  contenido: string;
  color: string;
  fijada: boolean;
  origen: string;
  createdAt: string;
}

const COLOR_STYLES: Record<string, string> = {
  amarillo: 'bg-yellow-100 border-yellow-300',
  rosa: 'bg-pink-100 border-pink-300',
  azul: 'bg-sky-100 border-sky-300',
  verde: 'bg-emerald-100 border-emerald-300',
  morado: 'bg-violet-100 border-violet-300',
};

export function NotasPanel({ refreshKey }: { refreshKey: number }) {
  const [notas, setNotas] = useState<Nota[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [nueva, setNueva] = useState({ titulo: '', contenido: '', color: 'amarillo' });

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/notas');
      const d = await r.json();
      setNotas(d.notas || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar, refreshKey]);

  const crear = async () => {
    if (!nueva.titulo.trim()) return;
    await fetch('/api/notas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(nueva),
    });
    setNueva({ titulo: '', contenido: '', color: 'amarillo' });
    setShowForm(false);
    cargar();
  };

  const toggleFijar = async (n: Nota) => {
    await fetch(`/api/notas/${n.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fijada: !n.fijada }),
    });
    cargar();
  };

  const eliminar = async (id: string) => {
    await fetch(`/api/notas/${id}`, { method: 'DELETE' });
    cargar();
  };

  return (
    <Card className="p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2">
          <StickyNote size={18} className="text-amber-500" />
          Notas
          {notas.length > 0 && (
            <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{notas.length}</span>
          )}
        </h2>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setShowForm(!showForm)}
          className="text-xs"
        >
          <Plus size={14} /> Nueva
        </Button>
      </div>

      {showForm && (
        <div className="space-y-2 p-3 rounded-lg bg-muted/30 border">
          <Input
            placeholder="Título"
            value={nueva.titulo}
            onChange={(e) => setNueva({ ...nueva, titulo: e.target.value })}
            className="text-sm"
          />
          <Textarea
            placeholder="Contenido..."
            value={nueva.contenido}
            onChange={(e) => setNueva({ ...nueva, contenido: e.target.value })}
            className="text-sm min-h-16"
          />
          <div className="flex gap-1.5">
            {Object.keys(COLOR_STYLES).map((c) => (
              <button
                key={c}
                onClick={() => setNueva({ ...nueva, color: c })}
                className={cn(
                  'w-6 h-6 rounded-full border-2',
                  COLOR_STYLES[c].split(' ')[0],
                  nueva.color === c ? 'border-gray-800' : 'border-transparent'
                )}
              />
            ))}
          </div>
          <Button size="sm" onClick={crear} className="w-full">
            Guardar
          </Button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="animate-spin text-muted-foreground" size={20} />
        </div>
      ) : notas.length === 0 ? (
        <div className="text-center py-6 text-sm text-muted-foreground">
          <StickyNote size={28} className="mx-auto mb-2 opacity-40" />
          Sin notas todavía
          <br />
          <span className="text-xs">
            Di: <em>&quot;Anota...&quot;</em>
          </span>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
          {notas.map((n) => (
            <div
              key={n.id}
              className={cn(
                'rounded-lg p-3 border relative group',
                COLOR_STYLES[n.color] || COLOR_STYLES.amarillo
              )}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <h3 className="font-semibold text-sm line-clamp-1">{n.titulo}</h3>
                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition">
                  <button
                    onClick={() => toggleFijar(n)}
                    className={cn(
                      'p-1 hover:bg-black/10 rounded',
                      n.fijada && 'text-violet-700'
                    )}
                  >
                    <Pin size={12} />
                  </button>
                  <button
                    onClick={() => eliminar(n.id)}
                    className="p-1 hover:bg-red-200 rounded text-red-700"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
              <p className="text-xs whitespace-pre-wrap line-clamp-4">{n.contenido}</p>
              {n.origen === 'voz' && (
                <span className="absolute top-1 right-1 text-[10px]">🎤</span>
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
