"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CheckCircle2, AlertCircle, XCircle, Banknote, Calendar, FileText, Search, RefreshCw, Link2, Unlink, TrendingUp, TrendingDown, DollarSign, Receipt } from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { toast } from "sonner";

interface FacturaDetalle {
  id: string; folio: string; fecha: string; total: number;
  cliente?: string; proveedor?: string; estadoPago: string;
  conciliaciones: { montoConciliado: number; estado: string; fechaConciliacion: string; cuenta: string | null; }[];
}

interface MovimientoDetalle {
  id: string; fecha: string; concepto: string; monto: number;
  tipo: string; estado: string; cuenta: string;
  conciliado: boolean;
  facturaRelacionada: { folio: string; total: number } | null;
}

interface ResumenData {
  cobros: { totalFacturas: number; montoTotal: number; pagadas: number; montoPagado: number; pendientes: number; montoPendiente: number; porcentajePagado: number; };
  pagos: { totalFacturas: number; montoTotal: number; pagadas: number; montoPagado: number; pendientes: number; montoPendiente: number; porcentajePagado: number; };
  bancos: { totalMovimientos: number; totalIngresos: number; totalEgresos: number; conciliados: number; pendientes: number; };
}

const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];

function useEmpresaId() {
  const [empresaId, setEmpresaId] = useState<string>("");
  useEffect(() => { try { const s = localStorage.getItem("empresaId"); if (s) setEmpresaId(s); } catch {} }, []);
  return empresaId;
}

