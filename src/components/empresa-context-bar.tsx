'use client';

import { Building2, AlertCircle, ChevronDown } from 'lucide-react';
import { useEmpresa } from '@/components/empresa-provider';
import { cn } from '@/lib/utils';

interface Props {
  /** Texto adicional a mostrar después del nombre del módulo */
  modulo?: string;
  /** Mostrar advertencia si la empresa activa no tiene datos */
  sinDatos?: boolean;
  /** Mensaje personalizado cuando sinDatos=true */
  mensajeSinDatos?: string;
  className?: string;
}

/**
 * Barra de contexto que muestra la empresa activa en cada módulo.
 *
 * Uso:
 *   <EmpresaContextBar modulo="Facturación CFDI" />
 *   <EmpresaContextBar modulo="CFDIs" sinDatos mensajeSinDatos="No hay CFDIs para esta empresa en el periodo seleccionado" />
 */
export function EmpresaContextBar({ modulo, sinDatos = false, mensajeSinDatos, className }: Props) {
  const { empresa, empresas, setEmpresa, loading } = useEmpresa();

  if (loading) {
    return (
      <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/50 border-b text-xs text-muted-foreground">
        Cargando empresa...
      </div>
    );
  }

  if (!empresa) {
    return (
      <div className="px-4 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 text-xs text-amber-700 dark:text-amber-300 flex items-center gap-2">
        <AlertCircle size={14} />
        <span>No hay empresa activa. Ve a módulo Empresas para crear una.</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'px-4 py-2 border-b flex items-center justify-between gap-3 flex-wrap',
        sinDatos
          ? 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900'
          : 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-900',
        className,
      )}
    >
      <div className="flex items-center gap-2 text-xs flex-wrap min-w-0">
        <Building2 size={14} className="text-blue-600 dark:text-blue-400 flex-shrink-0" />
        <span className="text-muted-foreground">Empresa activa:</span>
        <strong className="text-foreground truncate max-w-[260px]" title={empresa.nombre}>
          {empresa.nombre}
        </strong>
        <span className="px-2 py-0.5 rounded bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 font-mono text-[11px]">
          {empresa.rfc}
        </span>
        {modulo && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">Módulo:</span>
            <span className="text-foreground font-medium">{modulo}</span>
          </>
        )}
        {sinDatos && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-amber-700 dark:text-amber-300 font-medium flex items-center gap-1">
              <AlertCircle size={12} />
              {mensajeSinDatos || 'Sin datos para esta empresa'}
            </span>
          </>
        )}
      </div>

      {empresas.length > 1 && (
        <div className="relative">
          <select
            value={empresa.id}
            onChange={(e) => {
              const sel = empresas.find(em => em.id === e.target.value);
              if (sel) setEmpresa(sel);
            }}
            className="h-7 pl-2 pr-7 py-0 rounded text-xs border bg-background hover:bg-muted/50 transition cursor-pointer max-w-[200px] truncate appearance-none"
            title="Cambiar empresa activa"
          >
            {empresas.map((e) => (
              <option key={e.id} value={e.id}>
                {e.nombre} ({e.rfc})
              </option>
            ))}
          </select>
          <ChevronDown size={12} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
        </div>
      )}
    </div>
  );
}
