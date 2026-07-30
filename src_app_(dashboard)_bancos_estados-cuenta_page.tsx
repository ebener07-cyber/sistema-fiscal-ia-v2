"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowDownLeft, ArrowUpRight, CheckCircle2, AlertCircle, Calendar, Banknote, FileText, Search, RefreshCw } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

interface Movimiento {
  id: string; fecha: string; concepto: string; monto: number;
  tipo: "ingreso" | "egreso" | "transferencia"; estado: string;
  conciliacion?: {
    id: string; factura?: { id: string; folio: string; total: number; uuid: string; receptorNombre: string; emisorNombre: string; direccion: string; };
    estado: string; diferencia: number; observaciones: string;
  };
}

interface MesData {
  mesIndex: number; mes: string; movimientos: Movimiento[];
  totalIngresos: number; totalEgresos: number;
  saldoInicial: number; saldoFinal: number;
  conciliados: number; pendientes: number;
}

interface CuentaInfo {
  id: string; banco: string; cuenta: string; tipo: string; saldoActual: number;
}

interface ResumenAnual {
  anio: number; saldoInicial: number; saldoFinal: number;
  totalIngresos: number; totalEgresos: number;
  totalMovimientos: number; totalConciliados: number; totalPendientes: number;
}

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function useEmpresaId() {
  const [empresaId, setEmpresaId] = useState<string>("");
  useEffect(() => {
    try {
      const stored = localStorage.getItem("empresaId");
      if (stored) setEmpresaId(stored);
    } catch {}
  }, []);
  return empresaId;
}

