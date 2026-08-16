import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';
import {
  determinarTipoTercero,
  determinarTipoOperacionDIOT,
  determinarRegionFiscal,
  clasificarIVADiot,
  ajustarEnteroCFF,
  buscarCodigoPais,
  CATALOGO_PAISES_SAT,
  type ClasificacionIVA,
} from '@/lib/diot-regiones';

/**
 * ============================================================================
 * DIOT — Declaración Informativa de Operaciones con Terceros
 * ----------------------------------------------------------------------------
 * Implementa el formato OFICIAL SAT 2025+ basado en:
 *   - Instructivo SAT "armado del archivo de carga masiva DIOT REV-2"
 *   - Ejemplo oficial "Ejemplo Carga 2025 en adelante..xlsx" (57 columnas)
 *   - satcfdi v4.6.0 (validación)
 *
 * Estructura del archivo .txt (54 campos separados por pipe "|"):
 *
 *   CAMPO  DESCRIPCIÓN                                                TIPO
 *   1      Tipo de tercero (04/05/15)                                 Obligatorio
 *   2      Tipo de operación (02/03/06/07/85/87)                      Obligatorio
 *   3      RFC (nacional/global) o vacío (extranjero)                 Condicional
 *   4      Número identificación fiscal extranjero                    Condicional
 *   5      Nombre del extranjero                                      Condicional
 *   6      País o jurisdicción de residencia (3 letras)               Condicional
 *   7      Especificar lugar (si país=ZZZ)                            Condicional
 *   8-17   Valor de actos o actividades (10 campos)                   Opcional
 *   18-27  IVA acreditable (10 campos)                                Opcional
 *   28-47  IVA no acreditable (20 campos)                             Opcional
 *   48     IVA retenido por contribuyente pagado                      Opcional
 *   49     Exentos importación                                        Opcional
 *   50     Exentos nacionales                                         Opcional
 *   51     Tasa 0%                                                    Opcional
 *   52     No objeto territorio nacional                              Opcional
 *   53     No objeto sin establecimiento                              Opcional
 *   54     Manifiesto efectos fiscales (01/02)                        Opcional
 *
 * Reglas de redondeo (Art. 20 CFF):
 *   - No permite decimales
 *   - .01 a .50 → unidad inmediata anterior
 *   - .51 a .99 → unidad inmediata superior
 *
 * Codificación: UTF-8
 * Separador: pipe "|"
 *
 * GET /api/diot?mes=7&anio=2026&formato=txt|excel|json&empresaId=xxx
 * ============================================================================
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface ProveedorDIOT {
  rfc: string;
  nombre: string;
  numeroIdFiscal: string; // extranjeros
  paisResidencia: string; // 3 letras ISO
  especificarLugar: string;
  count: number;
  // Acumuladores por región
  clasif: ClasificacionIVA;
}

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
        subtotal: true,
        descuento: true,
        totalImpuestos: true,
        impuestoRetenido: true,
        total: true,
        emisorRfc: true,
        emisorNombre: true,
        tipoComprobante: true,
        concepto: true,
      },
    });

    // =========================================================================
    // AGRUPAR POR PROVEEDOR + ACUMULAR POR REGIÓN
    // =========================================================================
    const porProveedor = new Map<string, ProveedorDIOT>();

    for (const f of facturas) {
      const rfc = (f.emisorRfc || 'XAXX010101000').toUpperCase().trim();
      const signo = f.tipoComprobante === 'E' ? -1 : 1;
      const base = (f.subtotal - (f.descuento || 0)) * signo;
      const iva = (f.totalImpuestos || 0) * signo;
      const ivaRet = (f.impuestoRetenido || 0) * signo;

      // Sin LugarExpedicion en schema actual → usar "resto" por defecto
      const region = determinarRegionFiscal(null);
      const exento = Math.abs(iva) < 0.01 && (f.concepto || '').toUpperCase().includes('EXENTO');
      const tasaCero = Math.abs(iva) < 0.01 && !exento;
      const clasif = clasificarIVADiot(base, iva, region, ivaRet, exento, tasaCero);

      const existing = porProveedor.get(rfc);
      if (existing) {
        existing.count += 1;
        sumarClasificacion(existing.clasif, clasif);
      } else {
        porProveedor.set(rfc, {
          rfc,
          nombre: f.emisorNombre || 'Sin nombre',
          numeroIdFiscal: '',
          paisResidencia: '',
          especificarLugar: '',
          count: 1,
          clasif: { ...clasif },
        });
      }
    }

    // =========================================================================
    // GENERAR FILAS DIOT
    // =========================================================================
    interface FilaDIOT {
      // Datos del tercero (1-7)
      tipoTercero: string;
      tipoOperacion: string;
      rfc: string;
      numeroIdFiscal: string;
      nombreExtranjero: string;
      paisResidencia: string;
      especificarLugar: string;
      // Valor actos o actividades (8-17)
      baseFronteraNorte: number;
      devolucionesFronteraNorte: number;
      baseFronteraSur: number;
      devolucionesFronteraSur: number;
      base16: number;
      devoluciones16: number;
      baseImportacionTangible16: number;
      devolucionesImportacionTangible16: number;
      baseImportacionIntangible16: number;
      devolucionesImportacionIntangible16: number;
      // IVA acreditable (18-27)
      ivaAcredFNExclusivo: number;
      ivaAcredFNProporcion: number;
      ivaAcredFSExclusivo: number;
      ivaAcredFSProporcion: number;
      ivaAcred16Exclusivo: number;
      ivaAcred16Proporcion: number;
      ivaAcredImpTan16Excl: number;
      ivaAcredImpTan16Prop: number;
      ivaAcredImpInt16Excl: number;
      ivaAcredImpInt16Prop: number;
      // IVA no acreditable (28-47)
      ivaNoAcredFNProporcion: number;
      ivaNoAcredFNNoRequisito: number;
      ivaNoAcredFNExenta: number;
      ivaNoAcredFNNoObjeto: number;
      ivaNoAcredFSProporcion: number;
      ivaNoAcredFSNoRequisito: number;
      ivaNoAcredFSExenta: number;
      ivaNoAcredFSNoObjeto: number;
      ivaNoAcred16Proporcion: number;
      ivaNoAcred16NoRequisito: number;
      ivaNoAcred16Exenta: number;
      ivaNoAcred16NoObjeto: number;
      ivaNoAcredImpTan16Prop: number;
      ivaNoAcredImpTan16NoReq: number;
      ivaNoAcredImpTan16Exenta: number;
      ivaNoAcredImpTan16NoObj: number;
      ivaNoAcredImpInt16Prop: number;
      ivaNoAcredImpInt16NoReq: number;
      ivaNoAcredImpInt16Exenta: number;
      ivaNoAcredImpInt16NoObj: number;
      // Datos adicionales (48-54)
      ivaRetenidoPagado: number;
      exentoImportacion: number;
      exentoNacional: number;
      tasa0: number;
      noObjetoNacional: number;
      noObjetoSinEstablecimiento: number;
      manifiesto: string;
    }

    const filas: Array<{ proveedor: ProveedorDIOT; fila: FilaDIOT }> = [];

    for (const [, p] of porProveedor) {
      const tt = determinarTipoTercero(p.rfc);
      const tipoOp = determinarTipoOperacionDIOT('I', p.nombre, tt.esExtranjero);

      // Datos del tercero
      const rfcCampo = tt.esExtranjero ? '' : p.rfc;
      const numeroIdFiscal = tt.esExtranjero ? p.numeroIdFiscal : '';
      const nombreExtranjero = tt.esExtranjero ? p.nombre : '';
      const paisResidencia = tt.esExtranjero ? (p.paisResidencia || 'ZZZ') : '';
      const especificarLugar = tt.esExtranjero && paisResidencia === 'ZZZ' ? (p.especificarLugar || '') : '';

      const fila: FilaDIOT = {
        tipoTercero: tt.tipoTercero,
        tipoOperacion: tipoOp,
        rfc: rfcCampo,
        numeroIdFiscal,
        nombreExtranjero,
        paisResidencia,
        especificarLugar,
        // Valor actos o actividades
        baseFronteraNorte: ajustarEnteroCFF(p.clasif.baseFronteraNorte),
        devolucionesFronteraNorte: ajustarEnteroCFF(p.clasif.devolucionesFronteraNorte),
        baseFronteraSur: ajustarEnteroCFF(p.clasif.baseFronteraSur),
        devolucionesFronteraSur: ajustarEnteroCFF(p.clasif.devolucionesFronteraSur),
        base16: ajustarEnteroCFF(p.clasif.base16),
        devoluciones16: ajustarEnteroCFF(p.clasif.devoluciones16),
        baseImportacionTangible16: ajustarEnteroCFF(p.clasif.baseImportacionTangible16),
        devolucionesImportacionTangible16: ajustarEnteroCFF(p.clasif.devolucionesImportacionTangible16),
        baseImportacionIntangible16: ajustarEnteroCFF(p.clasif.baseImportacionIntangible16),
        devolucionesImportacionIntangible16: ajustarEnteroCFF(p.clasif.devolucionesImportacionIntangible16),
        // IVA acreditable
        ivaAcredFNExclusivo: ajustarEnteroCFF(p.clasif.ivaAcredFNExclusivo),
        ivaAcredFNProporcion: ajustarEnteroCFF(p.clasif.ivaAcredFNProporcion),
        ivaAcredFSExclusivo: ajustarEnteroCFF(p.clasif.ivaAcredFSExclusivo),
        ivaAcredFSProporcion: ajustarEnteroCFF(p.clasif.ivaAcredFSProporcion),
        ivaAcred16Exclusivo: ajustarEnteroCFF(p.clasif.ivaAcred16Exclusivo),
        ivaAcred16Proporcion: ajustarEnteroCFF(p.clasif.ivaAcred16Proporcion),
        ivaAcredImpTan16Excl: ajustarEnteroCFF(p.clasif.ivaAcredImpTan16Excl),
        ivaAcredImpTan16Prop: ajustarEnteroCFF(p.clasif.ivaAcredImpTan16Prop),
        ivaAcredImpInt16Excl: ajustarEnteroCFF(p.clasif.ivaAcredImpInt16Excl),
        ivaAcredImpInt16Prop: ajustarEnteroCFF(p.clasif.ivaAcredImpInt16Prop),
        // IVA no acreditable (todos 0 por defecto — se podrían calcular si hubiera proporción)
        ivaNoAcredFNProporcion: ajustarEnteroCFF(p.clasif.ivaNoAcredFNProporcion),
        ivaNoAcredFNNoRequisito: ajustarEnteroCFF(p.clasif.ivaNoAcredFNNoRequisito),
        ivaNoAcredFNExenta: ajustarEnteroCFF(p.clasif.ivaNoAcredFNExenta),
        ivaNoAcredFNNoObjeto: ajustarEnteroCFF(p.clasif.ivaNoAcredFNNoObjeto),
        ivaNoAcredFSProporcion: ajustarEnteroCFF(p.clasif.ivaNoAcredFSProporcion),
        ivaNoAcredFSNoRequisito: ajustarEnteroCFF(p.clasif.ivaNoAcredFSNoRequisito),
        ivaNoAcredFSExenta: ajustarEnteroCFF(p.clasif.ivaNoAcredFSExenta),
        ivaNoAcredFSNoObjeto: ajustarEnteroCFF(p.clasif.ivaNoAcredFSNoObjeto),
        ivaNoAcred16Proporcion: ajustarEnteroCFF(p.clasif.ivaNoAcred16Proporcion),
        ivaNoAcred16NoRequisito: ajustarEnteroCFF(p.clasif.ivaNoAcred16NoRequisito),
        ivaNoAcred16Exenta: ajustarEnteroCFF(p.clasif.ivaNoAcred16Exenta),
        ivaNoAcred16NoObjeto: ajustarEnteroCFF(p.clasif.ivaNoAcred16NoObjeto),
        ivaNoAcredImpTan16Prop: ajustarEnteroCFF(p.clasif.ivaNoAcredImpTan16Prop),
        ivaNoAcredImpTan16NoReq: ajustarEnteroCFF(p.clasif.ivaNoAcredImpTan16NoReq),
        ivaNoAcredImpTan16Exenta: ajustarEnteroCFF(p.clasif.ivaNoAcredImpTan16Exenta),
        ivaNoAcredImpTan16NoObj: ajustarEnteroCFF(p.clasif.ivaNoAcredImpTan16NoObj),
        ivaNoAcredImpInt16Prop: ajustarEnteroCFF(p.clasif.ivaNoAcredImpInt16Prop),
        ivaNoAcredImpInt16NoReq: ajustarEnteroCFF(p.clasif.ivaNoAcredImpInt16NoReq),
        ivaNoAcredImpInt16Exenta: ajustarEnteroCFF(p.clasif.ivaNoAcredImpInt16Exenta),
        ivaNoAcredImpInt16NoObj: ajustarEnteroCFF(p.clasif.ivaNoAcredImpInt16NoObj),
        // Datos adicionales
        ivaRetenidoPagado: ajustarEnteroCFF(p.clasif.ivaRetenidoPagado),
        exentoImportacion: ajustarEnteroCFF(p.clasif.exentoImportacion),
        exentoNacional: ajustarEnteroCFF(p.clasif.exentoNacional),
        tasa0: ajustarEnteroCFF(p.clasif.tasa0),
        noObjetoNacional: ajustarEnteroCFF(p.clasif.noObjetoNacional),
        noObjetoSinEstablecimiento: ajustarEnteroCFF(p.clasif.noObjetoSinEstablecimiento),
        manifiesto: p.clasif.manifiesto,
      };

      filas.push({ proveedor: p, fila });
    }

    // =========================================================================
    // FORMATO TXT — Archivo de carga masiva SAT (54 campos | separados)
    // =========================================================================
    if (formato === 'txt') {
      const lineas: string[] = [];
      for (const { fila } of filas) {
        const campos: string[] = [
          // Datos del tercero (1-7)
          fila.tipoTercero,
          fila.tipoOperacion,
          fila.rfc,
          fila.numeroIdFiscal,
          fila.nombreExtranjero,
          fila.paisResidencia,
          fila.especificarLugar,
          // Valor actos o actividades (8-17)
          String(fila.baseFronteraNorte),
          String(fila.devolucionesFronteraNorte),
          String(fila.baseFronteraSur),
          String(fila.devolucionesFronteraSur),
          String(fila.base16),
          String(fila.devoluciones16),
          String(fila.baseImportacionTangible16),
          String(fila.devolucionesImportacionTangible16),
          String(fila.baseImportacionIntangible16),
          String(fila.devolucionesImportacionIntangible16),
          // IVA acreditable (18-27)
          String(fila.ivaAcredFNExclusivo),
          String(fila.ivaAcredFNProporcion),
          String(fila.ivaAcredFSExclusivo),
          String(fila.ivaAcredFSProporcion),
          String(fila.ivaAcred16Exclusivo),
          String(fila.ivaAcred16Proporcion),
          String(fila.ivaAcredImpTan16Excl),
          String(fila.ivaAcredImpTan16Prop),
          String(fila.ivaAcredImpInt16Excl),
          String(fila.ivaAcredImpInt16Prop),
          // IVA no acreditable (28-47)
          String(fila.ivaNoAcredFNProporcion),
          String(fila.ivaNoAcredFNNoRequisito),
          String(fila.ivaNoAcredFNExenta),
          String(fila.ivaNoAcredFNNoObjeto),
          String(fila.ivaNoAcredFSProporcion),
          String(fila.ivaNoAcredFSNoRequisito),
          String(fila.ivaNoAcredFSExenta),
          String(fila.ivaNoAcredFSNoObjeto),
          String(fila.ivaNoAcred16Proporcion),
          String(fila.ivaNoAcred16NoRequisito),
          String(fila.ivaNoAcred16Exenta),
          String(fila.ivaNoAcred16NoObjeto),
          String(fila.ivaNoAcredImpTan16Prop),
          String(fila.ivaNoAcredImpTan16NoReq),
          String(fila.ivaNoAcredImpTan16Exenta),
          String(fila.ivaNoAcredImpTan16NoObj),
          String(fila.ivaNoAcredImpInt16Prop),
          String(fila.ivaNoAcredImpInt16NoReq),
          String(fila.ivaNoAcredImpInt16Exenta),
          String(fila.ivaNoAcredImpInt16NoObj),
          // Datos adicionales (48-54)
          String(fila.ivaRetenidoPagado),
          String(fila.exentoImportacion),
          String(fila.exentoNacional),
          String(fila.tasa0),
          String(fila.noObjetoNacional),
          String(fila.noObjetoSinEstablecimiento),
          fila.manifiesto,
        ];
        lineas.push(campos.join('|'));
      }

      const txt = lineas.join('\r\n');
      return new Response(txt, {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Content-Disposition': `attachment; filename="DIOT_${anio}${String(mes).padStart(2, '0')}.txt"`,
        },
      });
    }

    // =========================================================================
    // FORMATO EXCEL — Plantilla oficial de carga masiva SAT 2025
    // =========================================================================
    if (formato === 'excel') {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Sistema Fiscal IA';
      wb.created = new Date();

      // -------------------------------------------------------------------------
      // HOJA 1: Plantilla de carga masiva SAT (réplica del oficial)
      // -------------------------------------------------------------------------
      const ws = wb.addWorksheet('DIOT 2025', { views: [{ showGridLines: false }] });

      // Fila 1: Título
      ws.mergeCells('A1:BB1');
      ws.getCell('A1').value = 'DECLARACIÓN INFORMATIVA DE OPERACIONES CON TERCEROS (DIOT)';
      ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
      ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
      ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      ws.getRow(1).height = 30;

      // Fila 2: vacía
      // Fila 3: Secciones
      ws.getCell('A3').value = 'Datos del tercero declarado';
      ws.getCell('A3').font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      ws.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      ws.mergeCells('A3:G3');

      ws.getCell('H3').value = 'Valor de actos o actividades';
      ws.getCell('H3').font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      ws.getCell('H3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      ws.mergeCells('H3:Q3');

      ws.getCell('R3').value = 'IVA acreditable';
      ws.getCell('R3').font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      ws.getCell('R3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      ws.mergeCells('R3:AA3');

      ws.getCell('AB3').value = 'IVA no acreditable';
      ws.getCell('AB3').font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      ws.getCell('AB3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      ws.mergeCells('AB3:AU3');

      ws.getCell('AV3').value = 'Datos adicionales';
      ws.getCell('AV3').font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
      ws.getCell('AV3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
      ws.mergeCells('AV3:BB3');

      // Fila 4: Encabezados detallados (descripciones largas)
      const headers = [
        // Datos del tercero (1-7)
        'Tipo de tercero\n\n04 - Nacional\n05 - Extranjero\n15 - Global',
        'Tipo de operación\n\n02 - Enaj. de Bienes\n03 - Prest. de Serv. Prof.\n06 - Uso o goce temp. de bienes\n07 Importación de bienes o servicios\n85 - Otros\n87 - Ope. globales',
        'Registro federal de contribuyentes\n(Obligatorio solo si es nacional)',
        'Número de identificación fiscal\n(Obligatorio solo si es extranjero)',
        'Nombre del extranjero\n(Obligatorio solo si es extranjero)',
        'País o jurisdicción de residencia fiscal\n(Obligatorio solo si es extranjero)',
        'Especificar lugar de jurisdicción fiscal\n(Obligatorio si país=ZZZ)',
        // Valor de actos o actividades (8-17)
        'Valor total de actos o actividades pagadas en la región fronteriza norte',
        'Devoluciones, descuentos y bonificaciones en la región fronteriza norte',
        'Valor total de actos o actividades pagadas en la región fronteriza sur',
        'Devoluciones, descuentos y bonificaciones en la región fronteriza sur',
        'Valor total de actos o actividades pagadas a la tasa del 16% de IVA',
        'Devoluciones, descuentos y bonificaciones a la tasa del 16% de IVA',
        'Valor total de actos o actividades pagados en la importación por aduana de bienes tangibles a la tasa del 16% de IVA',
        'Devoluciones, descuentos y bonificaciones en la importación por aduana de bienes tangibles a la tasa del 16% de IVA',
        'Valor total de actos o actividades pagadas en la importación de bienes intangibles y servicios a la tasa del 16% de IVA',
        'Devoluciones, descuentos y bonificaciones en la importación de bienes intangibles y servicios a la tasa del 16% de IVA',
        // IVA acreditable (18-27)
        'Exclusivamente de actividades gravadas en la región fronteriza norte',
        'Asociado a actividades por las cuales se aplicó una proporción en la región fronteriza norte',
        'Exclusivamente de actividades gravadas en la región fronteriza sur',
        'Asociado a actividades por las cuales se aplicó una proporción en la región fronteriza sur',
        'Exclusivamente de actividades gravadas pagados a la tasa del 16% de IVA',
        'Asociado a actividades por las cuales se aplicó una proporción pagados a la tasa del 16% de IVA',
        'Exclusivamente de actividades gravadas pagados en la importación por aduana de bienes tangibles a la tasa del 16% de IVA',
        'Asociado a actividades por las cuales se aplicó una proporción pagadas en la importación por aduana de bienes tangibles a la tasa del 16% de IVA',
        'Exclusivamente de actividades gravadas pagados en la importación de bienes intangibles y servicios a la tasa del 16% de IVA',
        'Asociado a actividades por las cuales se aplicó una proporción pagadas en la importación de bienes intangibles y servicios a la tasa del 16% de IVA',
        // IVA no acreditable (28-47) — 20 campos
        'Asociado a actividades por las cuales se aplicó una proporción en la región fronteriza norte',
        'Asociado a que no cumple con requisitos en la región fronteriza norte',
        'Asociado a actividades exentas en la región fronteriza norte',
        'Asociado a actividades no objeto en la región fronteriza norte',
        'Asociado a actividades por las cuales se aplicó una proporción en la región fronteriza sur',
        'Asociado a que no cumple con requisitos en la región fronteriza sur',
        'Asociado a actividades exentas en la región fronteriza sur',
        'Asociado a actividades no objeto en la región fronteriza sur',
        'Asociado a actividades por las cuales se aplicó una proporción a la tasa del 16% de IVA',
        'Asociado a que no cumple con requisitos a la tasa del 16% de IVA',
        'Asociado a actividades exentas a la tasa del 16% de IVA',
        'Asociado a actividades no objeto a la tasa del 16% de IVA',
        'Asociado a actividades por las cuales se aplicó una proporción en la importación por aduana de bienes tangibles a la tasa del 16% de IVA',
        'Asociado a que no cumple con requisitos en la importación por aduana de bienes tangibles a la tasa del 16% de IVA',
        'Asociado a actividades exentas en la importación por aduana de bienes tangibles a la tasa del 16% de IVA',
        'Asociado a actividades no objeto en la importación por aduana de bienes tangibles a la tasa del 16% de IVA',
        'Asociado a actividades por las cuales se aplicó una proporción en la importación de bienes intangibles y servicios a la tasa del 16% del IVA',
        'Asociado a que no cumple con requisitos en la importación de bienes intangibles y servicios a la tasa del 16% del IVA',
        'Asociado a actividades exentas en la importación de bienes intangibles y servicios a la tasa del 16% del IVA',
        'Asociado a actividades no objeto en la importación de bienes intangibles y servicios a la tasa del 16% del IVA',
        // Datos adicionales (48-54)
        'IVA retenido por el contribuyente pagado',
        'Valor de actos o actividades pagados en la importación de bienes y servicios por los que no se pagara el IVA (Exentos)',
        'Valor de actos o actividades pagados por los que no se pagará el IVA (Exentos)',
        'Valor de demás actos o actividades pagados a la tasa del 0% de IVA',
        'Valor de actos o actividades no objeto del IVA realizados en territorio nacional',
        'Valor de actos o actividades no objeto del IVA por no contar con establecimiento en territorio nacional',
        'Manifiesto que se dio efectos fiscales a los comprobantes que amparan las operaciones realizadas con el proveedor, detalle',
      ];

      // Fila 4 con los encabezados
      for (let i = 0; i < headers.length; i++) {
        const col = i + 1;
        const cell = ws.getCell(4, col);
        cell.value = headers[i];
        cell.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
        cell.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
      }
      ws.getRow(4).height = 90;

      // Fila 5: Números de campo (Campo: 1, Campo: 2, etc.)
      for (let i = 0; i < headers.length; i++) {
        const cell = ws.getCell(5, i + 1);
        cell.value = `Campo: ${i + 1}`;
        cell.font = { bold: true, size: 9, color: { argb: 'FF1F4E79' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD6E4F0' } };
        cell.border = {
          top: { style: 'thin' }, bottom: { style: 'thin' },
          left: { style: 'thin' }, right: { style: 'thin' },
        };
      }
      ws.getRow(5).height = 18;

      // Datos — desde fila 6
      let filaNum = 6;
      let consecutivo = 1;
      for (const { fila } of filas) {
        // Columna A: consecutivo
        const cellNum = ws.getCell(filaNum, 1);
        cellNum.value = consecutivo++;
        cellNum.alignment = { horizontal: 'center' };
        // Reemplazamos primera columna con # consecutivo, después llenamos 54 campos en columnas B:BB
        // En realidad la plantilla SAT usa columnas B-BD (54 datos + 1 # = 55)
        // Para simplicidad: col 1 = #, cols 2-55 = campos 1-54
        const valores = [
          fila.tipoTercero, fila.tipoOperacion, fila.rfc, fila.numeroIdFiscal,
          fila.nombreExtranjero, fila.paisResidencia, fila.especificarLugar,
          fila.baseFronteraNorte, fila.devolucionesFronteraNorte,
          fila.baseFronteraSur, fila.devolucionesFronteraSur,
          fila.base16, fila.devoluciones16,
          fila.baseImportacionTangible16, fila.devolucionesImportacionTangible16,
          fila.baseImportacionIntangible16, fila.devolucionesImportacionIntangible16,
          fila.ivaAcredFNExclusivo, fila.ivaAcredFNProporcion,
          fila.ivaAcredFSExclusivo, fila.ivaAcredFSProporcion,
          fila.ivaAcred16Exclusivo, fila.ivaAcred16Proporcion,
          fila.ivaAcredImpTan16Excl, fila.ivaAcredImpTan16Prop,
          fila.ivaAcredImpInt16Excl, fila.ivaAcredImpInt16Prop,
          fila.ivaNoAcredFNProporcion, fila.ivaNoAcredFNNoRequisito,
          fila.ivaNoAcredFNExenta, fila.ivaNoAcredFNNoObjeto,
          fila.ivaNoAcredFSProporcion, fila.ivaNoAcredFSNoRequisito,
          fila.ivaNoAcredFSExenta, fila.ivaNoAcredFSNoObjeto,
          fila.ivaNoAcred16Proporcion, fila.ivaNoAcred16NoRequisito,
          fila.ivaNoAcred16Exenta, fila.ivaNoAcred16NoObjeto,
          fila.ivaNoAcredImpTan16Prop, fila.ivaNoAcredImpTan16NoReq,
          fila.ivaNoAcredImpTan16Exenta, fila.ivaNoAcredImpTan16NoObj,
          fila.ivaNoAcredImpInt16Prop, fila.ivaNoAcredImpInt16NoReq,
          fila.ivaNoAcredImpInt16Exenta, fila.ivaNoAcredImpInt16NoObj,
          fila.ivaRetenidoPagado, fila.exentoImportacion,
          fila.exentoNacional, fila.tasa0,
          fila.noObjetoNacional, fila.noObjetoSinEstablecimiento,
          fila.manifiesto,
        ];
        for (let i = 0; i < valores.length; i++) {
          const cell = ws.getCell(filaNum, i + 2); // empieza en col B (2)
          const v = valores[i];
          if (typeof v === 'number') {
            cell.value = v;
            cell.numFmt = '#,##0';
          } else {
            cell.value = v;
          }
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.border = {
            top: { style: 'thin' }, bottom: { style: 'thin' },
            left: { style: 'thin' }, right: { style: 'thin' },
          };
        }
        filaNum++;
      }

      // Anchos de columna
      ws.getColumn(1).width = 5;
      for (let i = 2; i <= 8; i++) ws.getColumn(i).width = 22;
      for (let i = 9; i <= 55; i++) ws.getColumn(i).width = 16;

      // -------------------------------------------------------------------------
      // HOJA 2: Columna TXT generada lista para copiar/pegar en bloc de notas
      // -------------------------------------------------------------------------
      const ws2 = wb.addWorksheet('Archivo TXT', { views: [{ showGridLines: false }] });
      ws2.getCell('A1').value = 'Columna lista para copiar a bloc de notas (UTF-8) y subir al SAT';
      ws2.getCell('A1').font = { bold: true, size: 12, color: { argb: 'FF1F4E79' } };
      ws2.getColumn(1).width = 200;

      for (let i = 0; i < filas.length; i++) {
        const { fila } = filas[i];
        const linea = [
          fila.tipoTercero, fila.tipoOperacion, fila.rfc, fila.numeroIdFiscal,
          fila.nombreExtranjero, fila.paisResidencia, fila.especificarLugar,
          String(fila.baseFronteraNorte), String(fila.devolucionesFronteraNorte),
          String(fila.baseFronteraSur), String(fila.devolucionesFronteraSur),
          String(fila.base16), String(fila.devoluciones16),
          String(fila.baseImportacionTangible16), String(fila.devolucionesImportacionTangible16),
          String(fila.baseImportacionIntangible16), String(fila.devolucionesImportacionIntangible16),
          String(fila.ivaAcredFNExclusivo), String(fila.ivaAcredFNProporcion),
          String(fila.ivaAcredFSExclusivo), String(fila.ivaAcredFSProporcion),
          String(fila.ivaAcred16Exclusivo), String(fila.ivaAcred16Proporcion),
          String(fila.ivaAcredImpTan16Excl), String(fila.ivaAcredImpTan16Prop),
          String(fila.ivaAcredImpInt16Excl), String(fila.ivaAcredImpInt16Prop),
          String(fila.ivaNoAcredFNProporcion), String(fila.ivaNoAcredFNNoRequisito),
          String(fila.ivaNoAcredFNExenta), String(fila.ivaNoAcredFNNoObjeto),
          String(fila.ivaNoAcredFSProporcion), String(fila.ivaNoAcredFSNoRequisito),
          String(fila.ivaNoAcredFSExenta), String(fila.ivaNoAcredFSNoObjeto),
          String(fila.ivaNoAcred16Proporcion), String(fila.ivaNoAcred16NoRequisito),
          String(fila.ivaNoAcred16Exenta), String(fila.ivaNoAcred16NoObjeto),
          String(fila.ivaNoAcredImpTan16Prop), String(fila.ivaNoAcredImpTan16NoReq),
          String(fila.ivaNoAcredImpTan16Exenta), String(fila.ivaNoAcredImpTan16NoObj),
          String(fila.ivaNoAcredImpInt16Prop), String(fila.ivaNoAcredImpInt16NoReq),
          String(fila.ivaNoAcredImpInt16Exenta), String(fila.ivaNoAcredImpInt16NoObj),
          String(fila.ivaRetenidoPagado), String(fila.exentoImportacion),
          String(fila.exentoNacional), String(fila.tasa0),
          String(fila.noObjetoNacional), String(fila.noObjetoSinEstablecimiento),
          fila.manifiesto,
        ].join('|');
        const cell = ws2.getCell(i + 3, 1);
        cell.value = linea;
        cell.font = { name: 'Consolas', size: 10 };
      }

      // -------------------------------------------------------------------------
      // HOJA 3: Resumen y catálogos
      // -------------------------------------------------------------------------
      const ws3 = wb.addWorksheet('Resumen y Catálogos', { views: [{ showGridLines: false }] });
      ws3.columns = [{ width: 30 }, { width: 80 }];
      ws3.getCell('A1').value = 'DIOT SAT 2025 — Resumen y Catálogos';
      ws3.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF1F4E79' } };

      const datosResumen: Array<[string, string]> = [
        ['Periodo', `${mes}/${anio}`],
        ['Proveedores registrados', String(filas.length)],
        ['Total facturas procesadas', String(facturas.length)],
        ['Formato TXT', '54 campos separados por pipe (|)'],
        ['Codificación', 'UTF-8 obligatorio'],
        ['Portal SAT', 'pstcdi.clouda.sat.gob.mx'],
        ['', ''],
        ['TIPO DE TERCERO (catálogo SAT)', ''],
        ['04', 'Proveedor Nacional'],
        ['05', 'Proveedor Extranjero'],
        ['15', 'Proveedor Global (XAXX010101000)'],
        ['', ''],
        ['TIPO DE OPERACIÓN — Nacional (04)', ''],
        ['02', 'Enajenación de bienes'],
        ['03', 'Prestación de Servicios Profesionales'],
        ['06', 'Uso o goce temporal de bienes'],
        ['08', 'Importación por transferencia virtual'],
        ['85', 'Otros'],
        ['', ''],
        ['TIPO DE OPERACIÓN — Extranjero (05)', ''],
        ['02', 'Enajenación de bienes'],
        ['03', 'Prestación de Servicios Profesionales'],
        ['07', 'Importación de bienes o servicios'],
        ['85', 'Otros'],
        ['', ''],
        ['TIPO DE OPERACIÓN — Global (15)', ''],
        ['87', 'Operaciones globales'],
        ['', ''],
        ['REGIONES FISCALES', ''],
        ['Frontera Norte (RFN)', 'IVA 8% — 43 municipios norte (Baja California, Sonora, Chihuahua, Coahuila, Nuevo León, Tamaulipas'],
        ['Frontera Sur (RFS)', 'IVA 8% — Chiapas (nuevo 2025)'],
        ['Resto del país', 'IVA 16%'],
        ['', ''],
        ['MANIFIESTO (campo 54)', ''],
        ['01', 'Sí se dieron efectos fiscales'],
        ['02', 'No se dieron efectos fiscales'],
        ['', ''],
        ['REGLAS DE REDONDEO (Art. 20 CFF)', ''],
        ['.01 a .50', 'Se ajusta a la unidad inmediata anterior (ej: 1450.50 → 1450)'],
        ['.51 a .99', 'Se ajusta a la unidad inmediata superior (ej: 1450.51 → 1451)'],
        ['', ''],
        ['INSTRUCCIONES PARA SUBIR AL SAT', ''],
        ['1.', 'Copia la columna de la hoja "Archivo TXT"'],
        ['2.', 'Pega en bloc de notas'],
        ['3.', 'Guarda como: DIOT.txt'],
        ['4.', 'En codificación selecciona UTF-8'],
        ['5.', 'Sube en pstcdi.clouda.sat.gob.mx → "Agregar desde Archivo"'],
      ];

      for (let i = 0; i < datosResumen.length; i++) {
        const [a, b] = datosResumen[i];
        const cell = ws3.getCell(i + 3, 1);
        cell.value = a;
        cell.font = a && !b ? { bold: true, color: { argb: 'FF1F4E79' } } : {};
        const cell2 = ws3.getCell(i + 3, 2);
        cell2.value = b;
      }

      // Hoja 4: Catálogo completo de países
      const ws4 = wb.addWorksheet('Catálogo Países');
      ws4.columns = [{ header: 'Código', width: 12 }, { header: 'Nombre', width: 50 }];
      ws4.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws4.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } };
      for (const [codigo, nombre] of Object.entries(CATALOGO_PAISES_SAT)) {
        ws4.addRow([codigo, nombre]);
      }

      const buffer = await wb.xlsx.writeBuffer();
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="DIOT_${anio}_${String(mes).padStart(2, '0')}_SAT2025.xlsx"`,
        },
      });
    }

    // =========================================================================
    // FORMATO JSON
    // =========================================================================
    return NextResponse.json({
      periodo: { mes, anio },
      formato: 'SAT 2025/2026 — 54 campos oficiales (carga masiva)',
      basadoEn: 'Instructivo SAT REV-2 + Ejemplo oficial 2025+',
      totalProveedores: filas.length,
      totalFacturas: facturas.length,
      tiposTercero: {
        '04': 'Proveedor Nacional',
        '05': 'Proveedor Extranjero',
        '15': 'Proveedor Global (XAXX010101000)',
      },
      tiposOperacion: {
        '02': 'Enajenación de bienes',
        '03': 'Prestación de Servicios Profesionales',
        '06': 'Uso o goce temporal de bienes',
        '07': 'Importación de bienes o servicios',
        '08': 'Importación por transferencia virtual',
        '85': 'Otros',
        '87': 'Operaciones globales',
      },
      regiones: {
        frontera_norte: 'IVA 8% (43 municipios norte)',
        frontera_sur: 'IVA 8% (Chiapas — nuevo 2025)',
        resto: 'IVA 16%',
      },
      redondeo: 'Art. 20 CFF — sin decimales (.01-.50 baja, .51-.99 sube)',
      filas: filas.map(({ proveedor, fila }) => ({
        rfc: proveedor.rfc,
        nombre: proveedor.nombre,
        count: proveedor.count,
        fila,
      })),
      formatosDisponibles: ['json', 'excel', 'txt'],
      portalSAT: 'pstcdi.clouda.sat.gob.mx',
    });
  } catch (e: any) {
    console.error('Error DIOT:', e.message, e.stack);
    return NextResponse.json({ error: e.message, stack: e.stack }, { status: 500 });
  }
}

// ============================================================================
// UTILIDADES
// ============================================================================
function sumarClasificacion(acc: ClasificacionIVA, val: ClasificacionIVA): void {
  for (const key of Object.keys(acc) as Array<keyof ClasificacionIVA>) {
    if (key === 'manifiesto') continue;
    (acc[key] as number) += (val[key] as number);
  }
}
