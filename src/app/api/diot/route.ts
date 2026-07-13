import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/diot?mes=7&anio=2026&formato=excel
 * Genera el DIOT (Declaración Informativa de Operaciones con Terceros).
 *
 * El DIOT reporta operaciones con proveedores (facturas recibidas).
 * Por cada proveedor con RFC, se reporta:
 *   - RFC
 *   - Nombre/razón social
 *   - Tipo de tercero (15 = proveedor)
 *   - Tipo de operación (3 = pago parcial/definitivo)
 *   - Base (subtotal sin IVA)
 *   - IVA acreditable
 *
 * Si formato=excel, descarga archivo .xlsx
 * Si no, devuelve JSON
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const mes = parseInt(searchParams.get('mes') ?? String(hoy.getMonth() + 1));
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));
    const formato = searchParams.get('formato') || 'json';
    const empresaId = searchParams.get('empresaId') || undefined;

    const inicio = new Date(anio, mes - 1, 1);
    const fin = new Date(anio, mes, 0, 23, 59, 59);

    // Obtener facturas recibidas del periodo (filtradas por empresa)
    const facturas = await db.factura.findMany({
      where: {
        direccion: 'recibida',
        fecha: { gte: inicio, lte: fin },
        estado: 'timbrada',
        ...(empresaId ? { empresaId } : {}),
      },
    });

    // Agrupar por proveedor (RFC)
    const porProveedor = new Map<string, {
      rfc: string;
      nombre: string;
      baseGrabable: number;
      ivaAcreditable: number;
      noGravado: number;
      count: number;
    }>();

    for (const f of facturas) {
      const rfc = f.emisorRfc || 'SIN_RFC';
      const existing = porProveedor.get(rfc);
      if (existing) {
        existing.baseGrabable += f.subtotal;
        existing.ivaAcreditable += f.totalImpuestos;
        existing.count += 1;
      } else {
        porProveedor.set(rfc, {
          rfc,
          nombre: f.emisorNombre || 'Sin nombre',
          baseGrabable: f.subtotal,
          ivaAcreditable: f.totalImpuestos,
          noGravado: 0,
          count: 1,
        });
      }
    }

    const proveedoresDIOT = Array.from(porProveedor.values()).map(p => ({
      rfc: p.rfc,
      nombre: p.nombre,
      tipoTercero: 15, // 15 = proveedor
      tipoOperacion: 3, // 3 = pago parcial o definitivo
      baseGrabable: p.baseGrabable,
      ivaAcreditable: p.ivaAcreditable,
      ivaNoAcreditable: 0,
      noGravado: p.noGravado,
      facturas: p.count,
    }));

    const totalBase = proveedoresDIOT.reduce((s, p) => s + p.baseGrabable, 0);
    const totalIVA = proveedoresDIOT.reduce((s, p) => s + p.ivaAcreditable, 0);

    if (formato === 'excel') {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Sistema Fiscal IA';
      wb.created = new Date();

      const ws = wb.addWorksheet('DIOT');
      ws.columns = [
        { header: 'RFC', key: 'rfc', width: 18 },
        { header: 'Nombre / Razón Social', key: 'nombre', width: 35 },
        { header: 'Tipo de Tercero', key: 'tipoTercero', width: 18 },
        { header: 'Tipo de Operación', key: 'tipoOperacion', width: 20 },
        { header: 'Base Grabable', key: 'baseGrabable', width: 16 },
        { header: 'IVA Acreditable', key: 'ivaAcreditable', width: 16 },
        { header: 'IVA No Acreditable', key: 'ivaNoAcreditable', width: 18 },
        { header: 'Importe No Gravado', key: 'noGravado', width: 18 },
        { header: 'Facturas', key: 'facturas', width: 10 },
      ];

      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
      ws.getRow(1).alignment = { horizontal: 'center' };

      proveedoresDIOT.forEach(p => {
        const row = ws.addRow(p);
        row.getCell(5).numFmt = '"$"#,##0.00';
        row.getCell(6).numFmt = '"$"#,##0.00';
        row.getCell(7).numFmt = '"$"#,##0.00';
        row.getCell(8).numFmt = '"$"#,##0.00';
      });

      const totalRow = ws.addRow({
        rfc: 'TOTALES',
        baseGrabable: totalBase,
        ivaAcreditable: totalIVA,
      });
      totalRow.font = { bold: true };
      totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
      totalRow.getCell(5).numFmt = '"$"#,##0.00';
      totalRow.getCell(6).numFmt = '"$"#,##0.00';

      // Hoja de instrucciones
      const wsInst = wb.addWorksheet('Instrucciones', { views: [{ showGridLines: false }] });
      wsInst.columns = [{ width: 50 }, { width: 70 }];
      wsInst.getCell('A1').value = `DIOT — Declaración Informativa de Operaciones con Terceros`;
      wsInst.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF7C3AED' } };
      wsInst.addRow([]);
      wsInst.addRow(['Periodo', `${mes}/${anio}`]);
      wsInst.addRow(['Proveedores reportados', String(proveedoresDIOT.length)]);
      wsInst.addRow(['Total base grabable', `$${totalBase.toFixed(2)}`]);
      wsInst.addRow(['Total IVA acreditable', `$${totalIVA.toFixed(2)}`]);
      wsInst.addRow([]);
      wsInst.addRow(['Instrucciones', '']);
      wsInst.addRow(['1.', 'Genera este reporte mensual con todas las facturas recibidas (compras/gastos).']);
      wsInst.addRow(['2.', 'Tipo de tercero 15 = Proveedor de bienes y servicios.']);
      wsInst.addRow(['3.', 'Tipo de operación 3 = Pago parcial o definitivo.']);
      wsInst.addRow(['4.', 'Sube este archivo al portal del SAT en la sección "Declaraciones informativas".']);
      wsInst.addRow(['5.', 'El plazo para presentar el DIOT es dentro de los primeros 10 días del mes siguiente.']);

      const buffer = await wb.xlsx.writeBuffer();
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="diot_${anio}_${String(mes).padStart(2, '0')}.xlsx"`,
        },
      });
    }

    return NextResponse.json({
      periodo: { mes, anio },
      proveedores: proveedoresDIOT,
      totalProveedores: proveedoresDIOT.length,
      totalBaseGrabable: totalBase,
      totalIVAAcreditable: totalIVA,
      totalFacturas: facturas.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
