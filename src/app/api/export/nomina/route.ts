import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/export/nomina?mes=7&anio=2026
 * Genera Excel con concentrado de nómina del mes.
 * Hojas: Recibos, Resumen por empleado, Totales.
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

    const recibos = await db.reciboNomina.findMany({
      where: { fecha: { gte: inicio, lte: fin } },
      include: { empleado: true },
      orderBy: { fecha: 'asc' },
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema Fiscal IA';
    wb.created = new Date();

    // ===== Hoja 1: Recibos detallados =====
    const ws = wb.addWorksheet('Nómina Detallada');
    ws.columns = [
      { header: 'Folio', key: 'folio', width: 14 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Empleado', key: 'empleado', width: 28 },
      { header: 'RFC', key: 'rfc', width: 16 },
      { header: 'Puesto', key: 'puesto', width: 20 },
      { header: 'Departamento', key: 'depto', width: 16 },
      { header: 'Periodo', key: 'periodo', width: 22 },
      { header: 'Percepciones', key: 'percepciones', width: 15 },
      { header: 'ISR', key: 'isr', width: 12 },
      { header: 'IMSS', key: 'imss', width: 12 },
      { header: 'Deducciones', key: 'deducciones', width: 14 },
      { header: 'Neto pagado', key: 'neto', width: 15 },
      { header: 'Estado', key: 'estado', width: 12 },
    ];

    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    ws.getRow(1).alignment = { horizontal: 'center' };

    recibos.forEach(r => {
      const row = ws.addRow({
        folio: r.folio,
        fecha: new Date(r.fecha).toLocaleDateString('es-MX'),
        empleado: r.empleado.nombre,
        rfc: r.empleado.rfc,
        puesto: r.empleado.puesto || '',
        depto: r.empleado.departamento || '',
        periodo: r.periodo || '',
        percepciones: r.totalPercepciones,
        isr: r.isr,
        imss: r.imss,
        deducciones: r.totalDeducciones,
        neto: r.neto,
        estado: r.estado,
      });
      [8, 9, 10, 11, 12].forEach(c => row.getCell(c).numFmt = '"$"#,##0.00');
    });

    // Totales
    const totalPercepciones = recibos.reduce((s, r) => s + r.totalPercepciones, 0);
    const totalISR = recibos.reduce((s, r) => s + r.isr, 0);
    const totalIMSS = recibos.reduce((s, r) => s + r.imss, 0);
    const totalDeducciones = recibos.reduce((s, r) => s + r.totalDeducciones, 0);
    const totalNeto = recibos.reduce((s, r) => s + r.neto, 0);

    const totalRow = ws.addRow({
      folio: 'TOTALES',
      percepciones: totalPercepciones,
      isr: totalISR,
      imss: totalIMSS,
      deducciones: totalDeducciones,
      neto: totalNeto,
    });
    totalRow.font = { bold: true };
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    [8, 9, 10, 11, 12].forEach(c => totalRow.getCell(c).numFmt = '"$"#,##0.00');

    // ===== Hoja 2: Resumen =====
    const wsResumen = wb.addWorksheet('Resumen', { views: [{ showGridLines: false }] });
    wsResumen.columns = [{ width: 35 }, { width: 20 }];

    wsResumen.mergeCells('A1:B1');
    const titulo = wsResumen.getCell('A1');
    titulo.value = `CONCENTRADO DE NÓMINA — ${mes}/${anio}`;
    titulo.font = { bold: true, size: 16, color: { argb: 'FF7C3AED' } };
    titulo.alignment = { horizontal: 'center' };
    wsResumen.getRow(1).height = 28;

    wsResumen.addRow([]);
    wsResumen.addRow(['Recibos procesados', recibos.length]);
    wsResumen.addRow(['Empleados', new Set(recibos.map(r => r.empleadoId)).size]);
    wsResumen.addRow([]);
    wsResumen.addRow(['Total percepciones', totalPercepciones]);
    wsResumen.addRow(['ISR retenido', totalISR]);
    wsResumen.addRow(['IMSS obrero', totalIMSS]);
    wsResumen.addRow(['Total deducciones', totalDeducciones]);
    wsResumen.addRow(['Total neto pagado', totalNeto]);
    wsResumen.addRow([]);
    wsResumen.addRow(['Costo total para la empresa', totalPercepciones + totalIMSS * 5.43]); // Aproximación

    // Formato
    [5, 6, 7, 8, 9, 11].forEach(row => {
      const cell = wsResumen.getCell(`B${row}`);
      if (typeof cell.value === 'number') {
        cell.numFmt = '"$"#,##0.00';
        cell.font = { bold: true };
      }
    });

    const buffer = await wb.xlsx.writeBuffer();

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="nomina_${anio}_${mes.toString().padStart(2, '0')}.xlsx"`,
      },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
