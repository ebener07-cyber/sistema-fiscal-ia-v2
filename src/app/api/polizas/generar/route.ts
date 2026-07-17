import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/polizas/generar
 * Body: { empresaId, mes, anio }
 *
 * Genera pólizas contables automáticamente desde:
 *   - Facturas emitidas → Póliza de Ingreso
 *   - Facturas recibidas → Póliza de Egreso
 *   - Nómina → Póliza de Nómina
 *
 * Cada póliza tiene:
 *   - Folio auto-generado (ej: ING-2026-001)
 *   - Tipo: ingreso | egreso | diario | nomina
 *   - Concepto descriptivo
 *   - Cargo y Abono balanceados
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { empresaId, mes, anio } = body;

    if (!empresaId || !mes || !anio) {
      return NextResponse.json(
        { error: 'empresaId, mes y anio son obligatorios' },
        { status: 400 }
      );
    }

    const inicio = new Date(anio, mes - 1, 1);
    const fin = new Date(anio, mes, 0, 23, 59, 59);

    // Obtener facturas del mes
    const facturasEmitidas = await db.factura.findMany({
      where: {
        empresaId,
        direccion: 'emitida',
        tipoComprobante: { in: ['I', 'E'] },
        fecha: { gte: inicio, lte: fin },
        estado: { not: 'cancelada' },
      },
    });

    const facturasRecibidas = await db.factura.findMany({
      where: {
        empresaId,
        direccion: 'recibida',
        tipoComprobante: { in: ['I', 'E'] },
        fecha: { gte: inicio, lte: fin },
        estado: { not: 'cancelada' },
      },
    });

    const nominas = await db.reciboNomina.findMany({
      where: {
        empresaId,
        fecha: { gte: inicio, lte: fin },
      },
    });

    // Contar pólizas existentes para generar folios
    const polizasExistentes = await db.poliza.count();

    let folioCounter = polizasExistentes + 1;
    const polizasCreadas: any[] = [];

    // ===== PÓLIZA DE INGRESOS (facturas emitidas) =====
    if (facturasEmitidas.length > 0) {
      const totalIngresos = facturasEmitidas
        .filter(f => f.tipoComprobante === 'I')
        .reduce((s, f) => s + f.total, 0);
      const totalNC = facturasEmitidas
        .filter(f => f.tipoComprobante === 'E')
        .reduce((s, f) => s + f.total, 0);
      const ivaTrasladado = facturasEmitidas
        .filter(f => f.tipoComprobante === 'I')
        .reduce((s, f) => s + f.totalImpuestos, 0);

      const totalNeto = totalIngresos - totalNC;

      const poliza = await db.poliza.create({
        data: {
          folio: `ING-${anio}-${String(folioCounter).padStart(3, '0')}`,
          fecha: inicio,
          tipo: 'ingreso',
          concepto: `Ingresos del mes — ${facturasEmitidas.length} factura(s) emitida(s)`,
          cargo: totalNeto - ivaTrasladado, // Bancos/Caja
          abono: totalNeto, // Ventas + IVA
          estado: 'conciliada',
        },
      });
      polizasCreadas.push(poliza);
      folioCounter++;
    }

    // ===== PÓLIZA DE EGRESOS (facturas recibidas) =====
    if (facturasRecibidas.length > 0) {
      const totalEgresos = facturasRecibidas
        .filter(f => f.tipoComprobante === 'I')
        .reduce((s, f) => s + f.total, 0);
      const totalNC = facturasRecibidas
        .filter(f => f.tipoComprobante === 'E')
        .reduce((s, f) => s + f.total, 0);
      const ivaAcreditable = facturasRecibidas
        .filter(f => f.tipoComprobante === 'I')
        .reduce((s, f) => s + f.totalImpuestos, 0);

      const totalNeto = totalEgresos - totalNC;

      const poliza = await db.poliza.create({
        data: {
          folio: `EGR-${anio}-${String(folioCounter).padStart(3, '0')}`,
          fecha: inicio,
          tipo: 'egreso',
          concepto: `Egresos del mes — ${facturasRecibidas.length} factura(s) recibida(s)`,
          cargo: totalNeto - ivaAcreditable, // Gastos
          abono: totalNeto, // Bancos/Caja
          estado: 'conciliada',
        },
      });
      polizasCreadas.push(poliza);
      folioCounter++;
    }

    // ===== PÓLIZA DE NÓMINA =====
    if (nominas.length > 0) {
      const totalPercepciones = nominas.reduce((s, n) => s + n.totalPercepciones, 0);
      const totalDeducciones = nominas.reduce((s, n) => s + n.totalDeducciones, 0);
      const totalNeto = nominas.reduce((s, n) => s + n.neto, 0);

      const poliza = await db.poliza.create({
        data: {
          folio: `NOM-${anio}-${String(folioCounter).padStart(3, '0')}`,
          fecha: inicio,
          tipo: 'diario',
          concepto: `Nómina del mes — ${nominas.length} recibo(s)`,
          cargo: totalPercepciones, // Sueldos y salarios
          abono: totalNeto + totalDeducciones, // Bancos + Impuestos por retener
          estado: 'conciliada',
        },
      });
      polizasCreadas.push(poliza);
      folioCounter++;
    }

    return NextResponse.json({
      success: true,
      polizasCreadas: polizasCreadas.length,
      detalle: polizasCreadas.map(p => ({
        folio: p.folio,
        tipo: p.tipo,
        concepto: p.concepto,
        cargo: p.cargo,
        abono: p.abono,
      })),
      message: `✅ ${polizasCreadas.length} póliza(s) generada(s) para ${mes}/${anio}`,
    });
  } catch (e: any) {
    console.error('Error en /api/polizas/generar:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
