import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/proyectos/detalle?id=xxx
 *
 * Devuelve el detalle completo de un proyecto con:
 * - Datos del proyecto (incluyendo datos del contrato)
 * - Cliente asociado
 * - Todas las facturas emitidas/recibidas asociadas
 * - Movimientos bancarios conciliados
 * - Resumen financiero (facturado, cobrado, pendiente, % avance)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Falta id del proyecto' }, { status: 400 });
    }

    const proyecto = await db.proyecto.findUnique({
      where: { id },
      include: {
        cliente: { select: { id: true, nombre: true, rfc: true, email: true, telefono: true } },
        facturas: {
          select: {
            id: true, folio: true, serie: true, fecha: true,
            subtotal: true, totalImpuestos: true, total: true,
            tipoComprobante: true, estado: true, direccion: true,
            receptorNombre: true, emisorNombre: true,
            uuid: true, concepto: true,
          },
          orderBy: { fecha: 'desc' },
        },
      },
    });

    if (!proyecto) {
      return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
    }

    // Calcular resumen financiero
    const facturasEmitidas = proyecto.facturas.filter(f => f.direccion === 'emitida' && f.tipoComprobante === 'I' && f.estado === 'timbrada');
    const facturasRecibidas = proyecto.facturas.filter(f => f.direccion === 'recibida' && f.tipoComprobante === 'I' && f.estado === 'timbrada');
    const notasCredito = proyecto.facturas.filter(f => f.tipoComprobante === 'E');

    const totalFacturado = facturasEmitidas.reduce((s, f) => s + f.total, 0);
    const totalRecibido = facturasRecibidas.reduce((s, f) => s + f.total, 0);
    const totalNotasCredito = notasCredito.reduce((s, f) => s + f.total, 0);

    // Buscar movimientos bancarios conciliados con facturas de este proyecto
    const facturaIds = proyecto.facturas.map(f => f.id);
    const movimientosConciliados = await db.movimientoBanco.findMany({
      where: {
        facturaConciliadaId: { in: facturaIds },
      },
      include: {
        cuenta: { select: { banco: true, cuenta: true } },
        facturaConciliada: { select: { folio: true, serie: true, total: true } },
      },
      orderBy: { fecha: 'desc' },
    });

    const totalCobrado = movimientosConciliados
      .filter(m => m.monto > 0)
      .reduce((s, m) => s + m.monto, 0);

    const montoPendiente = (proyecto.contratoMonto || proyecto.presupuesto) - totalFacturado;
    const porcentajeAvance = (proyecto.contratoMonto || proyecto.presupuesto) > 0
      ? (totalFacturado / (proyecto.contratoMonto || proyecto.presupuesto) * 100)
      : 0;

    // Actualizar proyecto con montos calculados
    await db.proyecto.update({
      where: { id: proyecto.id },
      data: {
        montoFacturado: totalFacturado,
        montoCobrado: totalCobrado,
        montoPendiente: montoPendiente,
        porcentajeAvance: Math.min(100, Math.round(porcentajeAvance * 10) / 10),
      },
    });

    return NextResponse.json({
      proyecto: {
        ...proyecto,
        porcentajeAvance: Math.min(100, Math.round(porcentajeAvance * 10) / 10),
      },
      resumen: {
        totalFacturado,
        totalRecibido,
        totalNotasCredito,
        totalCobrado,
        montoPendiente,
        montoContrato: proyecto.contratoMonto || proyecto.presupuesto,
        porcentajeAvance: Math.min(100, Math.round(porcentajeAvance * 10) / 10),
        porcentajeCobrado: totalFacturado > 0 ? Math.round((totalCobrado / totalFacturado) * 100) : 0,
        countFacturasEmitidas: facturasEmitidas.length,
        countFacturasRecibidas: facturasRecibidas.length,
        countNotasCredito: notasCredito.length,
        countMovimientosConciliados: movimientosConciliados.length,
      },
      facturasEmitidas,
      facturasRecibidas,
      notasCredito,
      movimientosConciliados,
    });
  } catch (e: any) {
    console.error('Error en /api/proyectos/detalle:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
