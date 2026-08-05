import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/export/cfdi-mensual?mes=6&anio=2026&empresaId=xxx
 *
 * Genera REPORTE CFDI MENSUAL CONSOLIDADO con:
 * 1. Resumen ejecutivo (total emitido, recibido, IVA por pagar)
 * 2. Detalle de facturas emitidas (por cliente)
 * 3. Detalle de facturas recibidas (por proveedor)
 * 4. Notas de crédito desglosadas
 * 5. Top 10 clientes y proveedores
 *
 * Formato: Excel con 5 hojas
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const mes = parseInt(searchParams.get('mes') ?? String(hoy.getMonth() + 1));
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));
    const empresaId = searchParams.get('empresaId') || undefined;

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

    const [emitidas, recibidas] = await Promise.all([
      db.factura.findMany({
        where: {
          empresaId,
          direccion: 'emitida',
          fecha: { gte: inicioMes, lte: finMes },
          estado: 'timbrada',
        },
        select: {
          folio: true, serie: true, fecha: true, subtotal: true, descuento: true,
          totalImpuestos: true, impuestoRetenido: true, total: true,
          tipoComprobante: true, moneda: true,
          receptorRfc: true, receptorNombre: true, concepto: true, uuid: true,
        },
        orderBy: { fecha: 'asc' },
      }),
      db.factura.findMany({
        where: {
          empresaId,
          direccion: 'recibida',
          fecha: { gte: inicioMes, lte: finMes },
          estado: 'timbrada',
        },
        select: {
          folio: true, serie: true, fecha: true, subtotal: true, descuento: true,
          totalImpuestos: true, impuestoRetenido: true, total: true,
          tipoComprobante: true, moneda: true,
          emisorRfc: true, emisorNombre: true, concepto: true, uuid: true,
        },
        orderBy: { fecha: 'asc' },
      }),
    ]);

    // Separar facturas (I) de notas de crédito (E)
    const emitidasFacturas = emitidas.filter(f => f.tipoComprobante === 'I');
    const emitidasNC = emitidas.filter(f => f.tipoComprobante === 'E');
    const recibidasFacturas = recibidas.filter(f => f.tipoComprobante === 'I');
    const recibidasNC = recibidas.filter(f => f.tipoComprobante === 'E');

    // ===== RESUMEN EJECUTIVO =====
    const totalEmitido = emitidasFacturas.reduce((s, f) => s + f.total, 0);
    const totalRecibido = recibidasFacturas.reduce((s, f) => s + f.total, 0);
    const totalNCEmitidas = emitidasNC.reduce((s, f) => s + f.total, 0);
    const totalNCRecibidas = recibidasNC.reduce((s, f) => s + f.total, 0);

    const ivaTrasladado = emitidasFacturas.reduce((s, f) => s + f.totalImpuestos, 0);
    const ivaAcreditable = recibidasFacturas.reduce((s, f) => s + f.totalImpuestos, 0);
    const ivaPorPagar = ivaTrasladado - ivaAcreditable;

    // ===== TOP 10 CLIENTES (emitidas) =====
    const porCliente = new Map<string, { nombre: string; rfc: string; count: number; total: number }>();
    for (const f of emitidasFacturas) {
      const key = f.receptorRfc || 'SIN_RFC';
      const existing = porCliente.get(key);
      if (existing) {
        existing.count++;
        existing.total += f.total;
      } else {
        porCliente.set(key, { nombre: f.receptorNombre || 'Sin nombre', rfc: key, count: 1, total: f.total });
      }
    }
    const topClientes = Array.from(porCliente.values()).sort((a, b) => b.total - a.total).slice(0, 10);

    // ===== TOP 10 PROVEEDORES (recibidas) =====
    const porProveedor = new Map<string, { nombre: string; rfc: string; count: number; total: number }>();
    for (const f of recibidasFacturas) {
      const key = f.emisorRfc || 'SIN_RFC';
      const existing = porProveedor.get(key);
      if (existing) {
        existing.count++;
        existing.total += f.total;
      } else {
        porProveedor.set(key, { nombre: f.emisorNombre || 'Sin nombre', rfc: key, count: 1, total: f.total });
      }
    }
    const topProveedores = Array.from(porProveedor.values()).sort((a, b) => b.total - a.total).slice(0, 10);

    // ===== CREAR EXCEL =====
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema Fiscal IA';
    wb.created = new Date();

    // ===== HOJA 1: RESUMEN EJECUTIVO =====
    const ws1 = wb.addWorksheet('Resumen Ejecutivo', { views: [{ showGridLines: false }] });
    ws1.columns = [{ width: 40 }, { width: 18 }, { width: 18 }, { width: 18 }];

    ws1.mergeCells('A1:D1');
    ws1.getCell('A1').value = `REPORTE CFDI MENSUAL — ${meses[mes - 1]} ${anio}`;
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

    addRow('CONCEPTO', 'MONTO', true);
    addRow('INGRESOS', 0, true);
    addRow('  Facturas emitidas', totalEmitido);
    addRow('  Notas de crédito emitidas', -totalNCEmitidas);
    addRow('  Total ingresos netos', totalEmitido - totalNCEmitidas, true);
    r++;
    addRow('EGRESOS', 0, true);
    addRow('  Facturas recibidas', totalRecibido);
    addRow('  Notas de crédito recibidas', -totalNCRecibidas);
    addRow('  Total egresos netos', totalRecibido - totalNCRecibidas, true);
    r++;
    addRow('IVA', 0, true);
    addRow('  IVA trasladado (emitidas)', ivaTrasladado);
    addRow('  IVA acreditable (recibidas)', -ivaAcreditable);
    addRow('  IVA por pagar al SAT', ivaPorPagar, true);
    r++;
    addRow('RESUMEN', 0, true);
    addRow('  Total facturas emitidas', emitidasFacturas.length);
    addRow('  Total facturas recibidas', recibidasFacturas.length);
    addRow('  Total notas crédito emitidas', emitidasNC.length);
    addRow('  Total notas crédito recibidas', recibidasNC.length);

    // ===== HOJA 2: FACTURAS EMITIDAS =====
    const ws2 = wb.addWorksheet('Facturas Emitidas');
    ws2.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Folio', key: 'folio', width: 14 },
      { header: 'Serie', key: 'serie', width: 8 },
      { header: 'RFC Cliente', key: 'rfc', width: 18 },
      { header: 'Cliente', key: 'nombre', width: 35 },
      { header: 'Subtotal', key: 'subtotal', width: 14 },
      { header: 'IVA', key: 'iva', width: 12 },
      { header: 'Total', key: 'total', width: 14 },
      { header: 'UUID', key: 'uuid', width: 36 },
    ];
    ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };

    emitidasFacturas.forEach(f => {
      const row = ws2.addRow({
        fecha: f.fecha.toLocaleDateString('es-MX'),
        folio: f.folio,
        serie: f.serie || '',
        rfc: f.receptorRfc || '',
        nombre: f.receptorNombre || '',
        subtotal: f.subtotal - f.descuento,
        iva: f.totalImpuestos,
        total: f.total,
        uuid: f.uuid || '',
      });
      row.getCell(6).numFmt = '"$"#,##0.00';
      row.getCell(7).numFmt = '"$"#,##0.00';
      row.getCell(8).numFmt = '"$"#,##0.00';
    });

    // Totales
    const totRow = ws2.addRow({
      fecha: 'TOTALES',
      subtotal: emitidasFacturas.reduce((s, f) => s + (f.subtotal - f.descuento), 0),
      iva: ivaTrasladado,
      total: totalEmitido,
    });
    totRow.font = { bold: true };
    totRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    totRow.getCell(6).numFmt = '"$"#,##0.00';
    totRow.getCell(7).numFmt = '"$"#,##0.00';
    totRow.getCell(8).numFmt = '"$"#,##0.00';

    // ===== HOJA 3: FACTURAS RECIBIDAS =====
    const ws3 = wb.addWorksheet('Facturas Recibidas');
    ws3.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Folio', key: 'folio', width: 14 },
      { header: 'Serie', key: 'serie', width: 8 },
      { header: 'RFC Proveedor', key: 'rfc', width: 18 },
      { header: 'Proveedor', key: 'nombre', width: 35 },
      { header: 'Subtotal', key: 'subtotal', width: 14 },
      { header: 'IVA', key: 'iva', width: 12 },
      { header: 'Total', key: 'total', width: 14 },
      { header: 'UUID', key: 'uuid', width: 36 },
    ];
    ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };

    recibidasFacturas.forEach(f => {
      const row = ws3.addRow({
        fecha: f.fecha.toLocaleDateString('es-MX'),
        folio: f.folio,
        serie: f.serie || '',
        rfc: f.emisorRfc || '',
        nombre: f.emisorNombre || '',
        subtotal: f.subtotal - f.descuento,
        iva: f.totalImpuestos,
        total: f.total,
        uuid: f.uuid || '',
      });
      row.getCell(6).numFmt = '"$"#,##0.00';
      row.getCell(7).numFmt = '"$"#,##0.00';
      row.getCell(8).numFmt = '"$"#,##0.00';
    });

    const totRow3 = ws3.addRow({
      fecha: 'TOTALES',
      subtotal: recibidasFacturas.reduce((s, f) => s + (f.subtotal - f.descuento), 0),
      iva: ivaAcreditable,
      total: totalRecibido,
    });
    totRow3.font = { bold: true };
    totRow3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    totRow3.getCell(6).numFmt = '"$"#,##0.00';
    totRow3.getCell(7).numFmt = '"$"#,##0.00';
    totRow3.getCell(8).numFmt = '"$"#,##0.00';

    // ===== HOJA 4: NOTAS DE CRÉDITO =====
    const ws4 = wb.addWorksheet('Notas de Crédito');
    ws4.columns = [
      { header: 'Tipo', key: 'tipo', width: 14 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Folio', key: 'folio', width: 14 },
      { header: 'RFC', key: 'rfc', width: 18 },
      { header: 'Nombre', key: 'nombre', width: 35 },
      { header: 'Total', key: 'total', width: 14 },
    ];
    ws4.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws4.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };

    emitidasNC.forEach(f => {
      const row = ws4.addRow({
        tipo: 'Emitida',
        fecha: f.fecha.toLocaleDateString('es-MX'),
        folio: f.folio,
        rfc: f.receptorRfc || '',
        nombre: f.receptorNombre || '',
        total: -f.total, // Negativo porque resta
      });
      row.getCell(6).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
    });
    recibidasNC.forEach(f => {
      const row = ws4.addRow({
        tipo: 'Recibida',
        fecha: f.fecha.toLocaleDateString('es-MX'),
        folio: f.folio,
        rfc: f.emisorRfc || '',
        nombre: f.emisorNombre || '',
        total: -f.total,
      });
      row.getCell(6).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
    });

    // ===== HOJA 5: TOP CLIENTES Y PROVEEDORES =====
    const ws5 = wb.addWorksheet('Top 10', { views: [{ showGridLines: false }] });
    ws5.columns = [{ width: 14 }, { width: 18 }, { width: 35 }, { width: 10 }, { width: 16 }];

    ws5.mergeCells('A1:E1');
    ws5.getCell('A1').value = `TOP 10 CLIENTES Y PROVEEDORES — ${meses[mes - 1]} ${anio}`;
    ws5.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF7C3AED' } };

    // Top clientes
    let r5 = 3;
    ws5.getCell(`A${r5}`).value = 'TOP 10 CLIENTES (Facturas Emitidas)';
    ws5.getCell(`A${r5}`).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws5.getRow(r5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    r5++;

    ws5.getCell(`A${r5}`).value = '#';
    ws5.getCell(`B${r5}`).value = 'RFC';
    ws5.getCell(`C${r5}`).value = 'Nombre';
    ws5.getCell(`D${r5}`).value = 'Facturas';
    ws5.getCell(`E${r5}`).value = 'Total';
    ws5.getRow(r5).font = { bold: true };
    r5++;

    topClientes.forEach((c, i) => {
      ws5.getCell(`A${r5}`).value = i + 1;
      ws5.getCell(`B${r5}`).value = c.rfc;
      ws5.getCell(`C${r5}`).value = c.nombre;
      ws5.getCell(`D${r5}`).value = c.count;
      ws5.getCell(`E${r5}`).value = c.total;
      ws5.getCell(`E${r5}`).numFmt = '"$"#,##0.00';
      r5++;
    });

    r5 += 2;
    ws5.getCell(`A${r5}`).value = 'TOP 10 PROVEEDORES (Facturas Recibidas)';
    ws5.getCell(`A${r5}`).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws5.getRow(r5).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    r5++;

    ws5.getCell(`A${r5}`).value = '#';
    ws5.getCell(`B${r5}`).value = 'RFC';
    ws5.getCell(`C${r5}`).value = 'Nombre';
    ws5.getCell(`D${r5}`).value = 'Facturas';
    ws5.getCell(`E${r5}`).value = 'Total';
    ws5.getRow(r5).font = { bold: true };
    r5++;

    topProveedores.forEach((p, i) => {
      ws5.getCell(`A${r5}`).value = i + 1;
      ws5.getCell(`B${r5}`).value = p.rfc;
      ws5.getCell(`C${r5}`).value = p.nombre;
      ws5.getCell(`D${r5}`).value = p.count;
      ws5.getCell(`E${r5}`).value = p.total;
      ws5.getCell(`E${r5}`).numFmt = '"$"#,##0.00';
      r5++;
    });

    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="CFDI_Mensual_${anio}${String(mes).padStart(2, '0')}_${empresa?.rfc}.xlsx"`,
      },
    });
  } catch (e: any) {
    console.error('Error en /api/export/cfdi-mensual:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
