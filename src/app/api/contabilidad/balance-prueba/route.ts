import { NextRequest, NextResponse } from 'next/server';
import { obtenerBalancePrueba, CATALOGO_CUENTAS } from '@/lib/agentes/motor-contabilidad';
import ExcelJS from 'exceljs';

/**
 * GET /api/contabilidad/balance-prueba?mes=6&anio=2026&empresaId=xxx&formato=excel|json
 *
 * Genera el Balance de Prueba con partida doble.
 * Muestra los saldos de todas las cuentas contables del periodo.
 *
 * Si formato=excel, descarga archivo con:
 * - Hoja 1: Balance de Prueba (saldos por cuenta)
 * - Hoja 2: Catálogo de cuentas
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const mes = parseInt(searchParams.get('mes') ?? String(hoy.getMonth() + 1));
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));
    const empresaId = searchParams.get('empresaId');
    const formato = searchParams.get('formato') || 'json';

    if (!empresaId) return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });

    const balance = await obtenerBalancePrueba(empresaId, mes, anio);
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    if (formato === 'excel') {
      const empresa = await (await import('@/lib/db')).db.empresa.findUnique({
        where: { id: empresaId },
        select: { nombre: true, rfc: true },
      });

      const wb = new ExcelJS.Workbook();
      wb.creator = 'Sistema Fiscal IA';
      wb.created = new Date();

      // ===== HOJA 1: BALANCE DE PRUEBA =====
      const ws = wb.addWorksheet('Balance de Prueba', { views: [{ showGridLines: false }] });
      ws.columns = [
        { width: 10 }, { width: 35 }, { width: 14 }, { width: 14 },
        { width: 14 }, { width: 14 }, { width: 10 }, { width: 14 },
      ];

      ws.mergeCells('A1:H1');
      ws.getCell('A1').value = `BALANCE DE PRUEBA — ${meses[mes - 1]} ${anio}`;
      ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF7C3AED' } };

      ws.mergeCells('A2:H2');
      ws.getCell('A2').value = `${empresa?.nombre} | RFC: ${empresa?.rfc}`;
      ws.getCell('A2').font = { bold: true };

      let r = 4;
      // Headers
      const headers = ['Código', 'Cuenta', 'Cargo', 'Abono', 'Saldo Deudor', 'Saldo Acreedor', 'Tipo', 'Naturaleza'];
      headers.forEach((h, i) => {
        ws.getCell(`${String.fromCharCode(65 + i)}${r}`).value = h;
        ws.getCell(`${String.fromCharCode(65 + i)}${r}`).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws.getCell(`${String.fromCharCode(65 + i)}${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
      });
      r++;

      // Datos
      for (const c of balance.cuentas) {
        ws.getCell(`A${r}`).value = c.codigo;
        ws.getCell(`B${r}`).value = c.nombre;
        ws.getCell(`C${r}`).value = c.cargos;
        ws.getCell(`D${r}`).value = c.abonos;
        ws.getCell(`E${r}`).value = c.saldo > 0 ? c.saldo : 0;
        ws.getCell(`F${r}`).value = c.saldo < 0 ? Math.abs(c.saldo) : 0;
        ws.getCell(`G${r}`).value = c.tipo;
        ws.getCell(`H${r}`).value = c.naturaleza;
        ws.getCell(`C${r}`).numFmt = '"$"#,##0.00';
        ws.getCell(`D${r}`).numFmt = '"$"#,##0.00';
        ws.getCell(`E${r}`).numFmt = '"$"#,##0.00';
        ws.getCell(`F${r}`).numFmt = '"$"#,##0.00';
        r++;
      }

      // Totales
      ws.getCell(`B${r}`).value = 'TOTALES';
      ws.getCell(`C${r}`).value = balance.totalCargos;
      ws.getCell(`D${r}`).value = balance.totalAbonos;
      ws.getCell(`E${r}`).value = balance.cuentas.reduce((s, c) => s + (c.saldo > 0 ? c.saldo : 0), 0);
      ws.getCell(`F${r}`).value = balance.cuentas.reduce((s, c) => s + (c.saldo < 0 ? Math.abs(c.saldo) : 0), 0);
      ws.getRow(r).font = { bold: true };
      ws.getRow(r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
      ws.getCell(`C${r}`).numFmt = '"$"#,##0.00';
      ws.getCell(`D${r}`).numFmt = '"$"#,##0.00';
      ws.getCell(`E${r}`).numFmt = '"$"#,##0.00';
      ws.getCell(`F${r}`).numFmt = '"$"#,##0.00';
      r += 2;

      ws.getCell(`B${r}`).value = '¿Balance cuadrado?';
      ws.getCell(`C${r}`).value = balance.cuadrado ? '✓ SÍ' : '⚠ NO';
      ws.getCell(`C${r}`).font = { bold: true, color: { argb: balance.cuadrado ? 'FF10B981' : 'FFEF4444' } };

      // ===== HOJA 2: CATÁLOGO DE CUENTAS =====
      const ws2 = wb.addWorksheet('Catálogo de Cuentas', { views: [{ showGridLines: false }] });
      ws2.columns = [{ width: 10 }, { width: 35 }, { width: 14 }, { width: 14 }];

      ws2.getCell('A1').value = 'CATÁLOGO DE CUENTAS CONTABLES';
      ws2.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF7C3AED' } };

      const headers2 = ['Código', 'Nombre', 'Tipo', 'Naturaleza'];
      headers2.forEach((h, i) => {
        ws2.getCell(`${String.fromCharCode(65 + i)}2`).value = h;
        ws2.getCell(`${String.fromCharCode(65 + i)}2`).font = { bold: true, color: { argb: 'FFFFFFFF' } };
        ws2.getCell(`${String.fromCharCode(65 + i)}2`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
      });

      let r2 = 3;
      for (const [codigo, cuenta] of Object.entries(CATALOGO_CUENTAS)) {
        ws2.getCell(`A${r2}`).value = codigo;
        ws2.getCell(`B${r2}`).value = cuenta.nombre;
        ws2.getCell(`C${r2}`).value = cuenta.tipo;
        ws2.getCell(`D${r2}`).value = cuenta.naturaleza;
        r2++;
      }

      const buffer = await wb.xlsx.writeBuffer();
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="BalancePrueba_${anio}${String(mes).padStart(2, '0')}_${empresa?.rfc}.xlsx"`,
        },
      });
    }

    return NextResponse.json({
      periodo: { mes, anio, mesNombre: meses[mes - 1] },
      ...balance,
    });
  } catch (e: any) {
    console.error('Error en balance-prueba:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
