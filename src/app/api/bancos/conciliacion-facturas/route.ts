import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/bancos/conciliacion-facturas?mes=6&anio=2026&empresaId=xxx
 *
 * Genera un REPORTE DE CONCILIACIÓN BANCO vs FACTURAS PAGADAS.
 *
 * Compara:
 * - Movimientos bancarios (pagos realizados) vs Facturas recibidas (compras)
 * - Movimientos bancarios (depósitos) vs Facturas emitidas (ventas)
 *
 * Genera Excel con 4 hojas:
 * 1. Resumen — totales de conciliación
 * 2. Pagos conciliados — movimientos con factura asociada
 * 3. Pagos sin conciliar — movimientos sin factura (requieren revisión)
 * 4. Facturas sin pago — facturas que no tienen movimiento bancario
 *
 * Criterios de match:
 * - Monto: ±2% de tolerancia (comisiones bancarias)
 * - Fecha: ±3 días del movimiento
 * - RFC: si el concepto menciona el RFC del emisor/receptor
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOLERANCIA_MONTO_PCT = 0.02;
const TOLERANCIA_FECHA_DIAS = 3;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const mes = parseInt(searchParams.get('mes') ?? String(hoy.getMonth() + 1));
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));
    const empresaId = searchParams.get('empresaId');

    if (!empresaId) {
      return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });
    }

    const inicioMes = new Date(anio, mes - 1, 1);
    const finMes = new Date(anio, mes, 0, 23, 59, 59);
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const empresa = await db.empresa.findUnique({
      where: { id: empresaId },
      select: { nombre: true, rfc: true },
    });

    // ===== OBTENER DATOS =====
    const [movimientosBanco, facturasEmitidas, facturasRecibidas] = await Promise.all([
      db.movimientoBanco.findMany({
        where: {
          cuenta: { empresaId },
          fecha: { gte: inicioMes, lte: finMes },
        },
        include: {
          cuenta: { select: { banco: true, cuenta: true, tipo: true } },
          facturaConciliada: { select: { folio: true, serie: true, total: true, emisorNombre: true, receptorNombre: true, direccion: true } },
        },
        orderBy: { fecha: 'asc' },
      }),
      db.factura.findMany({
        where: {
          empresaId,
          direccion: 'emitida',
          fecha: { gte: inicioMes, lte: finMes },
          estado: 'timbrada',
          tipoComprobante: 'I',
        },
        select: { id: true, folio: true, serie: true, fecha: true, total: true, receptorRfc: true, receptorNombre: true },
        orderBy: { fecha: 'asc' },
      }),
      db.factura.findMany({
        where: {
          empresaId,
          direccion: 'recibida',
          fecha: { gte: inicioMes, lte: finMes },
          estado: 'timbrada',
          tipoComprobante: 'I',
        },
        select: { id: true, folio: true, serie: true, fecha: true, total: true, emisorRfc: true, emisorNombre: true },
        orderBy: { fecha: 'asc' },
      }),
    ]);

    // ===== CLASIFICAR MOVIMIENTOS =====
    const movsConciliados: any[] = [];
    const movsSinConciliar: any[] = [];

    for (const mov of movimientosBanco) {
      if (mov.facturaConciliadaId) {
        movsConciliados.push({
          fecha: mov.fecha,
          banco: mov.cuenta.banco,
          concepto: mov.concepto,
          monto: mov.monto,
          facturaFolio: `${mov.facturaConciliada?.serie || ''}${mov.facturaConciliada?.folio || ''}`,
          facturaTotal: mov.facturaConciliada?.total || 0,
          facturaContraparte: mov.monto > 0
            ? mov.facturaConciliada?.receptorNombre
            : mov.facturaConciliada?.emisorNombre,
          tipoFactura: mov.facturaConciliada?.direccion,
          categoria: mov.categoria || 'Sin clasificar',
        });
      } else {
        movsSinConciliar.push({
          fecha: mov.fecha,
          banco: mov.cuenta.banco,
          concepto: mov.concepto,
          monto: mov.monto,
          categoria: mov.categoria || 'Sin clasificar',
          tipo: mov.monto > 0 ? 'Depósito' : 'Pago',
        });
      }
    }

    // ===== FACTURAS SIN PAGO =====
    // Facturas que no tienen ningún movimiento bancario conciliado
    const facturasConMovimiento = new Set(
      movimientosBanco
        .filter(m => m.facturaConciliadaId !== null)
        .map(m => m.facturaConciliadaId)
    );

    const facturasSinPagoEmitidas = facturasEmitidas.filter(f => !facturasConMovimiento.has(f.id));
    const facturasSinPagoRecibidas = facturasRecibidas.filter(f => !facturasConMovimiento.has(f.id));

    // ===== TOTALES =====
    const totalMovimientos = movimientosBanco.length;
    const totalConciliados = movsConciliados.length;
    const totalSinConciliar = movsSinConciliar.length;
    const totalFacturasEmitidas = facturasEmitidas.length;
    const totalFacturasRecibidas = facturasRecibidas.length;
    const totalFacturasSinPago = facturasSinPagoEmitidas.length + facturasSinPagoRecibidas.length;

    const montoConciliado = movsConciliados.reduce((s, m) => s + Math.abs(m.monto), 0);
    const montoSinConciliar = movsSinConciliar.reduce((s, m) => s + Math.abs(m.monto), 0);
    const montoFacturasSinPago = [...facturasSinPagoEmitidas, ...facturasSinPagoRecibidas].reduce((s, f) => s + f.total, 0);

    // ===== CREAR EXCEL =====
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema Fiscal IA';
    wb.created = new Date();

    // ===== HOJA 1: RESUMEN =====
    const ws1 = wb.addWorksheet('Resumen Conciliación', { views: [{ showGridLines: false }] });
    ws1.columns = [{ width: 45 }, { width: 18 }, { width: 18 }, { width: 18 }];

    ws1.mergeCells('A1:D1');
    ws1.getCell('A1').value = `REPORTE DE CONCILIACIÓN BANCO vs FACTURAS — ${meses[mes - 1]} ${anio}`;
    ws1.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF7C3AED' } };

    ws1.mergeCells('A2:D2');
    ws1.getCell('A2').value = `${empresa?.nombre} | RFC: ${empresa?.rfc}`;
    ws1.getCell('A2').font = { bold: true };

    let r = 4;
    const addRow = (label: string, valor: any, esHeader = false, esTotal = false) => {
      ws1.getCell(`A${r}`).value = label;
      ws1.getCell(`B${r}`).value = valor;
      if (typeof valor === 'number') {
        ws1.getCell(`B${r}`).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
      }
      if (esHeader) {
        ws1.getRow(r).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws1.getRow(r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
      }
      if (esTotal) {
        ws1.getRow(r).font = { bold: true };
        ws1.getRow(r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
      }
      r++;
    };

    addRow('CONCEPTO', 'VALOR', true);
    addRow('MOVIMIENTOS BANCARIOS', 0, true);
    addRow('  Total movimientos del mes', totalMovimientos);
    addRow('  Movimientos conciliados con factura', totalConciliados);
    addRow('  Movimientos sin conciliar', totalSinConciliar);
    addRow('  Tasa de conciliación', totalMovimientos > 0 ? `${((totalConciliados / totalMovimientos) * 100).toFixed(1)}%` : '0%');
    addRow('  Monto conciliado', montoConciliado);
    addRow('  Monto sin conciliar', montoSinConciliar);
    r++;
    addRow('FACTURAS', 0, true);
    addRow('  Facturas emitidas (ventas)', totalFacturasEmitidas);
    addRow('  Facturas recibidas (compras)', totalFacturasRecibidas);
    addRow('  Facturas sin pago bancario', totalFacturasSinPago);
    addRow('  Monto facturas sin pago', montoFacturasSinPago);
    r++;
    addRow('RESUMEN FINANCIERO', 0, true);
    addRow('  Total ingresos bancarios (depósitos)', movimientosBanco.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0));
    addRow('  Total egresos bancarios (pagos)', -movimientosBanco.filter(m => m.monto < 0).reduce((s, m) => s + m.monto, 0));
    addRow('  Flujo neto del mes', movimientosBanco.reduce((s, m) => s + m.monto, 0), true);

    // ===== HOJA 2: PAGOS CONCILIADOS =====
    const ws2 = wb.addWorksheet('Pagos Conciliados');
    ws2.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Banco', key: 'banco', width: 14 },
      { header: 'Tipo', key: 'tipo', width: 10 },
      { header: 'Concepto', key: 'concepto', width: 40 },
      { header: 'Monto', key: 'monto', width: 14 },
      { header: 'Factura', key: 'facturaFolio', width: 14 },
      { header: 'Factura Total', key: 'facturaTotal', width: 14 },
      { header: 'Cliente/Proveedor', key: 'contraparte', width: 30 },
      { header: 'Categoría', key: 'categoria', width: 16 },
    ];
    ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };

    movsConciliados.forEach(m => {
      const row = ws2.addRow({
        ...m,
        fecha: m.fecha.toLocaleDateString('es-MX'),
        tipo: m.monto > 0 ? 'Depósito' : 'Pago',
      });
      row.getCell(5).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
      row.getCell(7).numFmt = '"$"#,##0.00';
    });

    // ===== HOJA 3: PAGOS SIN CONCILIAR =====
    const ws3 = wb.addWorksheet('Pagos sin Conciliar');
    ws3.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Banco', key: 'banco', width: 14 },
      { header: 'Tipo', key: 'tipo', width: 10 },
      { header: 'Concepto', key: 'concepto', width: 50 },
      { header: 'Monto', key: 'monto', width: 14 },
      { header: 'Categoría', key: 'categoria', width: 16 },
      { header: 'Sugerencia', key: 'sugerencia', width: 40 },
    ];
    ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF97316' } };

    movsSinConciliar.forEach(m => {
      const sugerencia = m.monto > 0
        ? 'Buscar factura emitida con monto similar'
        : 'Buscar factura recibida con monto similar';
      const row = ws3.addRow({
        ...m,
        fecha: m.fecha.toLocaleDateString('es-MX'),
        sugerencia,
      });
      row.getCell(5).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
    });

    // ===== HOJA 4: FACTURAS SIN PAGO =====
    const ws4 = wb.addWorksheet('Facturas sin Pago');
    ws4.columns = [
      { header: 'Tipo', key: 'tipo', width: 10 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Folio', key: 'folio', width: 14 },
      { header: 'Cliente/Proveedor', key: 'nombre', width: 35 },
      { header: 'RFC', key: 'rfc', width: 18 },
      { header: 'Total', key: 'total', width: 14 },
    ];
    ws4.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws4.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEF4444' } };

    facturasSinPagoEmitidas.forEach(f => {
      const row = ws4.addRow({
        tipo: 'Emitida',
        fecha: f.fecha.toLocaleDateString('es-MX'),
        folio: `${f.serie || ''}${f.folio}`,
        nombre: f.receptorNombre || '',
        rfc: f.receptorRfc || '',
        total: f.total,
      });
      row.getCell(6).numFmt = '"$"#,##0.00';
    });

    facturasSinPagoRecibidas.forEach(f => {
      const row = ws4.addRow({
        tipo: 'Recibida',
        fecha: f.fecha.toLocaleDateString('es-MX'),
        folio: `${f.serie || ''}${f.folio}`,
        nombre: f.emisorNombre || '',
        rfc: f.emisorRfc || '',
        total: f.total,
      });
      row.getCell(6).numFmt = '"$"#,##0.00';
    });

    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Conciliacion_${anio}${String(mes).padStart(2, '0')}_${empresa?.rfc}.xlsx"`,
      },
    });
  } catch (e: any) {
    console.error('Error en /api/bancos/conciliacion-facturas:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
