import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/export/facturas?mes=7&anio=2026
 * Genera Excel con concentrado de facturas del mes.
 * Incluye hojas: Emitidas, Recibidas, Resumen.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const mes = parseInt(searchParams.get('mes') ?? String(hoy.getMonth() + 1));
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));

    const inicio = new Date(anio, mes - 1, 1);
    const fin = new Date(anio, mes, 0, 23, 59, 59);

    const [emitidas, recibidas] = await Promise.all([
      db.factura.findMany({
        where: { direccion: 'emitida', fecha: { gte: inicio, lte: fin } },
        include: { cliente: true },
        orderBy: { fecha: 'asc' },
      }),
      db.factura.findMany({
        where: { direccion: 'recibida', fecha: { gte: inicio, lte: fin } },
        include: { proveedor: true },
        orderBy: { fecha: 'asc' },
      }),
    ]);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema Fiscal IA';
    wb.created = new Date();

    // ===== Hoja 1: Resumen =====
    const wsResumen = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] });
    wsResumen.columns = [
      { width: 35 }, { width: 18 }, { width: 18 }, { width: 18 },
    ];

    // Título
    wsResumen.mergeCells('A1:D1');
    const titulo = wsResumen.getCell('A1');
    titulo.value = `CONCENTRADO DE FACTURAS — ${mes}/${anio}`;
    titulo.font = { bold: true, size: 16, color: { argb: 'FF7C3AED' } };
    titulo.alignment = { horizontal: 'center' };
    wsResumen.getRow(1).height = 28;

    wsResumen.mergeCells('A2:D2');
    const subtitulo = wsResumen.getCell('A2');
    subtitulo.value = `Generado: ${hoy.toLocaleString('es-MX')}`;
    subtitulo.font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
    subtitulo.alignment = { horizontal: 'center' };

    // Resumen emitidas
    wsResumen.getCell('A4').value = 'FACTURAS EMITIDAS';
    wsResumen.getCell('A4').font = { bold: true, size: 12, color: { argb: 'FF10B981' } };
    const totalEmitido = emitidas.reduce((s, f) => s + f.total, 0);
    const ivaEmitido = emitidas.reduce((s, f) => s + f.totalImpuestos, 0);
    const subtotalEmitido = emitidas.reduce((s, f) => s + f.subtotal, 0);

    wsResumen.addRow(['Cantidad de facturas', emitidas.length, '', '']);
    wsResumen.addRow(['Subtotal', subtotalEmitido, '', '']);
    wsResumen.addRow(['IVA', ivaEmitido, '', '']);
    wsResumen.addRow(['Total', totalEmitido, '', '']);
    wsResumen.addRow([]);

    // Resumen recibidas
    wsResumen.getCell('A10').value = 'FACTURAS RECIBIDAS';
    wsResumen.getCell('A10').font = { bold: true, size: 12, color: { argb: 'FFF97316' } };
    const totalRecibido = recibidas.reduce((s, f) => s + f.total, 0);
    const ivaRecibido = recibidas.reduce((s, f) => s + f.totalImpuestos, 0);
    const subtotalRecibido = recibidas.reduce((s, f) => s + f.subtotal, 0);

    wsResumen.addRow(['Cantidad de facturas', recibidas.length, '', '']);
    wsResumen.addRow(['Subtotal', subtotalRecibido, '', '']);
    wsResumen.addRow(['IVA acreditable', ivaRecibido, '', '']);
    wsResumen.addRow(['Total', totalRecibido, '', '']);
    wsResumen.addRow([]);

    // IVA por pagar
    wsResumen.getCell('A16').value = 'IVA POR PAGAR';
    wsResumen.getCell('A16').font = { bold: true, size: 12, color: { argb: 'FFEF4444' } };
    wsResumen.addRow(['IVA trasladado', ivaEmitido, '', '']);
    wsResumen.addRow(['IVA acreditable', ivaRecibido, '', '']);
    wsResumen.addRow(['IVA a cargo del SAT', ivaEmitido - ivaRecibido, '', '']);

    // Formato moneda
    [5, 6, 7, 8, 11, 12, 13, 14, 17, 18, 19].forEach(row => {
      const cell = wsResumen.getCell(`B${row}`);
      if (typeof cell.value === 'number') {
        cell.numFmt = '"$"#,##0.00';
        cell.font = { bold: true };
      }
    });

    // ===== Hoja 2: Emitidas =====
    const wsEmitidas = wb.addWorksheet('Emitidas');
    wsEmitidas.columns = [
      { header: 'Folio', key: 'folio', width: 12 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'UUID', key: 'uuid', width: 36 },
      { header: 'Cliente', key: 'cliente', width: 30 },
      { header: 'RFC Receptor', key: 'rfc', width: 16 },
      { header: 'Concepto', key: 'concepto', width: 25 },
      { header: 'Subtotal', key: 'subtotal', width: 14 },
      { header: 'IVA', key: 'iva', width: 12 },
      { header: 'Total', key: 'total', width: 14 },
      { header: 'Estado', key: 'estado', width: 12 },
    ];

    // Estilo encabezado
    wsEmitidas.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    wsEmitidas.getRow(1).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' },
    };
    wsEmitidas.getRow(1).alignment = { horizontal: 'center' };

    emitidas.forEach(f => {
      const row = wsEmitidas.addRow({
        folio: f.folio,
        fecha: new Date(f.fecha).toLocaleDateString('es-MX'),
        uuid: f.uuid || '',
        cliente: f.receptorNombre || f.cliente?.nombre || '',
        rfc: f.receptorRfc || '',
        concepto: f.concepto || '',
        subtotal: f.subtotal,
        iva: f.totalImpuestos,
        total: f.total,
        estado: f.estado,
      });
      row.getCell(7).numFmt = '"$"#,##0.00';
      row.getCell(8).numFmt = '"$"#,##0.00';
      row.getCell(9).numFmt = '"$"#,##0.00';
    });

    // Total general
    const totalRowE = wsEmitidas.addRow({
      folio: 'TOTAL',
      subtotal: subtotalEmitido,
      iva: ivaEmitido,
      total: totalEmitido,
    });
    totalRowE.font = { bold: true };
    totalRowE.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
    totalRowE.getCell(7).numFmt = '"$"#,##0.00';
    totalRowE.getCell(8).numFmt = '"$"#,##0.00';
    totalRowE.getCell(9).numFmt = '"$"#,##0.00';

    // ===== Hoja 3: Recibidas =====
    const wsRecibidas = wb.addWorksheet('Recibidas');
    wsRecibidas.columns = [
      { header: 'Folio', key: 'folio', width: 12 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'UUID', key: 'uuid', width: 36 },
      { header: 'Proveedor', key: 'proveedor', width: 30 },
      { header: 'RFC Emisor', key: 'rfc', width: 16 },
      { header: 'Concepto', key: 'concepto', width: 25 },
      { header: 'Subtotal', key: 'subtotal', width: 14 },
      { header: 'IVA', key: 'iva', width: 12 },
      { header: 'Total', key: 'total', width: 14 },
      { header: 'Estado', key: 'estado', width: 12 },
    ];

    wsRecibidas.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    wsRecibidas.getRow(1).fill = {
      type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF97316' },
    };
    wsRecibidas.getRow(1).alignment = { horizontal: 'center' };

    recibidas.forEach(f => {
      const row = wsRecibidas.addRow({
        folio: f.folio,
        fecha: new Date(f.fecha).toLocaleDateString('es-MX'),
        uuid: f.uuid || '',
        proveedor: f.emisorNombre || f.proveedor?.nombre || '',
        rfc: f.emisorRfc || '',
        concepto: f.concepto || '',
        subtotal: f.subtotal,
        iva: f.totalImpuestos,
        total: f.total,
        estado: f.estado,
      });
      row.getCell(7).numFmt = '"$"#,##0.00';
      row.getCell(8).numFmt = '"$"#,##0.00';
      row.getCell(9).numFmt = '"$"#,##0.00';
    });

    const totalRowR = wsRecibidas.addRow({
      folio: 'TOTAL',
      subtotal: subtotalRecibido,
      iva: ivaRecibido,
      total: totalRecibido,
    });
    totalRowR.font = { bold: true };
    totalRowR.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFED7AA' } };
    totalRowR.getCell(7).numFmt = '"$"#,##0.00';
    totalRowR.getCell(8).numFmt = '"$"#,##0.00';
    totalRowR.getCell(9).numFmt = '"$"#,##0.00';

    // Generar buffer
    const buffer = await wb.xlsx.writeBuffer();

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="facturas_${anio}_${mes.toString().padStart(2, '0')}.xlsx"`,
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
