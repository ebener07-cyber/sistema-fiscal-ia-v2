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
  setEmpresa: (e: EmpresaActiva | null) => void;
  cargarEmpresas: () => Promise<void>;
  loading: boolean;
}

const EmpresaContext = createContext<EmpresaContextValue>({
  empresa: null,
  empresas: [],
  setEmpresa: () => {},
  cargarEmpresas: async () => {},
  loading: true,
});

export function EmpresaProvider({ children }: { children: React.ReactNode }) {
  const [empresa, setEmpresaState] = useState<EmpresaActiva | null>(null);
  const [empresas, setEmpresas] = useState<EmpresaActiva[]>([]);
  const [loading, setLoading] = useState(true);
  // Versión para forzar re-render cuando cambia la empresa (las vistas dependen de esto)
  const [version, setVersion] = useState(0);

  const cargarEmpresas = useCallback(async () => {
    try {
      const r = await fetch('/api/empresas');
      const d = await r.json();
      const lista = (d.empresas || []).map((e: any) => ({
        id: e.id, nombre: e.nombre, rfc: e.rfc,
      }));
      setEmpresas(lista);

      try {
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
      } catch {}

      if (lista.length > 0) {
        setEmpresaState(lista[0]);
        try {
          localStorage.setItem('empresa-activa', JSON.stringify(lista[0]));
        } catch {}
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

  const setEmpresa = useCallback((e: EmpresaActiva | null) => {
    setEmpresaState(e);
    setVersion(v => v + 1); // Forzar re-render de las vistas que dependen de empresa
    try {
      if (e) {
        localStorage.setItem('empresa-activa', JSON.stringify(e));
      } else {
        localStorage.removeItem('empresa-activa');
      }
    } catch {}
  }, []);

  return (
    <EmpresaContext.Provider value={{ empresa, empresas, setEmpresa, cargarEmpresas, loading, version }}>
      {children}
    </EmpresaContext.Provider>
  );
}

export function useEmpresa() {
  return useContext(EmpresaContext);
}
