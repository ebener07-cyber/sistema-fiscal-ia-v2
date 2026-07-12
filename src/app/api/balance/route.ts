import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/balance?anio=2026&formato=excel
 * Genera el Balance General (Estado de Situación Financiera).
 *
 * Estructura básica:
 *   ACTIVOS
 *     Activo circulante (bancos, cuentas por cobrar)
 *     Activo fijo (inventario, equipos)
 *   PASIVOS
 *     Pasivo circulante (IVA por pagar, cuentas por pagar)
 *     Pasivo fijo (préstamos)
 *   CAPITAL
 *     Capital contable (utilidades acumuladas)
 *
 * Si formato=excel, descarga .xlsx con formato profesional
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));
    const formato = searchParams.get('formato') || 'json';

    const inicioAnio = new Date(anio, 0, 1);
    const finAnio = new Date(anio, 11, 31, 23, 59, 59);

    // Obtener datos
    const [cuentasBancarias, facturasEmitidasAnio, facturasRecibidasAnio, productos] = await Promise.all([
      db.cuentaBancaria.findMany(),
      db.factura.findMany({ where: { direccion: 'emitida', fecha: { gte: inicioAnio, lte: finAnio } } }),
      db.factura.findMany({ where: { direccion: 'recibida', fecha: { gte: inicioAnio, lte: finAnio } } }),
      db.producto.findMany(),
    ]);

    // ===== ACTIVOS =====
    const efectivoBancos = cuentasBancarias.reduce((s, c) => s + c.saldo, 0);

    // Cuentas por cobrar (facturas emitidas no pagadas — simplificación: todas pendientes)
    const cuentasPorCobrar = facturasEmitidasAnio
      .filter(f => f.estado === 'timbrada')
      .reduce((s, f) => s + f.total, 0) * 0.3; // Aproximación: 30% sin cobrar

    const inventario = productos.reduce((s, p) => s + (p.existencia * p.precio), 0);

    const ivaAcreditable = facturasRecibidasAnio.reduce((s, f) => s + f.totalImpuestos, 0);

    const activoCirculante = efectivoBancos + cuentasPorCobrar + ivaAcreditable;
    const activoFijo = inventario;
    const totalActivo = activoCirculante + activoFijo;

    // ===== PASIVOS =====
    const ivaPorPagar = facturasEmitidasAnio.reduce((s, f) => s + f.totalImpuestos, 0) - ivaAcreditable;
    const cuentasPorPagar = facturasRecibidasAnio
      .filter(f => f.estado === 'timbrada')
      .reduce((s, f) => s + f.total, 0) * 0.4; // 40% sin pagar

    const pasivoCirculante = Math.max(0, ivaPorPagar) + cuentasPorPagar;
    const pasivoFijo = 0; // Préstamos a largo plazo (configurar manualmente)
    const totalPasivo = pasivoCirculante + pasivoFijo;

    // ===== CAPITAL =====
    const capitalContable = totalActivo - totalPasivo;

    const balance = {
      anio,
      activos: {
        circulante: {
          efectivoBancos,
          cuentasPorCobrar,
          ivaAcreditable,
          total: activoCirculante,
        },
        fijo: {
          inventario,
          total: activoFijo,
        },
        total: totalActivo,
      },
      pasivos: {
        circulante: {
          ivaPorPagar: Math.max(0, ivaPorPagar),
          cuentasPorPagar,
          total: pasivoCirculante,
        },
        fijo: {
          prestamosLargoPlazo: pasivoFijo,
          total: pasivoFijo,
        },
        total: totalPasivo,
      },
      capital: {
        capitalContable,
        total: capitalContable,
      },
      totalPasivoCapital: totalPasivo + capitalContable,
    };

    if (formato === 'excel') {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Sistema Fiscal IA';
      wb.created = new Date();

      const ws = wb.addWorksheet('Balance General', { views: [{ showGridLines: false }] });
      ws.columns = [{ width: 40 }, { width: 20 }, { width: 20 }];

      // Título
      ws.mergeCells('A1:C1');
      const titulo = ws.getCell('A1');
      titulo.value = `BALANCE GENERAL — ${anio}`;
      titulo.font = { bold: true, size: 16, color: { argb: 'FF7C3AED' } };
      titulo.alignment = { horizontal: 'center' };
      ws.getRow(1).height = 28;

      ws.mergeCells('A2:C2');
      const subtitulo = ws.getCell('A2');
      subtitulo.value = 'Estado de Situación Financiera';
      subtitulo.font = { italic: true, size: 11, color: { argb: 'FF64748B' } };
      subtitulo.alignment = { horizontal: 'center' };

      let row = 4;

      // ACTIVOS
      ws.getCell(`A${row}`).value = 'ACTIVOS';
      ws.getCell(`A${row}`).font = { bold: true, size: 13, color: { argb: 'FF10B981' } };
      row++;

      ws.getCell(`A${row}`).value = 'Activo Circulante';
      ws.getCell(`A${row}`).font = { bold: true };
      row++;
      ws.addRow(['Efectivo y bancos', efectivoBancos, '']);
      ws.addRow(['Cuentas por cobrar', cuentasPorCobrar, '']);
      ws.addRow(['IVA acreditable', ivaAcreditable, '']);
      ws.addRow(['Total activo circulante', '', activoCirculante]);
      ws.getCell(`A${row}`).font = { bold: true };
      ws.getCell(`C${row}`).font = { bold: true };
      ws.getCell(`C${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
      row += 5;

      ws.getCell(`A${row}`).value = 'Activo Fijo';
      ws.getCell(`A${row}`).font = { bold: true };
      row++;
      ws.addRow(['Inventario', inventario, '']);
      ws.addRow(['Total activo fijo', '', activoFijo]);
      ws.getCell(`A${row}`).font = { bold: true };
      ws.getCell(`C${row}`).font = { bold: true };
      ws.getCell(`C${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
      row += 2;

      ws.addRow(['TOTAL ACTIVOS', '', totalActivo]);
      ws.getCell(`A${row}`).font = { bold: true, size: 12 };
      ws.getCell(`C${row}`).font = { bold: true, size: 12 };
      ws.getCell(`C${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };
      ws.getCell(`C${row}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      row += 2;

      // PASIVOS
      ws.getCell(`A${row}`).value = 'PASIVOS';
      ws.getCell(`A${row}`).font = { bold: true, size: 13, color: { argb: 'FFEF4444' } };
      row++;

      ws.getCell(`A${row}`).value = 'Pasivo Circulante';
      ws.getCell(`A${row}`).font = { bold: true };
      row++;
      ws.addRow(['IVA por pagar', Math.max(0, ivaPorPagar), '']);
      ws.addRow(['Cuentas por pagar', cuentasPorPagar, '']);
      ws.addRow(['Total pasivo circulante', '', pasivoCirculante]);
      ws.getCell(`A${row}`).font = { bold: true };
      ws.getCell(`C${row}`).font = { bold: true };
      ws.getCell(`C${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
      row += 4;

      ws.getCell(`A${row}`).value = 'Pasivo Fijo';
      ws.getCell(`A${row}`).font = { bold: true };
      row++;
      ws.addRow(['Préstamos largo plazo', pasivoFijo, '']);
      ws.addRow(['Total pasivo fijo', '', pasivoFijo]);
      row += 2;

      ws.addRow(['TOTAL PASIVOS', '', totalPasivo]);
      ws.getCell(`A${row}`).font = { bold: true, size: 12 };
      ws.getCell(`C${row}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      ws.getCell(`C${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEF4444' } };
      row += 2;

      // CAPITAL
      ws.getCell(`A${row}`).value = 'CAPITAL CONTABLE';
      ws.getCell(`A${row}`).font = { bold: true, size: 13, color: { argb: 'FF7C3AED' } };
      row++;
      ws.addRow(['Capital contable (utilidades acumuladas)', capitalContable, '']);
      ws.addRow(['TOTAL CAPITAL', '', capitalContable]);
      ws.getCell(`A${row}`).font = { bold: true, size: 12 };
      ws.getCell(`C${row}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
      ws.getCell(`C${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
      row += 2;

      ws.addRow(['TOTAL PASIVO + CAPITAL', '', totalPasivo + capitalContable]);
      ws.getCell(`A${row}`).font = { bold: true, size: 12 };
      ws.getCell(`C${row}`).font = { bold: true, size: 12 };
      ws.getCell(`C${row}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF831843' } };
      ws.getCell(`C${row}`).font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };

      // Formato moneda a todas las celdas B y C con números
      for (let r = 6; r <= row; r++) {
        const cellB = ws.getCell(`B${r}`);
        const cellC = ws.getCell(`C${r}`);
        if (typeof cellB.value === 'number') cellB.numFmt = '"$"#,##0.00';
        if (typeof cellC.value === 'number') cellC.numFmt = '"$"#,##0.00';
      }

      const buffer = await wb.xlsx.writeBuffer();
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="balance_general_${anio}.xlsx"`,
        },
      });
    }

    return NextResponse.json(balance);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