export default function ReportePagosPage() {
  const empresaId = useEmpresaId();
  const [anio, setAnio] = useState<number>(new Date().getFullYear());
  const [mes, setMes] = useState<string>(new Date().getMonth().toString());
  const [cuentaId, setCuentaId] = useState<string>("");
  const [cuentas, setCuentas] = useState<{ id: string; banco: string; cuenta: string }[]>([]);
  const [resumen, setResumen] = useState<ResumenData | null>(null);
  const [facturasEmitidas, setFacturasEmitidas] = useState<FacturaDetalle[]>([]);
  const [facturasRecibidas, setFacturasRecibidas] = useState<FacturaDetalle[]>([]);
  const [movimientos, setMovimientos] = useState<MovimientoDetalle[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTab, setSelectedTab] = useState("cobros");
  const [conciliarOpen, setConciliarOpen] = useState(false);
  const [selectedFactura, setSelectedFactura] = useState<FacturaDetalle | null>(null);
  const [selectedMovimiento, setSelectedMovimiento] = useState("");

  useEffect(() => {
    const p = new URLSearchParams();
    if (empresaId) p.set("empresaId", empresaId);
    fetch(`/api/bancos?${p.toString()}`).then(r => r.json()).then(d => setCuentas(d.cuentas || []));
  }, [empresaId]);

  const cargarDatos = async () => {
    setLoading(true);
    try {
      const p = new URLSearchParams();
      p.set("anio", anio.toString());
      if (mes !== "all") p.set("mes", mes);
      if (cuentaId) p.set("cuentaId", cuentaId);
      if (empresaId) p.set("empresaId", empresaId);

      const res = await fetch(`/api/bancos/reporte-pagos?${p.toString()}`);
      const data = await res.json();
      if (data.error) { toast.error(data.error); return; }
      setResumen(data.resumen);
      setFacturasEmitidas(data.detalle.facturasEmitidas);
      setFacturasRecibidas(data.detalle.facturasRecibidas);
      setMovimientos(data.detalle.movimientosBancarios);
    } catch { toast.error("Error al cargar los datos"); }
    finally { setLoading(false); }
  };

  useEffect(() => { cargarDatos(); }, [anio, mes, cuentaId, empresaId]);

  const handleConciliar = async () => {
    if (!selectedFactura || !selectedMovimiento) return;
    try {
      const res = await fetch("/api/bancos/conciliar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ movimientoId: selectedMovimiento, facturaId: selectedFactura.id }),
      });
      const data = await res.json();
      if (data.success) { toast.success(data.mensaje); setConciliarOpen(false); setSelectedFactura(null); setSelectedMovimiento(""); cargarDatos(); }
      else toast.error(data.error || "Error al conciliar");
    } catch { toast.error("Error de red al conciliar"); }
  };

  const handleDesconciliar = async (movimientoId: string) => {
    try {
      const res = await fetch(`/api/bancos/conciliar?movimientoId=${movimientoId}`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) { toast.success("Desconciliación exitosa"); cargarDatos(); }
      else toast.error(data.error);
    } catch { toast.error("Error al desconciliar"); }
  };

  const fmt = (n: number) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(n);

  const filteredEmitidas = facturasEmitidas.filter(f => {
    const t = searchTerm.toLowerCase();
    return f.folio.toLowerCase().includes(t) || f.cliente?.toLowerCase().includes(t) || f.total.toString().includes(t);
  });
  const filteredRecibidas = facturasRecibidas.filter(f => {
    const t = searchTerm.toLowerCase();
    return f.folio.toLowerCase().includes(t) || f.proveedor?.toLowerCase().includes(t) || f.total.toString().includes(t);
  });
  const movimientosPendientes = movimientos.filter(m => !m.conciliado);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Reporte de Pagos y Conciliación</h1>
          <p className="text-muted-foreground">Visualiza cuántas facturas se han pagado con respecto a los estados de cuenta</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Select value={cuentaId} onValueChange={setCuentaId}>
            <SelectTrigger className="w-[260px]"><Banknote className="mr-2 h-4 w-4" /><SelectValue placeholder="Todas las cuentas" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="">Todas las cuentas</SelectItem>
              {cuentas.map(c => <SelectItem key={c.id} value={c.id}>{c.banco} — {c.cuenta}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={anio.toString()} onValueChange={v => setAnio(parseInt(v))}>
            <SelectTrigger className="w-[110px]"><Calendar className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
            <SelectContent>{[2024,2025,2026,2027].map(a => <SelectItem key={a} value={a.toString()}>{a}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={mes} onValueChange={setMes}>
            <SelectTrigger className="w-[140px]"><Calendar className="mr-2 h-4 w-4" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todo el año</SelectItem>
              {MESES.map((m, i) => <SelectItem key={i} value={i.toString()}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={cargarDatos} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /></Button>
        </div>
      </div>

      {resumen && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-l-4 border-l-emerald-500">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><TrendingUp className="h-4 w-4 text-emerald-500" />Cobros (Facturas Emitidas)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-end">
                <div><p className="text-2xl font-bold">{resumen.cobros.pagadas}</p><p className="text-xs text-muted-foreground">de {resumen.cobros.totalFacturas} facturas</p></div>
                <div className="text-right"><p className="text-lg font-semibold text-emerald-600">{fmt(resumen.cobros.montoPagado)}</p><p className="text-xs text-muted-foreground">de {fmt(resumen.cobros.montoTotal)}</p></div>
              </div>
              <div className="space-y-1"><div className="flex justify-between text-xs"><span>Progreso de cobro</span><span className="font-medium">{resumen.cobros.porcentajePagado}%</span></div><Progress value={resumen.cobros.porcentajePagado} className="h-2" /></div>
              <div className="flex gap-4 text-xs"><div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /><span>{resumen.cobros.pagadas} pagadas</span></div><div className="flex items-center gap-1"><AlertCircle className="h-3 w-3 text-amber-500" /><span>{resumen.cobros.pendientes} pendientes</span></div></div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-red-500">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><TrendingDown className="h-4 w-4 text-red-500" />Pagos (Facturas Recibidas)</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between items-end">
                <div><p className="text-2xl font-bold">{resumen.pagos.pagadas}</p><p className="text-xs text-muted-foreground">de {resumen.pagos.totalFacturas} facturas</p></div>
                <div className="text-right"><p className="text-lg font-semibold text-red-600">{fmt(resumen.pagos.montoPagado)}</p><p className="text-xs text-muted-foreground">de {fmt(resumen.pagos.montoTotal)}</p></div>
              </div>
              <div className="space-y-1"><div className="flex justify-between text-xs"><span>Progreso de pago</span><span className="font-medium">{resumen.pagos.porcentajePagado}%</span></div><Progress value={resumen.pagos.porcentajePagado} className="h-2" /></div>
              <div className="flex gap-4 text-xs"><div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /><span>{resumen.pagos.pagadas} pagadas</span></div><div className="flex items-center gap-1"><AlertCircle className="h-3 w-3 text-amber-500" /><span>{resumen.pagos.pendientes} pendientes</span></div></div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-blue-500">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><DollarSign className="h-4 w-4 text-blue-500" />Ingresos Bancarios</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-2xl font-bold text-blue-600">{fmt(resumen.bancos.totalIngresos)}</p>
              <p className="text-xs text-muted-foreground">{resumen.bancos.totalMovimientos} movimientos totales</p>
              <div className="flex gap-4 text-xs pt-1"><div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-blue-500" /><span>{resumen.bancos.conciliados} conciliados</span></div><div className="flex items-center gap-1"><AlertCircle className="h-3 w-3 text-amber-500" /><span>{resumen.bancos.pendientes} pendientes</span></div></div>
            </CardContent>
          </Card>
          <Card className="border-l-4 border-l-orange-500">
            <CardHeader className="pb-2"><CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2"><Receipt className="h-4 w-4 text-orange-500" />Egresos Bancarios</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-2xl font-bold text-orange-600">{fmt(resumen.bancos.totalEgresos)}</p>
              <p className="text-xs text-muted-foreground">Total de salidas del periodo</p>
              <div className="flex gap-4 text-xs pt-1"><div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /><span>{resumen.cobros.porcentajePagado}% cobrado</span></div><div className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-500" /><span>{resumen.pagos.porcentajePagado}% pagado</span></div></div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
          <TabsList>
            <TabsTrigger value="cobros" className="gap-2"><TrendingUp className="h-4 w-4" />Cobros{resumen && <Badge variant="secondary" className="ml-1">{resumen.cobros.totalFacturas}</Badge>}</TabsTrigger>
            <TabsTrigger value="pagos" className="gap-2"><TrendingDown className="h-4 w-4" />Pagos{resumen && <Badge variant="secondary" className="ml-1">{resumen.pagos.totalFacturas}</Badge>}</TabsTrigger>
            <TabsTrigger value="movimientos" className="gap-2"><Banknote className="h-4 w-4" />Movimientos{resumen && <Badge variant="secondary" className="ml-1">{resumen.bancos.totalMovimientos}</Badge>}</TabsTrigger>
          </TabsList>
          <div className="relative w-full sm:w-[320px]">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input placeholder="Buscar por folio, cliente, proveedor..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="pl-10" />
          </div>
        </div>

        <TabsContent value="cobros">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingUp className="h-5 w-5 text-emerald-500" />Facturas Emitidas — Estado de Cobro</CardTitle>
              <CardDescription>{resumen ? `${resumen.cobros.pagadas} de ${resumen.cobros.totalFacturas} facturas cobradas (${resumen.cobros.porcentajePagado}%)` : "Cargando..."}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Folio</TableHead><TableHead>Fecha</TableHead><TableHead>Cliente</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-center">Estado</TableHead><TableHead>Conciliación</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {filteredEmitidas.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No hay facturas emitidas en este periodo</TableCell></TableRow> : filteredEmitidas.map(f => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono font-medium">{f.folio}</TableCell>
                        <TableCell>{format(new Date(f.fecha), "dd/MM/yyyy", { locale: es })}</TableCell>
                        <TableCell>{f.cliente || "—"}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(f.total)}</TableCell>
                        <TableCell className="text-center">{f.estadoPago === "pagada" ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"><CheckCircle2 className="mr-1 h-3 w-3" />Cobrada</Badge> : <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100"><AlertCircle className="mr-1 h-3 w-3" />Pendiente</Badge>}</TableCell>
                        <TableCell>{f.conciliaciones.length > 0 ? <div className="flex flex-col gap-0.5 text-xs">{f.conciliaciones.map((c, i) => <div key={i} className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-blue-500" /><span>{c.cuenta}</span><span className="text-muted-foreground">({fmt(c.montoConciliado)})</span></div>)}</div> : <span className="text-xs text-muted-foreground">Sin conciliar</span>}</TableCell>
                        <TableCell className="text-right">
                          {f.estadoPago === "pendiente" && (
                            <Dialog open={conciliarOpen && selectedFactura?.id === f.id} onOpenChange={open => { setConciliarOpen(open); if (!open) { setSelectedFactura(null); setSelectedMovimiento(""); } }}>
                              <DialogTrigger asChild><Button size="sm" variant="outline" onClick={() => setSelectedFactura(f)}><Link2 className="mr-1 h-3 w-3" />Conciliar</Button></DialogTrigger>
                              <DialogContent>
                                <DialogHeader><DialogTitle>Conciliar Factura con Movimiento Bancario</DialogTitle><DialogDescription>Factura {f.folio} — {f.cliente} — {fmt(f.total)}</DialogDescription></DialogHeader>
                                <div className="space-y-4">
                                  <p className="text-sm font-medium mb-2">Selecciona un movimiento bancario pendiente:</p>
                                  <div className="max-h-[300px] overflow-y-auto space-y-2">
                                    {movimientosPendientes.length === 0 ? <p className="text-sm text-muted-foreground">No hay movimientos bancarios pendientes para conciliar.</p> : movimientosPendientes.map(m => (
                                      <div key={m.id} onClick={() => setSelectedMovimiento(m.id)} className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedMovimiento === m.id ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-border hover:bg-muted"}`}>
                                        <div className="flex justify-between items-start">
                                          <div><p className="text-sm font-medium">{m.concepto}</p><p className="text-xs text-muted-foreground">{format(new Date(m.fecha), "dd/MM/yyyy")} — {m.cuenta}</p></div>
                                          <p className={`text-sm font-bold ${m.tipo === "ingreso" ? "text-emerald-600" : "text-red-600"}`}>{fmt(m.monto)}</p>
                                        </div>
                                        {Math.abs(m.monto) !== f.total && <p className="text-xs text-amber-600 mt-1">Diferencia: {fmt(Math.abs(Math.abs(m.monto) - f.total))}</p>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <DialogFooter><Button onClick={handleConciliar} disabled={!selectedMovimiento || movimientosPendientes.length === 0}><Link2 className="mr-2 h-4 w-4" />Conciliar</Button></DialogFooter>
                              </DialogContent>
                            </Dialog>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pagos">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><TrendingDown className="h-5 w-5 text-red-500" />Facturas Recibidas — Estado de Pago</CardTitle>
              <CardDescription>{resumen ? `${resumen.pagos.pagadas} de ${resumen.pagos.totalFacturas} facturas pagadas (${resumen.pagos.porcentajePagado}%)` : "Cargando..."}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Folio</TableHead><TableHead>Fecha</TableHead><TableHead>Proveedor</TableHead><TableHead className="text-right">Total</TableHead><TableHead className="text-center">Estado</TableHead><TableHead>Conciliación</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {filteredRecibidas.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No hay facturas recibidas en este periodo</TableCell></TableRow> : filteredRecibidas.map(f => (
                      <TableRow key={f.id}>
                        <TableCell className="font-mono font-medium">{f.folio}</TableCell>
                        <TableCell>{format(new Date(f.fecha), "dd/MM/yyyy", { locale: es })}</TableCell>
                        <TableCell>{f.proveedor || "—"}</TableCell>
                        <TableCell className="text-right font-mono">{fmt(f.total)}</TableCell>
                        <TableCell className="text-center">{f.estadoPago === "pagada" ? <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100"><CheckCircle2 className="mr-1 h-3 w-3" />Pagada</Badge> : <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100"><AlertCircle className="mr-1 h-3 w-3" />Pendiente</Badge>}</TableCell>
                        <TableCell>{f.conciliaciones.length > 0 ? <div className="flex flex-col gap-0.5 text-xs">{f.conciliaciones.map((c, i) => <div key={i} className="flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-blue-500" /><span>{c.cuenta}</span><span className="text-muted-foreground">({fmt(c.montoConciliado)})</span></div>)}</div> : <span className="text-xs text-muted-foreground">Sin conciliar</span>}</TableCell>
                        <TableCell className="text-right">
                          {f.estadoPago === "pendiente" && (
                            <Dialog open={conciliarOpen && selectedFactura?.id === f.id} onOpenChange={open => { setConciliarOpen(open); if (!open) { setSelectedFactura(null); setSelectedMovimiento(""); } }}>
                              <DialogTrigger asChild><Button size="sm" variant="outline" onClick={() => setSelectedFactura(f)}><Link2 className="mr-1 h-3 w-3" />Conciliar</Button></DialogTrigger>
                              <DialogContent>
                                <DialogHeader><DialogTitle>Conciliar Factura con Movimiento Bancario</DialogTitle><DialogDescription>Factura {f.folio} — {f.proveedor} — {fmt(f.total)}</DialogDescription></DialogHeader>
                                <div className="space-y-4">
                                  <p className="text-sm font-medium mb-2">Selecciona un movimiento bancario pendiente:</p>
                                  <div className="max-h-[300px] overflow-y-auto space-y-2">
                                    {movimientosPendientes.length === 0 ? <p className="text-sm text-muted-foreground">No hay movimientos bancarios pendientes para conciliar.</p> : movimientosPendientes.map(m => (
                                      <div key={m.id} onClick={() => setSelectedMovimiento(m.id)} className={`p-3 rounded-lg border cursor-pointer transition-colors ${selectedMovimiento === m.id ? "border-blue-500 bg-blue-50 dark:bg-blue-950" : "border-border hover:bg-muted"}`}>
                                        <div className="flex justify-between items-start">
                                          <div><p className="text-sm font-medium">{m.concepto}</p><p className="text-xs text-muted-foreground">{format(new Date(m.fecha), "dd/MM/yyyy")} — {m.cuenta}</p></div>
                                          <p className={`text-sm font-bold ${m.tipo === "ingreso" ? "text-emerald-600" : "text-red-600"}`}>{fmt(m.monto)}</p>
                                        </div>
                                        {Math.abs(m.monto) !== f.total && <p className="text-xs text-amber-600 mt-1">Diferencia: {fmt(Math.abs(Math.abs(m.monto) - f.total))}</p>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                                <DialogFooter><Button onClick={handleConciliar} disabled={!selectedMovimiento || movimientosPendientes.length === 0}><Link2 className="mr-2 h-4 w-4" />Conciliar</Button></DialogFooter>
                              </DialogContent>
                            </Dialog>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="movimientos">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Banknote className="h-5 w-5 text-blue-500" />Movimientos Bancarios</CardTitle>
              <CardDescription>{resumen ? `${resumen.bancos.conciliados} conciliados, ${resumen.bancos.pendientes} pendientes` : "Cargando..."}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border">
                <Table>
                  <TableHeader><TableRow><TableHead>Fecha</TableHead><TableHead>Concepto</TableHead><TableHead>Cuenta</TableHead><TableHead className="text-right">Monto</TableHead><TableHead className="text-center">Tipo</TableHead><TableHead>Factura</TableHead><TableHead className="text-center">Estado</TableHead><TableHead className="text-right">Acciones</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {movimientos.length === 0 ? <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No hay movimientos bancarios en este periodo</TableCell></TableRow> : movimientos.map(m => (
                      <TableRow key={m.id}>
                        <TableCell>{format(new Date(m.fecha), "dd/MM/yyyy", { locale: es })}</TableCell>
                        <TableCell className="max-w-[200px] truncate">{m.concepto}</TableCell>
                        <TableCell className="text-xs">{m.cuenta}</TableCell>
                        <TableCell className={`text-right font-mono font-medium ${m.tipo === "ingreso" ? "text-emerald-600" : "text-red-600"}`}>{fmt(m.monto)}</TableCell>
                        <TableCell className="text-center"><Badge variant="outline" className={m.tipo === "ingreso" ? "border-emerald-500 text-emerald-600" : "border-red-500 text-red-600"}>{m.tipo === "ingreso" ? "Ingreso" : "Egreso"}</Badge></TableCell>
                        <TableCell>{m.facturaRelacionada ? <div className="flex items-center gap-1 text-xs"><FileText className="h-3 w-3 text-blue-500" /><span className="font-medium">{m.facturaRelacionada.folio}</span><span className="text-muted-foreground">({fmt(m.facturaRelacionada.total)})</span></div> : <span className="text-xs text-muted-foreground">—</span>}</TableCell>
                        <TableCell className="text-center">{m.conciliado ? <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-100"><CheckCircle2 className="mr-1 h-3 w-3" />Conciliado</Badge> : <Badge variant="secondary" className="bg-amber-100 text-amber-700 hover:bg-amber-100"><AlertCircle className="mr-1 h-3 w-3" />Pendiente</Badge>}</TableCell>
                        <TableCell className="text-right">{m.conciliado && <Button size="sm" variant="ghost" onClick={() => handleDesconciliar(m.id)}><Unlink className="h-4 w-4 text-red-500" /></Button>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