export default function EstadosCuentaPage() {
  const searchParams = useSearchParams();
  const cuentaIdParam = searchParams.get("cuentaId");
  const empresaId = useEmpresaId();

  const [cuentaId, setCuentaId] = useState<string>(cuentaIdParam || "");
  const [cuentas, setCuentas] = useState<{ id: string; banco: string; cuenta: string }[]>([]);
  const [anio, setAnio] = useState<number>(new Date().getFullYear());
  const [mesesData, setMesesData] = useState<MesData[]>([]);
  const [cuentaInfo, setCuentaInfo] = useState<CuentaInfo | null>(null);
  const [resumen, setResumen] = useState<ResumenAnual | null>(null);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedMes, setSelectedMes] = useState<string>(new Date().getMonth().toString());

  useEffect(() => {
    const params = new URLSearchParams();
    if (empresaId) params.set("empresaId", empresaId);
    fetch(`/api/bancos?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setCuentas(data.cuentas || []);
        if (!cuentaId && data.cuentas?.length > 0) {
          setCuentaId(data.cuentas[0].id);
        }
      });
  }, [empresaId]);

  useEffect(() => {
    if (!cuentaId) return;
    setLoading(true);
    const params = new URLSearchParams();
    params.set("anio", anio.toString());
    if (empresaId) params.set("empresaId", empresaId);

    fetch(`/api/bancos/${cuentaId}/estados-cuenta?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        setMesesData(data.meses || []);
        setCuentaInfo(data.cuenta);
        setResumen(data.resumenAnual);
        const mesActual = new Date().getMonth();
        const mesConDatos = data.meses?.find((m: MesData) => m.mesIndex === mesActual)
          ? mesActual.toString()
          : data.meses?.length > 0
          ? data.meses[data.meses.length - 1].mesIndex.toString()
          : "0";
        setSelectedMes(mesConDatos);
      })
      .finally(() => setLoading(false));
  }, [cuentaId, anio, empresaId]);

  const mesActual = mesesData.find((m) => m.mesIndex.toString() === selectedMes);

  const filteredMovimientos = mesActual?.movimientos.filter((m) => {
    const term = searchTerm.toLowerCase();
    return (
      m.concepto.toLowerCase().includes(term) ||
      m.monto.toString().includes(term) ||
      m.conciliacion?.factura?.folio?.toLowerCase().includes(term) ||
      format(new Date(m.fecha), "dd/MM/yyyy").includes(term)
    );
  }) || [];

  const fmt = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Estados de Cuenta Bancarios</h1>
          <p className="text-muted-foreground">Visualiza el comportamiento mensual de cada cuenta bancaria</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={cuentaId} onValueChange={setCuentaId}>
            <SelectTrigger className="w-[280px]">
              <Banknote className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Selecciona una cuenta" />
            </SelectTrigger>
            <SelectContent>
              {cuentas.map((c) => (
                <SelectItem key={c.id} value={c.id}>{c.banco} — {c.cuenta}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={anio.toString()} onValueChange={(v) => setAnio(parseInt(v))}>
            <SelectTrigger className="w-[120px]"><Calendar className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
            <SelectContent>
              {[2024,2025,2026,2027].map((a) => <SelectItem key={a} value={a.toString()}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => window.location.reload()}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      {cuentaInfo && (
        <Card className="bg-gradient-to-r from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
          <CardContent className="flex flex-wrap gap-6 py-4">
            <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Cuenta</p><p className="text-lg font-semibold">{cuentaInfo.banco} — {cuentaInfo.cuenta}</p></div>
            <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Tipo</p><p className="text-lg font-semibold capitalize">{cuentaInfo.tipo}</p></div>
            <div><p className="text-xs text-muted-foreground uppercase tracking-wider">Saldo Actual</p><p className="text-lg font-semibold text-emerald-600">{fmt(cuentaInfo.saldoActual)}</p></div>
          </CardContent>
        </Card>
      )}

      {resumen && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Saldo Inicial</p><p className="text-lg font-bold">{fmt(resumen.saldoInicial)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Ingresos</p><p className="text-lg font-bold text-emerald-600">{fmt(resumen.totalIngresos)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Egresos</p><p className="text-lg font-bold text-red-600">{fmt(resumen.totalEgresos)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Saldo Final</p><p className="text-lg font-bold">{fmt(resumen.saldoFinal)}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Movimientos</p><p className="text-lg font-bold">{resumen.totalMovimientos}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Conciliados</p><p className="text-lg font-bold text-blue-600">{resumen.totalConciliados}</p></CardContent></Card>
          <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Pendientes</p><p className="text-lg font-bold text-amber-600">{resumen.totalPendientes}</p></CardContent></Card>
        </div>
      )}

      {mesesData.length > 0 ? (
        <Tabs value={selectedMes} onValueChange={setSelectedMes}>
          <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1">
            {mesesData.map((mes) => (
              <TabsTrigger key={mes.mesIndex} value={mes.mesIndex.toString()} className="relative data-[state=active]:bg-background data-[state=active]:shadow-sm">
                {mes.mes}
                {mes.pendientes > 0 && (
                  <span className="ml-1.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">{mes.pendientes}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>

          {mesesData.map((mes) => (
            <TabsContent key={mes.mesIndex} value={mes.mesIndex.toString()} className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Saldo Inicial</p><p className="text-base font-bold">{fmt(mes.saldoInicial)}</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Ingresos</p><p className="text-base font-bold text-emerald-600">{fmt(mes.totalIngresos)}</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Egresos</p><p className="text-base font-bold text-red-600">{fmt(mes.totalEgresos)}</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Saldo Final</p><p className="text-base font-bold">{fmt(mes.saldoFinal)}</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Conciliados</p><p className="text-base font-bold text-blue-600">{mes.conciliados}</p></CardContent></Card>
                <Card><CardContent className="pt-4"><p className="text-xs text-muted-foreground">Pendientes</p><p className="text-base font-bold text-amber-600">{mes.pendientes}</p></CardContent></Card>
              </div>

              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar por concepto, monto, fecha o folio..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Movimientos de {mes.mes} — {mes.movimientos.length} registros{searchTerm && ` (${filteredMovimientos.length} filtrados)`}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[100px]">Fecha</TableHead>
                          <TableHead>Concepto</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                          <TableHead className="text-center">Tipo</TableHead>
                          <TableHead>Factura Relacionada</TableHead>
                          <TableHead className="text-center">Estado</TableHead>
                          <TableHead className="text-right">Detalle</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredMovimientos.length === 0 ? (
                          <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">{mes.movimientos.length === 0 ? "No hay movimientos este mes" : "No se encontraron resultados"}</TableCell></TableRow>
                        ) : (
                          filteredMovimientos.map((mov) => (
                            <TableRow key={mov.id}>
                              <TableCell className="font-mono text-sm">{format(new Date(mov.fecha), "dd/MM/yyyy", { locale: es })}</TableCell>
                              <TableCell className="max-w-[300px] truncate">{mov.concepto}</TableCell>
                              <TableCell className={`text-right font-mono font-medium ${mov.tipo === "ingreso" ? "text-emerald-600" : mov.tipo === "egreso" ? "text-red-600" : "text-blue-600"}`}>
                                {mov.tipo === "ingreso" ? "+" : mov.tipo === "egreso" ? "-" : ""}{fmt(Math.abs(mov.monto))}
                              </TableCell>
                              <TableCell className="text-center">
                                {mov.tipo === "ingreso" ? (
                                  <Badge variant="outline" className="border-emerald-500 text-emerald-600"><ArrowDownLeft className="mr-1 h-3 w-3" />Ingreso</Badge>
                                ) : mov.tipo === "egreso" ? (
                                  <Badge variant="outline" className="border-red-500 text-red-600"><ArrowUpRight className="mr-1 h-3 w-3" />Egreso</Badge>
                                ) : (
                                  <Badge variant="outline" className="border-blue-500 text-blue-600">Transferencia</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                {mov.conciliacion?.factura ? (
                                  <div className="flex flex-col gap-0.5">
                                    <span className="text-sm font-medium">{mov.conciliacion.factura.folio}</span>
                                    <span className="text-xs text-muted-foreground">{mov.conciliacion.factura.direccion === "emitida" ? `Cliente: ${mov.conciliacion.factura.receptorNombre}` : `Proveedor: ${mov.conciliacion.factura.emisorNombre}`}</span>
                                    {mov.conciliacion.diferencia > 0 && <span className="text-xs text-red-500">Dif: {fmt(mov.conciliacion.diferencia)}</span>}
                                  </div>
                                ) : <span className="text-sm text-muted-foreground">Sin conciliar</span>}
                              </TableCell>
                              <TableCell className="text-center">
                                {mov.conciliacion ? (
                                  <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100"><CheckCircle2 className="mr-1 h-3 w-3" />Conciliado</Badge>
                                ) : (
                                  <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100"><AlertCircle className="mr-1 h-3 w-3" />Pendiente</Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button variant="ghost" size="sm"><FileText className="h-4 w-4" /></Button>
                                  </DialogTrigger>
                                  <DialogContent>
                                    <DialogHeader>
                                      <DialogTitle>Detalle del Movimiento</DialogTitle>
                                      <DialogDescription>{mov.concepto}</DialogDescription>
                                    </DialogHeader>
                                    <div className="space-y-3 text-sm">
                                      <div className="grid grid-cols-2 gap-4">
                                        <div><p className="text-muted-foreground">Fecha</p><p className="font-medium">{format(new Date(mov.fecha), "dd 'de' MMMM 'de' yyyy", { locale: es })}</p></div>
                                        <div><p className="text-muted-foreground">Monto</p><p className="font-medium">{fmt(mov.monto)}</p></div>
                                      </div>
                                      <div><p className="text-muted-foreground">Concepto</p><p className="font-medium">{mov.concepto}</p></div>
                                      {mov.conciliacion && (
                                        <div className="rounded-lg bg-muted p-3 space-y-2">
                                          <p className="font-medium">Conciliación</p>
                                          <div className="grid grid-cols-2 gap-2 text-xs">
                                            <div><p className="text-muted-foreground">Estado</p><p className="font-medium capitalize">{mov.conciliacion.estado}</p></div>
                                            <div><p className="text-muted-foreground">Monto Conciliado</p><p className="font-medium">{fmt(mov.conciliacion.diferencia > 0 ? Math.abs(mov.monto) - mov.conciliacion.diferencia : Math.abs(mov.monto))}</p></div>
                                            {mov.conciliacion.diferencia > 0 && <div className="col-span-2"><p className="text-muted-foreground">Diferencia</p><p className="font-medium text-red-600">{fmt(mov.conciliacion.diferencia)}</p></div>}
                                            {mov.conciliacion.observaciones && <div className="col-span-2"><p className="text-muted-foreground">Observaciones</p><p>{mov.conciliacion.observaciones}</p></div>}
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  </DialogContent>
                                </Dialog>
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      ) : loading ? (
        <div className="flex items-center justify-center py-20"><RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" /></div>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Banknote className="h-12 w-12 mb-4 opacity-50" />
            <p className="text-lg font-medium">Selecciona una cuenta bancaria</p>
            <p className="text-sm">Elige una cuenta para ver sus estados de cuenta mensuales</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
