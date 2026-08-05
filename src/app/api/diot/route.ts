import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/diot?mes=7&anio=2026&formato=excel|txt|json&empresaId=xxx
 *
 * Genera el DIOT (Declaración Informativa de Operaciones con Terceros).
 *
 * FORMATOS:
 * - json (default): devuelve JSON con los datos
 * - excel: descarga archivo .xlsx con hoja DIOT + Instrucciones
 * - txt: descarga archivo .txt en formato pipe-delimited del SAT
 *        (archivo listo para subir al portal del SAT)
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
 * FORMATO TXT del SAT (Anexo 1):
 * |RFC|RAZON_SOCIAL|TIPO_TERCERO|TIPO_OPERACION|BASE_16|IVA_16_ACRED|IVA_16_NO_ACRED|BASE_8|IVA_8_ACRED|IVA_8_NO_ACRED|BASE_0|IVA_EXENTO|NO_GRAVADO|...
 *
 * Todos los importes en pesos (no miles), sin comas, sin signo.
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
      select: {
        folio: true,
        fecha: true,
        subtotal: true,
        descuento: true,
        totalImpuestos: true,
        impuestoRetenido: true,
        total: true,
        moneda: true,
        emisorRfc: true,
        emisorNombre: true,
        tipoComprobante: true,
      },
    });

    // Agrupar por proveedor (RFC)
    const porProveedor = new Map<string, {
      rfc: string;
      nombre: string;
      baseGrabable: number;
      ivaAcreditable: number;
      ivaRetenido: number;
      noGravado: number;
      count: number;
    }>();

    for (const f of facturas) {
      const rfc = f.emisorRfc || 'XAXX010101000';
      const existing = porProveedor.get(rfc);
      if (existing) {
        existing.baseGrabable += f.subtotal - f.descuento;
        existing.ivaAcreditable += f.totalImpuestos;
        existing.ivaRetenido += f.impuestoRetenido;
        existing.count += 1;
      } else {
        porProveedor.set(rfc, {
          rfc,
          nombre: f.emisorNombre || 'Sin nombre',
          baseGrabable: f.subtotal - f.descuento,
          ivaAcreditable: f.totalImpuestos,
          ivaRetenido: f.impuestoRetenido,
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
      ivaRetenido: p.ivaRetenido,
      noGravado: p.noGravado,
      facturas: p.count,
    }));

    const totalBase = proveedoresDIOT.reduce((s, p) => s + p.baseGrabable, 0);
    const totalIVA = proveedoresDIOT.reduce((s, p) => s + p.ivaAcreditable, 0);

    // ===== FORMATO TXT (LISTO PARA SUBIR AL SAT) =====
    if (formato === 'txt') {
      // Formato del SAT: campos separados por pipe (|)
      // Sin header, sin comillas, sin separadores de miles
      // Importes en pesos con 2 decimales (ej: 1234567.89)
      const lineas: string[] = [];

      for (const p of proveedoresDIOT) {
        // Solo incluir proveedores con RFC válido (12 o 13 caracteres)
        const rfcLimpio = p.rfc.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (rfcLimpio.length < 12 || rfcLimpio.length > 13) continue;

        // Llenar campos con ceros si están vacíos
        const base = p.baseGrabable.toFixed(2);
        const ivaAcred = p.ivaAcreditable.toFixed(2);
        const ivaNoAcred = p.ivaNoAcreditable.toFixed(2);
        const ivaRetenido = p.ivaRetenido.toFixed(2);
        const noGravado = p.noGravado.toFixed(2);

        // Formato: |RFC|RAZON_SOCIAL|TIPO_TERCERO|TIPO_OPERACION|
        //          BASE_16|IVA_16_ACRED|IVA_16_NO_ACRED|
        //          BASE_8|IVA_8_ACRED|IVA_8_NO_ACRED|
        //          BASE_0|IVA_EXENTO|NO_GRAVADO|IVA_RETENIDO|
        const linea = [
          rfcLimpio,
          (p.nombre || '').replace(/\|/g, ' ').slice(0, 100),
          String(p.tipoTercero),
          String(p.tipoOperacion),
          base,           // Base 16%
          ivaAcred,       // IVA 16% acreditable
          ivaNoAcred,     // IVA 16% no acreditable
          '0.00',         // Base 8%
          '0.00',         // IVA 8% acreditable
          '0.00',         // IVA 8% no acreditable
          '0.00',         // Base 0%
          '0.00',         // IVA exento
          noGravado,      // Importe no gravado
          ivaRetenido,    // IVA retenido
        ].join('|');

        lineas.push(linea);
      }

      const contenidoTxt = lineas.join('\r\n');

      return new Response(contenidoTxt, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="DIOT_${anio}${String(mes).padStart(2, '0')}.txt"`,
        },
      });
    }

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
        { header: 'IVA Retenido', key: 'ivaRetenido', width: 16 },
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
        row.getCell(9).numFmt = '"$"#,##0.00';
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
      wsInst.addRow(['6.', 'Para generar archivo TXT listo para subir al SAT, usa formato=txt']);

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
      formatosDisponibles: ['json', 'excel', 'txt'],
      instruccionTXT: 'Para generar archivo listo para subir al SAT, usa ?formato=txt',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
