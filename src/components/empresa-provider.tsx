'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';

interface EmpresaActiva {
  id: string;
  nombre: string;
  rfc: string;
}

interface EmpresaContextValue {
  empresa: EmpresaActiva | null;
  empresas: EmpresaActiva[];
  setEmpresa: (e: EmpresaActiva) => void;
  cargarEmpresas: () => Promise<void>;
  loading: boolean;
}

const EmpresaContext = createContext<EmpresaContextValue | undefined>(undefined);

export function EmpresaProvider({ children }: { children: React.ReactNode }) {
  const [empresa, setEmpresaState] = useState<EmpresaActiva | null>(null);
  const [empresas, setEmpresas] = useState<EmpresaActiva[]>([]);
  const [loading, setLoading] = useState(true);

  const cargarEmpresas = useCallback(async () => {
    try {
      const r = await fetch('/api/empresas');
      const d = await r.json();
      const lista = (d.empresas || []).map((e: any) => ({
        id: e.id, nombre: e.nombre, rfc: e.rfc,
      }));
      setEmpresas(lista);

      if (typeof localStorage !== 'undefined') {
        const guardada = localStorage.getItem('empresa-activa');
        if (guardada) {
          const parsed = JSON.parse(guardada);
          const existe = lista.find((e: any) => e.id === parsed.id);
          if (existe) {
            setEmpresaState(existe);
            setLoading(false);
            return;
          }
        }
      }

      if (lista.length > 0 && !empresa) {
        setEmpresaState(lista[0]);
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem('empresa-activa', JSON.stringify(lista[0]));
        }
      }
    } catch (e) {
      console.error('Error cargando empresas:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    cargarEmpresas();
  }, [cargarEmpresas]);

  const setEmpresa = useCallback((e: EmpresaActiva) => {
    setEmpresaState(e);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('empresa-activa', JSON.stringify(e));
    }
  }, []);

  return (
    <EmpresaContext.Provider value={{ empresa, empresas, setEmpresa, cargarEmpresas, loading }}>
      {children}
    </EmpresaContext.Provider>
  );
}

export function useEmpresa() {
  const ctx = useContext(EmpresaContext);
  if (!ctx) throw new Error('useEmpresa debe usarse dentro de EmpresaProvider');
  return ctx;
}
