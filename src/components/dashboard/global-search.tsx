'use client';

import { useEffect, useRef, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Search, X, CheckCircle2, StickyNote, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ResultadoBusqueda {
  tareas: Array<{ id: string; titulo: string; estado: string; prioridad: string }>;
  notas: Array<{ id: string; titulo: string; contenido: string; color: string }>;
  recordatorios: Array<{ id: string; titulo: string; fechaHora: string; estado: string }>;
  total: number;
}

export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [resultados, setResultados] = useState<ResultadoBusqueda | null>(null);
  const [loading, setLoading] = useState(false);
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    if (query.trim().length < 2) {
      setResultados(null);
      return;
    }
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/buscar?q=${encodeURIComponent(query)}`);
        const d = await r.json();
        setResultados(d);
      } finally {
        setLoading(false);
      }
    }, 250);
    setDebounceTimer(t);
    return () => clearTimeout(t);
  }, [query]);

  // Atajo: Ctrl+K para enfocar búsqueda
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
      }
      if (e.key === 'Escape' && document.activeElement === inputRef.current) {
        setQuery('');
        inputRef.current?.blur();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <Card className="p-3 relative">
      <div className="flex items-center gap-2">
        <Search size={16} className="text-muted-foreground flex-shrink-0" />
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar en tareas, notas y recordatorios... (Ctrl+K)"
          className="border-0 px-0 focus-visible:ring-0 text-sm"
        />
        {query && (
          <button
            onClick={() => setQuery('')}
            className="text-muted-foreground hover:text-foreground"
          >
            <X size={14} />
          </button>
        )}
        <kbd className="hidden md:inline text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
          Ctrl+K
        </kbd>
      </div>

      {/* Resultados desplegables */}
      {query.trim().length >= 2 && resultados && (
        <div className="absolute left-0 right-0 top-full mt-2 z-20 bg-white border rounded-lg shadow-lg max-h-96 overflow-y-auto">
          {loading ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Buscando...</div>
          ) : resultados.total === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              Sin resultados para &quot;{query}&quot;
            </div>
          ) : (
            <div className="divide-y">
              {/* Tareas */}
              {resultados.tareas.length > 0 && (
                <div className="p-2">
                  <div className="text-[10px] uppercase font-semibold text-muted-foreground px-2 py-1 flex items-center gap-1">
                    <CheckCircle2 size={11} /> Tareas ({resultados.tareas.length})
                  </div>
                  {resultados.tareas.map((t) => (
                    <div key={t.id} className="px-2 py-1.5 hover:bg-muted/50 rounded text-xs flex items-center gap-2">
                      <span
                        className={cn(
                          'w-1.5 h-1.5 rounded-full',
                          t.prioridad === 'urgente' ? 'bg-red-500' :
                          t.prioridad === 'alta' ? 'bg-orange-500' :
                          t.prioridad === 'media' ? 'bg-blue-500' : 'bg-gray-400'
                        )}
                      />
                      <span className="flex-1 truncate">{t.titulo}</span>
                      <span className="text-[10px] text-muted-foreground">{t.estado}</span>
                    </div>
                  ))}
                </div>
              )}
              {/* Notas */}
              {resultados.notas.length > 0 && (
                <div className="p-2">
                  <div className="text-[10px] uppercase font-semibold text-muted-foreground px-2 py-1 flex items-center gap-1">
                    <StickyNote size={11} /> Notas ({resultados.notas.length})
                  </div>
                  {resultados.notas.map((n) => (
                    <div key={n.id} className="px-2 py-1.5 hover:bg-muted/50 rounded text-xs">
                      <div className="font-medium truncate">{n.titulo}</div>
                      <div className="text-muted-foreground truncate">{n.contenido}</div>
                    </div>
                  ))}
                </div>
              )}
              {/* Recordatorios */}
              {resultados.recordatorios.length > 0 && (
                <div className="p-2">
                  <div className="text-[10px] uppercase font-semibold text-muted-foreground px-2 py-1 flex items-center gap-1">
                    <Bell size={11} /> Recordatorios ({resultados.recordatorios.length})
                  </div>
                  {resultados.recordatorios.map((r) => (
                    <div key={r.id} className="px-2 py-1.5 hover:bg-muted/50 rounded text-xs flex items-center gap-2">
                      <Bell size={11} className="text-orange-500" />
                      <span className="flex-1 truncate">{r.titulo}</span>
                      <span className="text-[10px] text-muted-foreground">
                        {new Date(r.fechaHora).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' })}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
