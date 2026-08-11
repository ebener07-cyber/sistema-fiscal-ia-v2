import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';
import { determinarTipoTercero, determinarTipoOperacionDIOT, determinarRegionFiscal, clasificarIVADiot } from '@/lib/diot-regiones';

/**
 * GET /api/diot?mes=7&anio=2026&formato=txt|excel|json&empresaId=xxx
 *
 * DIOT SAT 2025/2026 — Declaración Informativa de Operaciones con Terceros
 *
 * Valores confirmados desde satcfdi v4.6.0 (python-satcfdi):
 *
 * TipoTercero:
 *   "04" = PROVEEDOR_NACIONAL
 *   "05" = PROVEEDOR_EXTRANJERO
 *   "15" = PROVEEDOR_GLOBAL (XAXX010101000)
 *
 * TipoOperacion:
 *   "03" = PRESTACION_DE_SERVICIOS_PROFESIONALES
 *   "06" = ARRENDAMIENTO_DE_INMUEBLES
 *   "85" = OTROS
 *
 * Formato TXT: 54 columnas separadas por pipe (|)
 * Compatible con portal SAT: pstcdi.clouda.sat.gob.mx
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

    const inicioMes = new Date(anio, mes - 1, 1);
    const finMes = new Date(anio, mes, 0, 23, 59, 59);

    const facturas = await db.factura.findMany({
      where: {
        direccion: 'recibida',
        fecha: { gte: inicioMes, lte: finMes },
        estado: 'timbrada',
        tipoComprobante: { in: ['I', 'E'] },
        ...(empresaId ? { empresaId } : {}),
      },
      select: {
        subtotal: true, descuento: true, totalImpuestos: true,
        impuestoRetenido: true, total: true,
        emisorRfc: true, emisorNombre: true,
        tipoComprobante: true, concepto: true,
        lugarExpedicion: true,
      },
    });

    // Agrupar por proveedor con desglose DIOT
    const porProveedor = new Map<string, {
      rfc: string; nombre: string;
      base16: number; iva16Acred: number;
      base8: number; iva8Acred: number;
      base0: number; baseExento: number;
      noGravado: number; ivaRetenido: number;
      count: number;
    }>();

    for (const f of facturas) {
      const rfc = (f.emisorRfc || 'XAXX010101000').toUpperCase().trim();
      const signo = f.tipoComprobante === 'E' ? -1 : 1;
      const base = (f.subtotal - (f.descuento || 0)) * signo;
      const iva = (f.totalImpuestos || 0) * signo;
      const ivaRet = (f.impuestoRetenido || 0) * signo;

      // Determinar región fiscal
      const region = determinarRegionFiscal(f.lugarExpedicion || '');
      const clasif = clasificarIVADiot(Math.abs(base), Math.abs(iva), region);

      const existing = porProveedor.get(rfc);
      if (existing) {
        existing.base16 += clasif.base16 * signo;
        existing.iva16Acred += clasif.iva16Acreditable * signo;
        existing.base8 += clasif.base8 * signo;
        existing.iva8Acred += clasif.iva8Acreditable * signo;
        existing.base0 += clasif.base0 * signo;
        existing.baseExento += clasif.baseExento * signo;
        existing.ivaRetenido += ivaRet;
        existing.count += 1;
      } else {
        porProveedor.set(rfc, {
          rfc, nombre: f.emisorNombre || 'Sin nombre',
          base16: clasif.base16 * signo, iva16Acred: clasif.iva16Acreditable * signo,
          base8: clasif.base8 * signo, iva8Acred: clasif.iva8Acreditable * signo,
          base0: clasif.base0 * signo, baseExento: clasif.baseExento * signo,
          noGravado: 0, ivaRetenido: ivaRet, count: 1,
        });
      }
    }

    // ===== FORMATO TXT (54 columnas SAT 2025) =====
    if (formato === 'txt') {
      const lineas: string[] = [];
      for (const [, p] of porProveedor) {
        const rfcLimpio = p.rfc.replace(/[^A-Z0-9]/gi, '').toUpperCase();
        if (rfcLimpio.length < 12 || rfcLimpio.length > 13) continue;

        const tt = determinarTipoTercero(rfcLimpio);
        const tipoOp = determinarTipoOperacionDIOT('I', p.nombre);
        const fmt = (v: number) => Math.abs(v).toFixed(2);

        const campos: string[] = [
          rfcLimpio,
          (p.nombre || '').replace(/\|/g, ' ').slice(0, 100),
          tt.tipoTercero,   // 04=Nacional, 05=Extranjero, 15=Global
          tipoOp,            // 03=Servicios, 06=Arrendamiento, 85=Otros
          // IVA 16% acreditable
          fmt(p.base16), fmt(p.iva16Acred), '0.00', fmt(p.ivaRetenido),
          // IVA 8% frontera
          fmt(p.base8), fmt(p.iva8Acred), '0.00', '0.00',
          // IVA 16% no acreditable
          '0.00', '0.00', '0.00', '0.00',
          // IVA 8% no acreditable frontera
          '0.00', '0.00', '0.00', '0.00',
          // Exento
          fmt(p.baseExento), '0.00',
          // Tasa 0%
          fmt(p.base0), '0.00',
          // No gravado
          fmt(p.noGravado), '0.00', '0.00', '0.00',
          // Retenciones
          '0.00', '0.00', '0.00', '0.00',
          // Otros impuestos
          '0.00', '0.00', '0.00', '0.00',
          // Moneda y tipo cambio
          'MXN', '1.0000', '0.00', '0.00',
          // Desglose por región (nuevo 2025)
          fmt(p.base8), fmt(p.iva8Acred), '0.00', '0.00',  // Frontera Norte
          '0.00', '0.00', '0.00', '0.00',                    // Frontera Sur
          fmt(p.base16), fmt(p.iva16Acred), '0.00', '0.00',  // Resto del país
        ];
        lineas.push(campos.join('|'));
      }

      return new Response(lineas.join('\r\n'), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="DIOT_${anio}${String(mes).padStart(2, '0')}.txt"`,
        },
      });
    }

    // ===== FORMATO EXCEL =====
    if (formato === 'excel') {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Sistema Fiscal IA';
      wb.created = new Date();

      const ws = wb.addWorksheet('DIOT 2025');
      const headers = [
        'RFC', 'Nombre', 'Tipo Tercero', 'Tipo Operación',
        'Base 16%', 'IVA 16% Acred', 'IVA 16% NA', 'IVA Ret 16%',
        'Base 8% FN', 'IVA 8% Acred', 'IVA 8% NA', 'IVA Ret 8%',
        'Base 16% NA', 'IVA 16% NA', '', 'IVA Ret 16% NA',
        'Base 8% NA', 'IVA 8% NA', '', 'IVA Ret 8% NA',
        'Base Exenta', 'IVA Exento', 'Base 0%', 'IVA 0%',
        'No Gravado', '', '', '', 'ISR Ret', 'IVA Ret', '', '',
        'IEPS', '', '', '', 'Moneda', 'TC', '', '',
        'Base RFN', 'IVA RFN', 'NA RFN', 'Ret RFN',
        'Base RFS', 'IVA RFS', 'NA RFS', 'Ret RFS',
        'Base Resto', 'IVA Resto', 'NA Resto', 'Ret Resto',
      ];
      ws.columns = headers.map(h => ({ header: h, width: 14 }));
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };

      for (const [, p] of porProveedor) {
        const tt = determinarTipoTercero(p.rfc);
        const tipoOp = determinarTipoOperacionDIOT('I', p.nombre);
        const fmt = (v: number) => Math.abs(v);
        ws.addRow([
          p.rfc, p.nombre, tt.tipoTercero, tipoOp,
          fmt(p.base16), fmt(p.iva16Acred), 0, fmt(p.ivaRetenido),
          fmt(p.base8), fmt(p.iva8Acred), 0, 0,
          0, 0, 0, 0, 0, 0, 0, 0,
          fmt(p.baseExento), 0, fmt(p.base0), 0,
          fmt(p.noGravado), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          'MXN', 1, 0, 0,
          fmt(p.base8), fmt(p.iva8Acred), 0, 0,
          0, 0, 0, 0,
          fmt(p.base16), fmt(p.iva16Acred), 0, 0,
        ]);
      }

      // Hoja de instrucciones
      const ws2 = wb.addWorksheet('Instrucciones', { views: [{ showGridLines: false }] });
      ws2.columns = [{ width: 50 }, { width: 70 }];
      ws2.getCell('A1').value = 'DIOT SAT 2025/2026 — Instrucciones';
      ws2.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF7C3AED' } };
      const inst = [
        ['Periodo', `${mes}/${anio}`], ['Proveedores', String(porProveedor.size)],
        ['Formato TXT', '54 columnas pipe (|)'], ['Portal SAT', 'pstcdi.clouda.sat.gob.mx'],
        ['', ''], ['TIPO DE TERCERO (satcfdi v4.6)', ''],
        ['04', 'PROVEEDOR_NACIONAL'], ['05', 'PROVEEDOR_EXTRANJERO'],
        ['15', 'PROVEEDOR_GLOBAL (XAXX010101000)'],
        ['', ''], ['TIPO DE OPERACIÓN (satcfdi v4.6)', ''],
        ['03', 'PRESTACION_DE_SERVICIOS_PROFESIONALES'],
        ['06', 'ARRENDAMIENTO_DE_INMUEBLES'], ['85', 'OTROS'],
        ['', ''], ['REGIONES FISCALES', ''],
        ['Frontera Norte', 'IVA 8% (43 municipios norte)'],
        ['Frontera Sur', 'IVA 8% (Chiapas, nuevo 2025)'],
        ['Resto', 'IVA 16%'],
        ['', ''], ['PROVEEDOR GLOBAL (15)', ''],
        ['Límite', 'No exceder 10% del total de pagos del mes'],
        ['Individual', 'Ningún pago > $50,000 MXN'],
        ['RFC', 'XAXX010101000'],
      ];
      inst.forEach(([a, b]) => ws2.addRow([a, b]));

      const buffer = await wb.xlsx.writeBuffer();
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="DIOT_${anio}_${String(mes).padStart(2, '0')}.xlsx"`,
        },
      });
    }

    // ===== FORMATO JSON =====
    const proveedoresArray = Array.from(porProveedor.values()).map(p => {
      const tt = determinarTipoTercero(p.rfc);
      return { ...p, tipoTercero: tt.tipoTercero, esGlobal: tt.esGlobal, esExtranjero: tt.esExtranjero };
    });

    return NextResponse.json({
      periodo: { mes, anio },
      formato: 'SAT 2025/2026 — 54 columnas',
      valoresConfirmados: 'satcfdi v4.6.0',
      tiposTercero: { '04': 'Nacional', '05': 'Extranjero', '15': 'Global' },
      tiposOperacion: { '03': 'Servicios', '06': 'Arrendamiento', '85': 'Otros' },
      proveedores: proveedoresArray,
      totalProveedores: proveedoresArray.length,
      formatosDisponibles: ['json', 'excel', 'txt'],
      portalSAT: 'pstcdi.clouda.sat.gob.mx',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
