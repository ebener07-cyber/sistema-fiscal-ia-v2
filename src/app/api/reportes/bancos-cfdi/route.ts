import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/reportes/bancos-cfdi?empresaId=xxx&anio=2026
 *
 * REPORTE BANCOS PDF — Conciliación completa de movimientos bancarios
 * (Banorte + Santander) con TODOS los CFDIs del año.
 *
 * Genera Excel profesional con 6 hojas:
 * 1. Resumen Ejecutivo — totales por banco, conciliación, indicadores
 * 2. Banorte — todos los movimientos con estado de conciliación
 * 3. Santander — todos los movimientos con estado de conciliación
 * 4. CFDIs Emitidos — facturas que SÍ tienen pago bancario vs las que NO
 * 5. CFDIs Recibidos — facturas que SÍ tienen pago bancario vs las que NO
 * 6. Observaciones — análisis profesional y recomendaciones
 *
 * Criterios de cruce:
 * - Monto: ±2% de tolerancia
 * - Fecha: ±5 días del movimiento
 * - Si el movimiento ya tiene facturaConciliadaId, se usa esa
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOLERANCIA_MONTO = 0.02;
const TOLERANCIA_FECHA_DIAS = 5;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));
    const empresaId = searchParams.get('empresaId');

    if (!empresaId) {
      return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });
    }

    const inicioAnio = new Date(anio, 0, 1);
    const finAnio = new Date(anio, 11, 31, 23, 59, 59);
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const empresa = await db.empresa.findUnique({
      where: { id: empresaId },
      select: { nombre: true, rfc: true },
    });

    // ===== OBTENER TODOS LOS DATOS =====
    const [movimientos, facturasEmitidas, facturasRecibidas] = await Promise.all([
      db.movimientoBanco.findMany({
        where: {
          cuenta: { empresaId },
          fecha: { gte: inicioAnio, lte: finAnio },
        },
        include: {
          cuenta: { select: { banco: true, cuenta: true, tipo: true } },
          facturaConciliada: {
            select: {
              folio: true, serie: true, total: true,
              emisorNombre: true, receptorNombre: true, direccion: true,
              tipoComprobante: true,
            },
          },
        },
        orderBy: { fecha: 'asc' },
      }),
      db.factura.findMany({
        where: {
          empresaId,
          direccion: 'emitida',
          fecha: { gte: inicioAnio, lte: finAnio },
          estado: 'timbrada',
          tipoComprobante: 'I',
        },
        select: {
          id: true, folio: true, serie: true, fecha: true, total: true,
          subtotal: true, totalImpuestos: true,
          receptorRfc: true, receptorNombre: true, concepto: true,
        },
        orderBy: { fecha: 'asc' },
      }),
      db.factura.findMany({
        where: {
          empresaId,
          direccion: 'recibida',
          fecha: { gte: inicioAnio, lte: finAnio },
          estado: 'timbrada',
          tipoComprobante: 'I',
        },
        select: {
          id: true, folio: true, serie: true, fecha: true, total: true,
          subtotal: true, totalImpuestos: true,
          emisorRfc: true, emisorNombre: true, concepto: true,
        },
        orderBy: { fecha: 'asc' },
      }),
    ]);

    // ===== CRUZAR MOVIMIENTOS CON CFDIs =====
    // Para cada movimiento, buscar si hay una factura que coincida
    const movsBanorte: any[] = [];
    const movsSantander: any[] = [];
    let conciliados = 0;
    let sinConciliar = 0;

    // IDs de facturas que ya están conciliadas con algún movimiento
    const facturasConPago = new Set<string>();

    for (const mov of movimientos) {
      const esDeposito = mov.monto > 0;
      const montoAbs = Math.abs(mov.monto);
      const minMonto = montoAbs * (1 - TOLERANCIA_MONTO);
      const maxMonto = montoAbs * (1 + TOLERANCIA_MONTO);

      let estado = 'SIN_FACTURA';
      let facturaFolio = '';
      let facturaTotal = 0;
      let facturaNombre = '';
      let facturaRFC = '';

      // Si ya tiene factura conciliada en BD
      if (mov.facturaConciliadaId && mov.facturaConciliada) {
        estado = 'CONCILIADO';
        facturaFolio = `${mov.facturaConciliada.serie || ''}${mov.facturaConciliada.folio}`;
        facturaTotal = mov.facturaConciliada.total;
        facturaNombre = esDeposito
          ? mov.facturaConciliada.receptorNombre || ''
          : mov.facturaConciliada.emisorNombre || '';
        facturasConPago.add(mov.facturaConciliadaId);
        conciliados++;
      } else {
        // Buscar match por monto + fecha
        const facturas = esDeposito ? facturasEmitidas : facturasRecibidas;
        const matches = facturas.filter(f => {
          if (f.total < minMonto || f.total > maxMonto) return false;
          const diasDiff = Math.abs(f.fecha.getTime() - mov.fecha.getTime()) / (1000 * 60 * 60 * 24);
          return diasDiff <= TOLERANCIA_FECHA_DIAS;
        });

        if (matches.length === 1) {
          estado = 'CONCILIADO';
          facturaFolio = `${matches[0].serie || ''}${matches[0].folio}`;
          facturaTotal = matches[0].total;
          facturaNombre = esDeposito ? matches[0].receptorNombre || '' : matches[0].emisorNombre || '';
          facturaRFC = esDeposito ? matches[0].receptorRfc || '' : matches[0].emisorRfc || '';
          facturasConPago.add(matches[0].id);
          conciliados++;
        } else if (matches.length > 1) {
          estado = 'MULTIPLES_MATCHES';
          facturaFolio = `${matches.length} facturas similares`;
          facturaTotal = matches[0].total;
          facturaNombre = esDeposito ? matches[0].receptorNombre || '' : matches[0].emisorNombre || '';
          sinConciliar++;
        } else {
          sinConciliar++;
        }
      }

      const resultado = {
        fecha: mov.fecha,
        banco: mov.cuenta.banco,
        cuenta: mov.cuenta.cuenta,
        tipo: esDeposito ? 'Depósito' : 'Pago',
        concepto: mov.concepto,
        monto: mov.monto,
        categoria: mov.categoria || 'Sin clasificar',
        estado,
        facturaFolio,
        facturaTotal,
        facturaNombre,
        facturaRFC,
      };

      if (mov.cuenta.banco.includes('SANTANDER')) {
        movsSantander.push(resultado);
      } else {
        movsBanorte.push(resultado);
      }
    }

    // ===== SEPARAR CFDIs PAGADOS vs NO PAGADOS =====
    const cfdiEmitidosPagados = facturasEmitidas.filter(f => facturasConPago.has(f.id));
    const cfdiEmitidosNoPagados = facturasEmitidas.filter(f => !facturasConPago.has(f.id));
    const cfdiRecibidosPagados = facturasRecibidas.filter(f => facturasConPago.has(f.id));
    const cfdiRecibidosNoPagados = facturasRecibidas.filter(f => !facturasConPago.has(f.id));

    // ===== TOTALES =====
    const ingBanorte = movsBanorte.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
    const egrBanorte = movsBanorte.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);
    const ingSantander = movsSantander.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
    const egrSantander = movsSantander.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);

    const saldoBanorte = ingBanorte - egrBanorte;
    const saldoSantander = ingSantander - egrSantander;
    const saldoTotal = saldoBanorte + saldoSantander;

    const totalVentas = facturasEmitidas.reduce((s, f) => s + f.total, 0);
    const totalCompras = facturasRecibidas.reduce((s, f) => s + f.total, 0);
    const utilidad = totalVentas - totalCompras;
    const margen = totalVentas > 0 ? (utilidad / totalVentas * 100) : 0;
    const tasaConc = movimientos.length > 0 ? (conciliados / movimientos.length * 100) : 0;

    // ===== CREAR EXCEL =====
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema Fiscal IA';
    wb.created = new Date();

    // ===== HOJA 1: RESUMEN EJECUTIVO =====
    const ws1 = wb.addWorksheet('📊 Resumen Ejecutivo', { views: [{ showGridLines: false }] });
    ws1.columns = [{ width: 45 }, { width: 20 }, { width: 20 }, { width: 20 }];

    ws1.mergeCells('A1:D1');
    ws1.getCell('A1').value = 'REPORTE BANCOS PDF — Conciliación Banorte + Santander con CFDIs';
    ws1.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF7C3AED' } };
    ws1.getCell('A1').alignment = { horizontal: 'center' };

    ws1.mergeCells('A2:D2');
    ws1.getCell('A2').value = `${empresa?.nombre} | RFC: ${empresa?.rfc} | Año ${anio}`;
    ws1.getCell('A2').font = { bold: true, size: 12 };
    ws1.getCell('A2').alignment = { horizontal: 'center' };

    ws1.mergeCells('A3:D3');
    ws1.getCell('A3').value = `Generado: ${new Date().toLocaleDateString('es-MX')} | ${new Date().toLocaleTimeString('es-MX')}`;
    ws1.getCell('A3').font = { italic: true, size: 10 };
    ws1.getCell('A3').alignment = { horizontal: 'center' };

    let r = 5;
    const addRow = (label: string, v1: any, v2?: any, v3?: any, esHeader = false, esTotal = false) => {
      ws1.getCell(`A${r}`).value = label;
      ws1.getCell(`B${r}`).value = v1;
      ws1.getCell(`C${r}`).value = v2;
      ws1.getCell(`D${r}`).value = v3;
      [1, 2, 3].forEach(i => {
        const cell = ws1.getCell(`${String.fromCharCode(65 + i)}${r}`);
        if (typeof cell.value === 'number') cell.numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
      });
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

    addRow('CONCEPTO', 'BANORTE', 'SANTANDER', 'TOTAL', true);
    addRow('Movimientos totales', movsBanorte.length, movsSantander.length, movimientos.length);
    addRow('Ingresos (depósitos)', ingBanorte, ingSantander, ingBanorte + ingSantander);
    addRow('Egresos (retiros)', -egrBanorte, -egrSantander, -(egrBanorte + egrSantander));
    addRow('FLUJO NETO', saldoBanorte, saldoSantander, saldoTotal, false, true);
    r++;

    addRow('CONCILIACIÓN CON CFDIs', '', '', '', true);
    addRow('Movimientos conciliados', '', '', conciliados);
    addRow('Movimientos sin factura', '', '', sinConciliar);
    addRow('Tasa de conciliación', '', '', `${tasaConc.toFixed(1)}%`);
    r++;

    addRow('CFDIs EMITIDOS (Ventas)', '', '', '', true);
    addRow('Total facturas emitidas', '', '', facturasEmitidas.length);
    addRow('Facturas con pago bancario', '', '', cfdiEmitidosPagados.length);
    addRow('Facturas SIN pago bancario', '', '', cfdiEmitidosNoPagados.length);
    addRow('Total ventas (CFDIs)', '', '', totalVentas, false, true);
    r++;

    addRow('CFDIs RECIBIDOS (Compras)', '', '', '', true);
    addRow('Total facturas recibidas', '', '', facturasRecibidas.length);
    addRow('Facturas con pago bancario', '', '', cfdiRecibidosPagados.length);
    addRow('Facturas SIN pago bancario', '', '', cfdiRecibidosNoPagados.length);
    addRow('Total compras (CFDIs)', '', '', totalCompras, false, true);
    r++;

    addRow('INDICADORES FINANCIEROS', '', '', '', true);
    addRow('Utilidad bruta (ventas - compras)', '', '', utilidad, false, true);
    addRow('Margen de utilidad', '', '', `${margen.toFixed(1)}%`);
    addRow('Saldo total en bancos', '', '', saldoTotal, false, true);

    // ===== HOJA 2: BANORTE DETALLE =====
    const ws2 = wb.addWorksheet('🏦 Banorte');
    ws2.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Tipo', key: 'tipo', width: 10 },
      { header: 'Concepto', key: 'concepto', width: 45 },
      { header: 'Monto', key: 'monto', width: 14 },
      { header: 'Categoría', key: 'categoria', width: 16 },
      { header: 'Estado', key: 'estado', width: 18 },
      { header: 'Factura', key: 'facturaFolio', width: 14 },
      { header: 'Total Factura', key: 'facturaTotal', width: 14 },
      { header: 'Cliente/Proveedor', key: 'facturaNombre', width: 30 },
    ];
    ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };

    movsBanorte.forEach(m => {
      const row = ws2.addRow({ ...m, fecha: m.fecha.toLocaleDateString('es-MX') });
      row.getCell(4).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
      row.getCell(8).numFmt = '"$"#,##0.00';
      if (m.estado === 'CONCILIADO') row.getCell(6).font = { color: { argb: 'FF10B981' }, bold: true };
      else if (m.estado === 'SIN_FACTURA') row.getCell(6).font = { color: { argb: 'FFEF4444' }, bold: true };
      else row.getCell(6).font = { color: { argb: 'FFF97316' }, bold: true };
    });

    // Total Banorte
    const totRowB = ws2.addRow({
      concepto: 'TOTALES BANORTE',
      monto: saldoBanorte,
    });
    totRowB.font = { bold: true };
    totRowB.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    totRowB.getCell(4).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';

    // ===== HOJA 3: SANTANDER DETALLE =====
    const ws3 = wb.addWorksheet('🏛️ Santander');
    ws3.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Tipo', key: 'tipo', width: 10 },
      { header: 'Concepto', key: 'concepto', width: 45 },
      { header: 'Monto', key: 'monto', width: 14 },
      { header: 'Categoría', key: 'categoria', width: 16 },
      { header: 'Estado', key: 'estado', width: 18 },
      { header: 'Factura', key: 'facturaFolio', width: 14 },
      { header: 'Total Factura', key: 'facturaTotal', width: 14 },
      { header: 'Cliente/Proveedor', key: 'facturaNombre', width: 30 },
    ];
    ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEF4444' } };

    movsSantander.forEach(m => {
      const row = ws3.addRow({ ...m, fecha: m.fecha.toLocaleDateString('es-MX') });
      row.getCell(4).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
      row.getCell(8).numFmt = '"$"#,##0.00';
      if (m.estado === 'CONCILIADO') row.getCell(6).font = { color: { argb: 'FF10B981' }, bold: true };
      else if (m.estado === 'SIN_FACTURA') row.getCell(6).font = { color: { argb: 'FFEF4444' }, bold: true };
      else row.getCell(6).font = { color: { argb: 'FFF97316' }, bold: true };
    });

    const totRowS = ws3.addRow({
      concepto: 'TOTALES SANTANDER',
      monto: saldoSantander,
    });
    totRowS.font = { bold: true };
    totRowS.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    totRowS.getCell(4).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';

    // ===== HOJA 4: CFDIs EMITIDOS (Ventas) =====
    const ws4 = wb.addWorksheet('📤 CFDIs Emitidos');
    ws4.columns = [
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Folio', key: 'folio', width: 14 },
      { header: 'Cliente', key: 'nombre', width: 35 },
      { header: 'RFC', key: 'rfc', width: 18 },
      { header: 'Subtotal', key: 'subtotal', width: 14 },
      { header: 'IVA', key: 'iva', width: 12 },
      { header: 'Total', key: 'total', width: 14 },
    ];
    ws4.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws4.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };

    // Primero los pagados (verde)
    cfdiEmitidosPagados.forEach(f => {
      const row = ws4.addRow({
        estado: '✅ PAGADO',
        fecha: f.fecha.toLocaleDateString('es-MX'),
        folio: `${f.serie || ''}${f.folio}`,
        nombre: f.receptorNombre || '',
        rfc: f.receptorRfc || '',
        subtotal: f.subtotal,
        iva: f.totalImpuestos,
        total: f.total,
      });
      row.getCell(6).numFmt = '"$"#,##0.00';
      row.getCell(7).numFmt = '"$"#,##0.00';
      row.getCell(8).numFmt = '"$"#,##0.00';
      row.getCell(1).font = { color: { argb: 'FF10B981' }, bold: true };
    });

    // Después los NO pagados (rojo)
    cfdiEmitidosNoPagados.forEach(f => {
      const row = ws4.addRow({
        estado: '⚠️ SIN PAGO',
        fecha: f.fecha.toLocaleDateString('es-MX'),
        folio: `${f.serie || ''}${f.folio}`,
        nombre: f.receptorNombre || '',
        rfc: f.receptorRfc || '',
        subtotal: f.subtotal,
        iva: f.totalImpuestos,
        total: f.total,
      });
      row.getCell(6).numFmt = '"$"#,##0.00';
      row.getCell(7).numFmt = '"$"#,##0.00';
      row.getCell(8).numFmt = '"$"#,##0.00';
      row.getCell(1).font = { color: { argb: 'FFEF4444' }, bold: true };
    });

    // Totales
    const totRow4 = ws4.addRow({
      estado: 'TOTALES',
      subtotal: facturasEmitidas.reduce((s, f) => s + f.subtotal, 0),
      iva: facturasEmitidas.reduce((s, f) => s + f.totalImpuestos, 0),
      total: totalVentas,
    });
    totRow4.font = { bold: true };
    totRow4.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    totRow4.getCell(6).numFmt = '"$"#,##0.00';
    totRow4.getCell(7).numFmt = '"$"#,##0.00';
    totRow4.getCell(8).numFmt = '"$"#,##0.00';

    // ===== HOJA 5: CFDIs RECIBIDOS (Compras) =====
    const ws5 = wb.addWorksheet('📥 CFDIs Recibidos');
    ws5.columns = [
      { header: 'Estado', key: 'estado', width: 14 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Folio', key: 'folio', width: 14 },
      { header: 'Proveedor', key: 'nombre', width: 35 },
      { header: 'RFC', key: 'rfc', width: 18 },
      { header: 'Subtotal', key: 'subtotal', width: 14 },
      { header: 'IVA', key: 'iva', width: 12 },
      { header: 'Total', key: 'total', width: 14 },
    ];
    ws5.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws5.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };

    cfdiRecibidosPagados.forEach(f => {
      const row = ws5.addRow({
        estado: '✅ PAGADO',
        fecha: f.fecha.toLocaleDateString('es-MX'),
        folio: `${f.serie || ''}${f.folio}`,
        nombre: f.emisorNombre || '',
        rfc: f.emisorRfc || '',
        subtotal: f.subtotal,
        iva: f.totalImpuestos,
        total: f.total,
      });
      row.getCell(6).numFmt = '"$"#,##0.00';
      row.getCell(7).numFmt = '"$"#,##0.00';
      row.getCell(8).numFmt = '"$"#,##0.00';
      row.getCell(1).font = { color: { argb: 'FF10B981' }, bold: true };
    });

    cfdiRecibidosNoPagados.forEach(f => {
      const row = ws5.addRow({
        estado: '⚠️ SIN PAGO',
        fecha: f.fecha.toLocaleDateString('es-MX'),
        folio: `${f.serie || ''}${f.folio}`,
        nombre: f.emisorNombre || '',
        rfc: f.emisorRfc || '',
        subtotal: f.subtotal,
        iva: f.totalImpuestos,
        total: f.total,
      });
      row.getCell(6).numFmt = '"$"#,##0.00';
      row.getCell(7).numFmt = '"$"#,##0.00';
      row.getCell(8).numFmt = '"$"#,##0.00';
      row.getCell(1).font = { color: { argb: 'FFEF4444' }, bold: true };
    });

    const totRow5 = ws5.addRow({
      estado: 'TOTALES',
      subtotal: facturasRecibidas.reduce((s, f) => s + f.subtotal, 0),
      iva: facturasRecibidas.reduce((s, f) => s + f.totalImpuestos, 0),
      total: totalCompras,
    });
    totRow5.font = { bold: true };
    totRow5.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    totRow5.getCell(6).numFmt = '"$"#,##0.00';
    totRow5.getCell(7).numFmt = '"$"#,##0.00';
    totRow5.getCell(8).numFmt = '"$"#,##0.00';

    // ===== HOJA 6: OBSERVACIONES =====
    const ws6 = wb.addWorksheet('📝 Observaciones', { views: [{ showGridLines: false }] });
    ws6.columns = [{ width: 100 }];

    ws6.getCell('A1').value = 'OBSERVACIONES Y RECOMENDACIONES PROFESIONALES';
    ws6.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF7C3AED' } };

    let r6 = 3;
    const observaciones = [
      `1. LIQUIDEZ: Saldo total en bancos: $${saldoTotal.toFixed(2)} (Banorte: $${saldoBanorte.toFixed(2)}, Santander: $${saldoSantander.toFixed(2)}).`,
      `   ${saldoTotal > 0 ? '✅ Posición positiva.' : '⚠️ Posición negativa, revisar flujo de efectivo.'}`,
      ``,
      `2. CONCILIACIÓN BANCO-CFDI: ${conciliados} de ${movimientos.length} movimientos conciliados (${tasaConc.toFixed(1)}%).`,
      `   ${tasaConc > 70 ? '✅ Tasa aceptable.' : '⚠️ Tasa baja — revisar movimientos sin factura.'}`,
      `   Movimientos sin factura: ${sinConciliar} — pueden no ser deducibles fiscalmente.`,
      ``,
      `3. VENTAS: ${facturasEmitidas.length} CFDIs emitidos por $${totalVentas.toFixed(2)}.`,
      `   ${cfdiEmitidosPagados.length} facturas con pago bancario (${(cfdiEmitidosPagados.length / facturasEmitidas.length * 100).toFixed(0)}%).`,
      `   ${cfdiEmitidosNoPagados.length} facturas SIN pago bancario — clientes con saldo pendiente.`,
      ``,
      `4. COMPRAS: ${facturasRecibidas.length} CFDIs recibidos por $${totalCompras.toFixed(2)}.`,
      `   ${cfdiRecibidosPagados.length} facturas pagadas (${(cfdiRecibidosPagados.length / facturasRecibidas.length * 100).toFixed(0)}%).`,
      `   ${cfdiRecibidosNoPagados.length} facturas SIN pagar — proveedores con saldo pendiente.`,
      ``,
      `5. MARGEN BRUTO: ${margen.toFixed(1)}% (Ventas $${totalVentas.toFixed(0)} - Compras $${totalCompras.toFixed(0)} = $${utilidad.toFixed(0)}).`,
      `   ${margen > 30 ? '✅ Excelente margen.' : margen > 15 ? '⚠️ Margen aceptable, mejorable.' : '⚠️ Margen bajo, revisar estructura de costos.'}`,
      ``,
      `6. DISTRIBUCIÓN BANCARIA: Banorte ${movsBanorte.length} movs, Santander ${movsSantander.length} movs.`,
      `   ${movsBanorte.length > movsSantander.length * 2 ? '⚠️ Concentración en Banorte — diversificar.' : '✅ Distribución balanceada.'}`,
      ``,
      `RECOMENDACIONES:`,
      `   a) Implementar conciliación mensual automática para mantener tasa >80%.`,
      `   b) Los ${sinConciliar} movimientos sin factura requieren justificación para deducibilidad ISR.`,
      `   c) Las ${cfdiEmitidosNoPagados.length} facturas emitidas sin cobro representan cuentas por cobrar.`,
      `   d) Las ${cfdiRecibidosNoPagados.length} facturas recibidas sin pago representan cuentas por pagar.`,
      `   e) Generar pólizas contables con partida doble a partir de este cruce.`,
      `   f) Considerar fondo de emergencia de 2-3 meses de egresos operativos.`,
      `   g) Revisar movimientos con estado MULTIPLES_MATCHES para asignar factura correcta.`,
    ];

    for (const obs of observaciones) {
      ws6.getCell(`A${r6}`).value = obs;
      if (obs.startsWith('RECOMENDACIONES')) {
        ws6.getCell(`A${r6}`).font = { bold: true, size: 12, color: { argb: 'FF7C3AED' } };
      } else if (obs.startsWith('✅') || obs.startsWith('⚠️')) {
        ws6.getCell(`A${r6}`).font = { bold: true };
      }
      ws6.getCell(`A${r6}`).alignment = { horizontal: 'left', wrapText: true };
      r6++;
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Reporte_Bancos_PDF_${anio}_${empresa?.rfc}.xlsx"`,
      },
    });
  } catch (e: any) {
    console.error('Error en /api/reportes/bancos-cfdi:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
