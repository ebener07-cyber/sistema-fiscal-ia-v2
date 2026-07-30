import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// GET /api/bancos/reporte-pagos?anio=2026&mes=7&cuentaId=xxx&empresaId=xxx
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get("empresaId") || undefined;
    const anio = parseInt(searchParams.get("anio") || new Date().getFullYear().toString());
    const mesParam = searchParams.get("mes");
    const mes = mesParam ? parseInt(mesParam) : null;
    const cuentaId = searchParams.get("cuentaId") || null;

    let fechaInicio: Date;
    let fechaFin: Date;
    if (mes !== null) {
      fechaInicio = new Date(anio, mes, 1);
      fechaFin = new Date(anio, mes + 1, 0, 23, 59, 59, 999);
    } else {
      fechaInicio = new Date(`${anio}-01-01`);
      fechaFin = new Date(`${anio}-12-31T23:59:59.999Z`);
    }

    const whereFactura: any = {
      ...(empresaId ? { empresaId } : {}),
      fecha: { gte: fechaInicio, lte: fechaFin },
    };

    // Facturas emitidas (cobros esperados)
    const facturasEmitidas = await db.factura.findMany({
      where: { ...whereFactura, direccion: "emitida" },
      include: {
        cliente: { select: { nombre: true, rfc: true } },
        conciliaciones: {
          include: {
            movimiento: {
              include: { cuenta: { select: { banco: true, cuenta: true } } },
            },
          },
        },
      },
      orderBy: { fecha: "desc" },
    });

    // Facturas recibidas (pagos realizados)
    const facturasRecibidas = await db.factura.findMany({
      where: { ...whereFactura, direccion: "recibida" },
      include: {
        proveedor: { select: { nombre: true, rfc: true } },
        conciliaciones: {
          include: {
            movimiento: {
              include: { cuenta: { select: { banco: true, cuenta: true } } },
            },
          },
        },
      },
      orderBy: { fecha: "desc" },
    });

    // Movimientos bancarios
    const whereMov: any = {
      fecha: { gte: fechaInicio, lte: fechaFin },
      ...(cuentaId ? { cuentaId } : {}),
      ...(empresaId ? { cuenta: { empresaId } } : {}),
    };

    const movimientos = await db.movimientoBanco.findMany({
      where: whereMov,
      include: {
        cuenta: { select: { banco: true, cuenta: true } },
        conciliacion: {
          include: {
            factura: { select: { folio: true, total: true } },
          },
        },
      },
      orderBy: { fecha: "desc" },
    });

    // Métricas
    const totalEmitidas = facturasEmitidas.length;
    const montoTotalEmitidas = facturasEmitidas.reduce((a, f) => a + f.total, 0);
    const emitidasPagadas = facturasEmitidas.filter(f => f.conciliaciones.length > 0);
    const emitidasPendientes = facturasEmitidas.filter(f => f.conciliaciones.length === 0);
    const montoPagadoEmitidas = emitidasPagadas.reduce((a, f) => a + f.total, 0);
    const montoPendienteEmitidas = emitidasPendientes.reduce((a, f) => a + f.total, 0);

    const totalRecibidas = facturasRecibidas.length;
    const montoTotalRecibidas = facturasRecibidas.reduce((a, f) => a + f.total, 0);
    const recibidasPagadas = facturasRecibidas.filter(f => f.conciliaciones.length > 0);
    const recibidasPendientes = facturasRecibidas.filter(f => f.conciliaciones.length === 0);
    const montoPagadoRecibidas = recibidasPagadas.reduce((a, f) => a + f.total, 0);
    const montoPendienteRecibidas = recibidasPendientes.reduce((a, f) => a + f.total, 0);

    const movimientosIngreso = movimientos.filter(m => m.tipo === "ingreso");
    const movimientosEgreso = movimientos.filter(m => m.tipo === "egreso");
    const totalIngresos = movimientosIngreso.reduce((a, m) => a + m.monto, 0);
    const totalEgresos = movimientosEgreso.reduce((a, m) => a + m.monto, 0);

    return NextResponse.json({
      periodo: { anio, mes: mes !== null ? mes + 1 : null },
      resumen: {
        cobros: {
          totalFacturas: totalEmitidas, montoTotal: montoTotalEmitidas,
          pagadas: emitidasPagadas.length, montoPagado: montoPagadoEmitidas,
          pendientes: emitidasPendientes.length, montoPendiente: montoPendienteEmitidas,
          porcentajePagado: totalEmitidas > 0 ? Math.round((emitidasPagadas.length / totalEmitidas) * 100) : 0,
        },
        pagos: {
          totalFacturas: totalRecibidas, montoTotal: montoTotalRecibidas,
          pagadas: recibidasPagadas.length, montoPagado: montoPagadoRecibidas,
          pendientes: recibidasPendientes.length, montoPendiente: montoPendienteRecibidas,
          porcentajePagado: totalRecibidas > 0 ? Math.round((recibidasPagadas.length / totalRecibidas) * 100) : 0,
        },
        bancos: {
          totalMovimientos: movimientos.length,
          totalIngresos, totalEgresos,
          conciliados: movimientos.filter(m => m.conciliacion).length,
          pendientes: movimientos.filter(m => !m.conciliacion).length,
        },
      },
      detalle: {
        facturasEmitidas: facturasEmitidas.map(f => ({
          id: f.id, folio: f.folio, fecha: f.fecha, total: f.total,
          cliente: f.cliente?.nombre,
          estadoPago: f.conciliaciones.length > 0 ? "pagada" : "pendiente",
          conciliaciones: f.conciliaciones.map(c => ({
            montoConciliado: c.montoConciliado, estado: c.estado,
            fechaConciliacion: c.conciliadoEn,
            cuenta: c.movimiento?.cuenta ? `${c.movimiento.cuenta.banco} - ${c.movimiento.cuenta.cuenta}` : null,
          })),
        })),
        facturasRecibidas: facturasRecibidas.map(f => ({
          id: f.id, folio: f.folio, fecha: f.fecha, total: f.total,
          proveedor: f.proveedor?.nombre,
          estadoPago: f.conciliaciones.length > 0 ? "pagada" : "pendiente",
          conciliaciones: f.conciliaciones.map(c => ({
            montoConciliado: c.montoConciliado, estado: c.estado,
            fechaConciliacion: c.conciliadoEn,
            cuenta: c.movimiento?.cuenta ? `${c.movimiento.cuenta.banco} - ${c.movimiento.cuenta.cuenta}` : null,
          })),
        })),
        movimientosBancarios: movimientos.map(m => ({
          id: m.id, fecha: m.fecha, concepto: m.concepto,
          monto: m.monto, tipo: m.tipo, estado: m.estado,
          cuenta: `${m.cuenta.banco} - ${m.cuenta.cuenta}`,
          conciliado: !!m.conciliacion,
          facturaRelacionada: m.conciliacion?.factura
            ? { folio: m.conciliacion.factura.folio, total: m.conciliacion.factura.total }
            : null,
        })),
      },
    });
  } catch (error: any) {
    console.error("Error reporte-pagos:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
