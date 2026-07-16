import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/export/concentrado?empresaId=xxx&anio=2026
 *
 * Genera un Excel que replica EXACTAMENTE la estructura del concentrado
 * mensual del usuario:
 *
 * Hojas:
 *   - Ene, Feb, Mar, ..., Dic  (una por mes con CFDIs del mes)
 *   - Concentrado (tabla pivote con totales Emitidas/Recibidas/Nómina por mes)
 *   - NOMINA (CFDIs tipo Nómina separados)
 *
 * Cada hoja mensual tiene las columnas:
 *   XML | Rfc Emisor | Nombre Emisor | LugarExp | Régimen Fiscal |
 *   Rfc Receptor | Nombre Receptor | Tipo | Serie | Folio | Fecha |
 *   Sub Total | Descuento | Total impuesto Trasladado | Nombre Impuesto |
 *   Total impuesto Retenido | Nombre Impuesto | Total | UUID |
 *   Método de Pago | Forma de Pago | Moneda | Tipo de Cambio |
 *   Versión | Uso CFDI | Régimen Fiscal | Estado | Estatus |
 *
 * Filtros:
 *   - Excluye CFDIs cancelados
 *   - Excluye CFDIs tipo "P" (Pago) — van en su propio reporte
 *   - Incluye tipo "I" (Ingreso) y "E" (Nota de crédito)
 *   - Nómina (tipo "N") va en hoja separada
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MESES = ['Ene', 'FEB', 'MAR', 'ABRIL', 'MAYO', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MESES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

const COLUMNAS = [
  'XML', 'Rfc Emisor', 'Nombre Emisor', 'LugarExp', 'Régimen Fiscal',
  'Rfc Receptor', 'Nombre Receptor', 'Tipo', 'Serie', 'Folio', 'Fecha',
  'Sub Total', 'Descuento', 'Total impuesto Trasladado', 'Nombre Impuesto',
  'Total impuesto Retenido', 'Nombre Impuesto', 'Total', 'UUID',
  'Método de Pago', 'Forma de Pago', 'Moneda', 'Tipo de Cambio',
  'Versión', 'Uso CFDI', 'Régimen Fiscal', 'Estado', 'Estatus',
  'Validación EFOS', 'Fecha Consulta',
];

const COLORES = {
  header: 'FF7C3AED',  // violet
  ingreso: 'FF10B981', // emerald
  egreso: 'FFF97316',  // orange
  nomina: 'FF3B82F6',  // blue
  total: 'FFEDE9FE',   // violet light
  concentrado: 'FF6366F1', // indigo
  // Estándares financieros Anthropic
  input: 'FF0000FF',     // Azul — inputs hardcoded
  formula: 'FF000000',   // Negro — fórmulas y cálculos
  link: 'FF008000',      // Verde — links a otras hojas
  warning: 'FFFFFF00',   // Amarillo background — requiere atención
};

// Borde delgado para todas las celdas del Concentrado
function thinBorder() {
  return {
    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
    right: { style: 'thin', color: { argb: 'FFCBD5E1' } },
  };
}

// Formato financiero profesional Anthropic:
// - Ceros como "-" en vez de "$0.00"
// - Negativos con paréntesis (123) en vez de -123
// - Símbolo $ y separadores de miles
const FMT_MONEDA = '"$"#,##0.00;("$"#,##0.00);"-"';
const FMT_MONEDA_DECIMAL = '"$"#,##0.00;("$"#,##0.00);"-"';
const FMT_PORCENTAJE = '0.0%;(0.0%);"-"';
const FMT_NUMERO = '#,##0;(#,##0);"-"';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));
    const empresaId = searchParams.get('empresaId') || undefined;

    // ===== Obtener empresa =====
    const empresa = empresaId ? await db.empresa.findUnique({ where: { id: empresaId } }) : null;

    // ===== Obtener TODAS las facturas del año (excluyendo canceladas y tipo P=Pago) =====
    const inicioAnio = new Date(anio, 0, 1);
    const finAnio = new Date(anio, 11, 31, 23, 59, 59);

    const facturas = await db.factura.findMany({
      where: {
        ...(empresaId ? { empresaId } : {}),
        fecha: { gte: inicioAnio, lte: finAnio },
        estado: { not: 'cancelada' },
        tipoComprobante: { in: ['I', 'E'] }, // Ingreso y Nota de crédito (NO Pago, NO Nómina)
      },
      orderBy: { fecha: 'asc' },
    });

    // ===== Obtener nómina del año =====
    const nominas = await db.reciboNomina.findMany({
      where: {
        ...(empresaId ? { empresaId } : {}),
        fecha: { gte: inicioAnio, lte: finAnio },
      },
      include: { empleado: true },
      orderBy: { fecha: 'asc' },
    });

    // ===== Crear workbook =====
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema Fiscal IA';
    wb.created = new Date();
    wb.company = empresa?.nombre || 'Empresa';

    // ===== Hojas mensuales =====
    const totalesPorMes: Array<{
      mes: number;
      emitidas: { subtotal: number; descuento: number; impuesto: number; retenido: number; total: number; count: number };
      recibidas: { subtotal: number; descuento: number; impuesto: number; retenido: number; total: number; count: number };
      nomina: { total: number; count: number };
    }> = [];

    for (let mes = 0; mes < 12; mes++) {
      const facturasMes = facturas.filter(f => new Date(f.fecha).getMonth() === mes);
      const nominasMes = nominas.filter(n => new Date(n.fecha).getMonth() === mes);

      // ===== SEPARAR INGRESOS (I) DE NOTAS DE CRÉDITO (E) =====
      // Los Ingresos (I) se SUMAN a los totales
      // Las Notas de Crédito (E) se RESTAN de los totales (son devoluciones)
      const ingresosEmitidos = facturasMes.filter(f => f.direccion === 'emitida' && f.tipoComprobante === 'I');
      const notasCreditoEmitidas = facturasMes.filter(f => f.direccion === 'emitida' && f.tipoComprobante === 'E');
      const ingresosRecibidos = facturasMes.filter(f => f.direccion === 'recibida' && f.tipoComprobante === 'I');
      const notasCreditoRecibidas = facturasMes.filter(f => f.direccion === 'recibida' && f.tipoComprobante === 'E');

      // ===== TOTALES: Ingresos - Notas de Crédito =====
      const totalesEmitidas = {
        subtotal: ingresosEmitidos.reduce((s, f) => s + f.subtotal, 0) - notasCreditoEmitidas.reduce((s, f) => s + f.subtotal, 0),
        descuento: ingresosEmitidos.reduce((s, f) => s + (f.descuento || 0), 0) + notasCreditoEmitidas.reduce((s, f) => s + (f.descuento || 0), 0),
        impuesto: ingresosEmitidos.reduce((s, f) => s + f.totalImpuestos, 0) - notasCreditoEmitidas.reduce((s, f) => s + f.totalImpuestos, 0),
        retenido: ingresosEmitidos.reduce((s, f) => s + (f.impuestoRetenido || 0), 0) - notasCreditoEmitidas.reduce((s, f) => s + (f.impuestoRetenido || 0), 0),
        total: ingresosEmitidos.reduce((s, f) => s + f.total, 0) - notasCreditoEmitidas.reduce((s, f) => s + f.total, 0),
        count: ingresosEmitidos.length + notasCreditoEmitidas.length,
      };
      const totalesRecibidas = {
        subtotal: ingresosRecibidos.reduce((s, f) => s + f.subtotal, 0) - notasCreditoRecibidas.reduce((s, f) => s + f.subtotal, 0),
        descuento: ingresosRecibidos.reduce((s, f) => s + (f.descuento || 0), 0) + notasCreditoRecibidas.reduce((s, f) => s + (f.descuento || 0), 0),
        impuesto: ingresosRecibidos.reduce((s, f) => s + f.totalImpuestos, 0) - notasCreditoRecibidas.reduce((s, f) => s + f.totalImpuestos, 0),
        retenido: ingresosRecibidos.reduce((s, f) => s + (f.impuestoRetenido || 0), 0) - notasCreditoRecibidas.reduce((s, f) => s + (f.impuestoRetenido || 0), 0),
        total: ingresosRecibidos.reduce((s, f) => s + f.total, 0) - notasCreditoRecibidas.reduce((s, f) => s + f.total, 0),
        count: ingresosRecibidos.length + notasCreditoRecibidas.length,
      };
      const totalesNomina = {
        total: nominasMes.reduce((s, n) => s + n.totalPercepciones, 0),
        count: nominasMes.length,
      };

      totalesPorMes.push({
        mes: mes + 1,
        emitidas: totalesEmitidas,
        recibidas: totalesRecibidas,
        nomina: totalesNomina,
      });

      // Crear hoja mensual
      const ws = wb.addWorksheet(MESES[mes], {
        views: [{ showGridLines: false }],
      });

      // Definir columnas
      ws.columns = COLUMNAS.map((col, i) => ({
        header: col,
        key: col.toLowerCase().replace(/\s+/g, '_'),
        width: i === 1 ? 18 : i === 6 ? 30 : i === 17 ? 14 : i === 18 ? 38 : 12,
      }));

      // Estilo header
      ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.header } };
      ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getRow(1).height = 30;

      // Mapear facturas del mes a filas
      const filasMes: any[] = [];
      // Emitidas primero (ingreso)
      // ===== FILAS: Ingresos primero (positivos), luego Notas de Crédito (NEGATIVOS) =====
      // Ingresos Emitidos (positivos)
      for (const f of ingresosEmitidos) {
        filasMes.push({
          xml: f.uuid || '',
          rfc_emisor: f.emisorRfc || empresa?.rfc || '',
          nombre_emisor: f.emisorNombre || empresa?.nombre || '',
          lugarexp: '',
          regimen_fiscal: empresa?.regimenFiscal || '',
          rfc_receptor: f.receptorRfc || '',
          nombre_receptor: f.receptorNombre || '',
          tipo: 'ingreso',
          serie: f.serie || '',
          folio: f.folio || '',
          fecha: new Date(f.fecha),
          sub_total: f.subtotal,
          descuento: f.descuento || 0,
          total_impuesto_trasladado: f.totalImpuestos,
          nombre_impuesto: '002 - IVA',
          total_impuesto_retenido: f.impuestoRetenido || 0,
          nombre_impuesto_2: f.impuestoRetenido ? '001 - ISR' : '',
          total: f.total,
          uuid: f.uuid || '',
          metodo_de_pago: f.metodoPago || '',
          forma_de_pago: f.formaPago || '',
          moneda: f.moneda || 'MXN',
          tipo_de_cambio: '',
          version: '4.0',
          uso_cfdi: '',
          regimen_fiscal_2: '',
          estado: f.estado || 'timbrada',
          estatus: 'Vigente',
          validacion_efos: '',
          fecha_consulta: new Date(),
        });
      }
      // Notas de Crédito Emitidas (montos NEGATIVOS para que se resten en el total)
      for (const f of notasCreditoEmitidas) {
        filasMes.push({
          xml: f.uuid || '',
          rfc_emisor: f.emisorRfc || empresa?.rfc || '',
          nombre_emisor: f.emisorNombre || empresa?.nombre || '',
          lugarexp: '',
          regimen_fiscal: empresa?.regimenFiscal || '',
          rfc_receptor: f.receptorRfc || '',
          nombre_receptor: f.receptorNombre || '',
          tipo: 'nota de crédito',
          serie: f.serie || '',
          folio: f.folio || '',
          fecha: new Date(f.fecha),
          sub_total: -f.subtotal,  // NEGATIVO
          descuento: f.descuento || 0,
          total_impuesto_trasladado: -f.totalImpuestos,  // NEGATIVO
          nombre_impuesto: '002 - IVA',
          total_impuesto_retenido: -(f.impuestoRetenido || 0),  // NEGATIVO
          nombre_impuesto_2: f.impuestoRetenido ? '001 - ISR' : '',
          total: -f.total,  // NEGATIVO
          uuid: f.uuid || '',
          metodo_de_pago: f.metodoPago || '',
          forma_de_pago: f.formaPago || '',
          moneda: f.moneda || 'MXN',
          tipo_de_cambio: '',
          version: '4.0',
          uso_cfdi: '',
          regimen_fiscal_2: '',
          estado: f.estado || 'timbrada',
          estatus: 'Vigente',
          validacion_efos: '',
          fecha_consulta: new Date(),
        });
      }
      // Ingresos Recibidos (positivos)
      for (const f of ingresosRecibidos) {
        filasMes.push({
          xml: f.uuid || '',
          rfc_emisor: f.emisorRfc || '',
          nombre_emisor: f.emisorNombre || '',
          lugarexp: '',
          regimen_fiscal: '',
          rfc_receptor: f.receptorRfc || empresa?.rfc || '',
          nombre_receptor: f.receptorNombre || empresa?.nombre || '',
          tipo: 'egreso',
          serie: f.serie || '',
          folio: f.folio || '',
          fecha: new Date(f.fecha),
          sub_total: f.subtotal,
          descuento: f.descuento || 0,
          total_impuesto_trasladado: f.totalImpuestos,
          nombre_impuesto: '002 - IVA',
          total_impuesto_retenido: f.impuestoRetenido || 0,
          nombre_impuesto_2: f.impuestoRetenido ? '001 - ISR' : '',
          total: f.total,
          uuid: f.uuid || '',
          metodo_de_pago: f.metodoPago || '',
          forma_de_pago: f.formaPago || '',
          moneda: f.moneda || 'MXN',
          tipo_de_cambio: '',
          version: '4.0',
          uso_cfdi: '',
          regimen_fiscal_2: '',
          estado: f.estado || 'timbrada',
          estatus: 'Vigente',
          validacion_efos: '',
          fecha_consulta: new Date(),
        });
      }
      // Notas de Crédito Recibidas (montos NEGATIVOS)
      for (const f of notasCreditoRecibidas) {
        filasMes.push({
          xml: f.uuid || '',
          rfc_emisor: f.emisorRfc || '',
          nombre_emisor: f.emisorNombre || '',
          lugarexp: '',
          regimen_fiscal: '',
          rfc_receptor: f.receptorRfc || empresa?.rfc || '',
          nombre_receptor: f.receptorNombre || empresa?.nombre || '',
          tipo: 'nota de crédito',
          serie: f.serie || '',
          folio: f.folio || '',
          fecha: new Date(f.fecha),
          sub_total: -f.subtotal,  // NEGATIVO
          descuento: f.descuento || 0,
          total_impuesto_trasladado: -f.totalImpuestos,  // NEGATIVO
          nombre_impuesto: '002 - IVA',
          total_impuesto_retenido: -(f.impuestoRetenido || 0),  // NEGATIVO
          nombre_impuesto_2: f.impuestoRetenido ? '001 - ISR' : '',
          total: -f.total,  // NEGATIVO
          uuid: f.uuid || '',
          metodo_de_pago: f.metodoPago || '',
          forma_de_pago: f.formaPago || '',
          moneda: f.moneda || 'MXN',
          tipo_de_cambio: '',
          version: '4.0',
          uso_cfdi: '',
          regimen_fiscal_2: '',
          estado: f.estado || 'timbrada',
          estatus: 'Vigente',
          validacion_efos: '',
          fecha_consulta: new Date(),
        });
      }

      // Agregar filas
      filasMes.forEach((fila, idx) => {
        const row = ws.addRow(fila);
        // Color por tipo
        const tipoCell = row.getCell(8); // Tipo
        if (fila.tipo === 'ingreso') {
          tipoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
          tipoCell.font = { color: { argb: 'FF065F46' }, bold: true };
        } else if (fila.tipo === 'nota de crédito') {
          tipoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
          tipoCell.font = { color: { argb: 'FF92400E' }, bold: true };
        } else {
          tipoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } };
          tipoCell.font = { color: { argb: 'FF9A3412' }, bold: true };
        }
        // Formato fecha
        row.getCell(11).numFmt = 'DD/MM/YYYY';
        // Formato moneda
        [12, 13, 14, 16, 18].forEach(col => {
          row.getCell(col).numFmt = FMT_MONEDA;
        });
        // UUID en monoespacio
        row.getCell(19).font = { name: 'Consolas', size: 9 };
        row.height = 18;
      });

      // Fila de totales al final (suma de TODAS las filas, incluyendo NC negativas)
      const filaTotales = ws.addRow({
        xml: '',
        rfc_emisor: '',
        nombre_emisor: '',
        lugarexp: '',
        regimen_fiscal: '',
        rfc_receptor: '',
        nombre_receptor: 'TOTALES DEL MES:',
        tipo: '',
        serie: '',
        folio: '',
        fecha: '',
        sub_total: totalesEmitidas.subtotal + totalesRecibidas.subtotal,
        descuento: totalesEmitidas.descuento + totalesRecibidas.descuento,
        total_impuesto_trasladado: totalesEmitidas.impuesto + totalesRecibidas.impuesto,
        nombre_impuesto: '',
        total_impuesto_retenido: totalesEmitidas.retenido + totalesRecibidas.retenido,
        nombre_impuesto_2: '',
        total: totalesEmitidas.total + totalesRecibidas.total,
        uuid: '',
        metodo_de_pago: '',
        forma_de_pago: '',
        moneda: '',
        tipo_de_cambio: '',
        version: '',
        uso_cfdi: '',
        regimen_fiscal_2: '',
        estado: '',
        estatus: '',
        validacion_efos: '',
        fecha_consulta: '',
      });
      filaTotales.font = { bold: true, color: { argb: 'FF7C3AED' } };
      filaTotales.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.total } };
      [12, 13, 14, 16, 18].forEach(col => {
        filaTotales.getCell(col).numFmt = FMT_MONEDA;
      });

      // Freeze panes (primera fila + primeras 2 columnas)
      ws.views = [{ freeze: 'C2', showGridLines: false }];
    }

    // ===== Hoja Concentrado =====
    const wsConc = wb.addWorksheet('Concentrado', { views: [{ showGridLines: false }] });

    // Definir columnas A-N (Mes + 5 Emitidas + 5 Recibidas + 1 Nómina + 1 Count opcional)
    wsConc.columns = [
      { width: 14 },  // A - Mes
      { width: 16 },  // B - Emitidas Sub Total
      { width: 14 },  // C - Emitidas Descuentos
      { width: 14 },  // D - Emitidas Impuesto
      { width: 14 },  // E - Emitidas Imp. Retenido
      { width: 18 },  // F - Emitidas Total
      { width: 16 },  // G - Recibidas Sub Total
      { width: 14 },  // H - Recibidas Descuentos
      { width: 14 },  // I - Recibidas Impuesto
      { width: 14 },  // J - Recibidas Imp. Retenido
      { width: 18 },  // K - Recibidas Total
      { width: 16 },  // L - Nómina Total
    ];

    // Fila 1: Título grande
    wsConc.mergeCells('A1:L1');
    const cellTitulo = wsConc.getCell('A1');
    cellTitulo.value = `${empresa?.nombre || 'EMPRESA'}    Facturacion ${anio}`;
    cellTitulo.font = { bold: true, size: 14, color: { argb: 'FF4B0082' } };
    cellTitulo.alignment = { horizontal: 'left', vertical: 'middle' };
    wsConc.getRow(1).height = 24;

    // Fila 3: Encabezados principales (Mes | Facturas Emitidas | Facturas Recibidas | Nómina)
    // A3:A4 merged "Mes/2026"
    wsConc.mergeCells('A3:A4');
    const cellMes = wsConc.getCell('A3');
    cellMes.value = `Mes/${anio}`;
    cellMes.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cellMes.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.concentrado } };
    cellMes.alignment = { horizontal: 'center', vertical: 'middle' };
    cellMes.border = thinBorder();

    // B3:F3 merged "Facturas Emitidas"
    wsConc.mergeCells('B3:F3');
    const cellEmitidas = wsConc.getCell('B3');
    cellEmitidas.value = 'Facturas Emitidas';
    cellEmitidas.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cellEmitidas.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.ingreso } };
    cellEmitidas.alignment = { horizontal: 'center', vertical: 'middle' };
    cellEmitidas.border = thinBorder();

    // G3:K3 merged "Facturas Recibidas"
    wsConc.mergeCells('G3:K3');
    const cellRecibidas = wsConc.getCell('G3');
    cellRecibidas.value = 'Facturas Recibidas';
    cellRecibidas.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cellRecibidas.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.egreso } };
    cellRecibidas.alignment = { horizontal: 'center', vertical: 'middle' };
    cellRecibidas.border = thinBorder();

    // L3:L4 merged "NOMINA"
    wsConc.mergeCells('L3:L4');
    const cellNomina = wsConc.getCell('L3');
    cellNomina.value = 'NOMINA';
    cellNomina.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cellNomina.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.nomina } };
    cellNomina.alignment = { horizontal: 'center', vertical: 'middle' };
    cellNomina.border = thinBorder();

    // Fila 4: Sub-encabezados (Sub Total | Descuentos | Impuesto | Imp. Retenido | Total × 2 + Total Nómina)
    const subHeaders = [
      { col: 'B', label: 'Sub Total' },
      { col: 'C', label: 'Descuentos' },
      { col: 'D', label: 'Impuesto' },
      { col: 'E', label: 'Imp. Retenido' },
      { col: 'F', label: 'Total' },
      { col: 'G', label: 'Sub Total' },
      { col: 'H', label: 'Descuentos' },
      { col: 'I', label: 'Impuesto' },
      { col: 'J', label: 'Imp. Retenido' },
      { col: 'K', label: 'Total' },
    ];
    subHeaders.forEach(({ col, label }) => {
      const cell = wsConc.getCell(`${col}4`);
      cell.value = label;
      cell.font = { bold: true, size: 10 };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      cell.border = thinBorder();
      if (['B', 'C', 'D', 'E', 'F'].includes(col)) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } }; // verde claro
      } else {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } }; // naranja claro
      }
    });

    wsConc.getRow(3).height = 22;
    wsConc.getRow(4).height = 22;

    // Filas 5-16: Un mes por fila
    let rowIdx = 5;
    let granTotalEmitidas = { subtotal: 0, descuento: 0, impuesto: 0, retenido: 0, total: 0, count: 0 };
    let granTotalRecibidas = { subtotal: 0, descuento: 0, impuesto: 0, retenido: 0, total: 0, count: 0 };
    let granTotalNomina = { total: 0, count: 0 };

    totalesPorMes.forEach((tm) => {
      wsConc.getCell(`A${rowIdx}`).value = MESES_LARGO[tm.mes - 1];
      wsConc.getCell(`A${rowIdx}`).font = { bold: true };
      wsConc.getCell(`A${rowIdx}`).border = thinBorder();

      wsConc.getCell(`B${rowIdx}`).value = tm.emitidas.subtotal;
      wsConc.getCell(`C${rowIdx}`).value = tm.emitidas.descuento;
      wsConc.getCell(`D${rowIdx}`).value = tm.emitidas.impuesto;
      wsConc.getCell(`E${rowIdx}`).value = tm.emitidas.retenido;
      wsConc.getCell(`F${rowIdx}`).value = tm.emitidas.total;

      wsConc.getCell(`G${rowIdx}`).value = tm.recibidas.subtotal;
      wsConc.getCell(`H${rowIdx}`).value = tm.recibidas.descuento;
      wsConc.getCell(`I${rowIdx}`).value = tm.recibidas.impuesto;
      wsConc.getCell(`J${rowIdx}`).value = tm.recibidas.retenido;
      wsConc.getCell(`K${rowIdx}`).value = tm.recibidas.total;

      wsConc.getCell(`L${rowIdx}`).value = tm.nomina.total;

      // Formato moneda en todas las columnas numéricas
      ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].forEach(col => {
        const cell = wsConc.getCell(`${col}${rowIdx}`);
        cell.numFmt = FMT_MONEDA;
        cell.border = thinBorder();
      });

      granTotalEmitidas.subtotal += tm.emitidas.subtotal;
      granTotalEmitidas.descuento += tm.emitidas.descuento;
      granTotalEmitidas.impuesto += tm.emitidas.impuesto;
      granTotalEmitidas.retenido += tm.emitidas.retenido;
      granTotalEmitidas.total += tm.emitidas.total;
      granTotalEmitidas.count += tm.emitidas.count;

      granTotalRecibidas.subtotal += tm.recibidas.subtotal;
      granTotalRecibidas.descuento += tm.recibidas.descuento;
      granTotalRecibidas.impuesto += tm.recibidas.impuesto;
      granTotalRecibidas.retenido += tm.recibidas.retenido;
      granTotalRecibidas.total += tm.recibidas.total;
      granTotalRecibidas.count += tm.recibidas.count;

      granTotalNomina.total += tm.nomina.total;
      granTotalNomina.count += tm.nomina.count;

      rowIdx++;
    });

    // Fila 17: TOTAL ANUAL
    wsConc.getCell(`A${rowIdx}`).value = '';
    wsConc.getCell(`B${rowIdx}`).value = granTotalEmitidas.subtotal;
    wsConc.getCell(`C${rowIdx}`).value = granTotalEmitidas.descuento;
    wsConc.getCell(`D${rowIdx}`).value = granTotalEmitidas.impuesto;
    wsConc.getCell(`E${rowIdx}`).value = granTotalEmitidas.retenido;
    wsConc.getCell(`F${rowIdx}`).value = granTotalEmitidas.total;
    wsConc.getCell(`G${rowIdx}`).value = granTotalRecibidas.subtotal;
    wsConc.getCell(`H${rowIdx}`).value = granTotalRecibidas.descuento;
    wsConc.getCell(`I${rowIdx}`).value = granTotalRecibidas.impuesto;
    wsConc.getCell(`J${rowIdx}`).value = granTotalRecibidas.retenido;
    wsConc.getCell(`K${rowIdx}`).value = granTotalRecibidas.total;
    wsConc.getCell(`L${rowIdx}`).value = granTotalNomina.total;

    for (let c = 1; c <= 12; c++) {
      const cell = wsConc.getCell(rowIdx, c);
      cell.font = { bold: true, color: { argb: 'FF7C3AED' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.total } };
      cell.border = thinBorder();
    }
    ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'].forEach(col => {
      wsConc.getCell(`${col}${rowIdx}`).numFmt = FMT_MONEDA;
    });

    // ===== Hoja NOMINA =====
    const wsNom = wb.addWorksheet('NOMINA', { views: [{ showGridLines: false }] });
    wsNom.columns = [
      { header: 'XML', key: 'uuid', width: 38 },
      { header: 'RFC Emisor', key: 'rfc_emisor', width: 18 },
      { header: 'Nombre Emisor', key: 'nombre_emisor', width: 30 },
      { header: 'RFC Receptor', key: 'rfc_receptor', width: 18 },
      { header: 'Nombre Receptor', key: 'nombre_receptor', width: 30 },
      { header: 'Tipo', key: 'tipo', width: 14 },
      { header: 'Serie', key: 'serie', width: 10 },
      { header: 'Folio', key: 'folio', width: 10 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Sub Total', key: 'subtotal', width: 14 },
      { header: 'Descuento', key: 'descuento', width: 12 },
      { header: 'Total Percepciones', key: 'percepciones', width: 16 },
      { header: 'Total Deducciones', key: 'deducciones', width: 16 },
      { header: 'ISR', key: 'isr', width: 12 },
      { header: 'IMSS', key: 'imss', width: 12 },
      { header: 'Neto', key: 'neto', width: 14 },
      { header: 'UUID', key: 'uuid2', width: 38 },
      { header: 'Estado', key: 'estado', width: 12 },
    ];

    wsNom.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    wsNom.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.nomina } };
    wsNom.getRow(1).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    wsNom.getRow(1).height = 28;

    for (const n of nominas) {
      const row = wsNom.addRow({
        uuid: n.uuid || '',
        rfc_emisor: empresa?.rfc || '',
        nombre_emisor: empresa?.nombre || '',
        rfc_receptor: n.empleado?.rfc || '',
        nombre_receptor: n.empleado?.nombre || '',
        tipo: 'Nómina 4.0',
        serie: '',
        folio: n.folio,
        fecha: new Date(n.fecha),
        subtotal: n.totalPercepciones,
        descuento: n.totalDeducciones,
        percepciones: n.totalPercepciones,
        deducciones: n.totalDeducciones,
        isr: n.isr,
        imss: n.imss,
        neto: n.neto,
        uuid2: n.uuid || '',
        estado: n.estado || 'timbrado',
      });
      row.getCell(9).numFmt = 'DD/MM/YYYY';
      [10, 11, 12, 13, 14, 15, 16].forEach(col => {
        row.getCell(col).numFmt = FMT_MONEDA;
      });
      row.getCell(1).font = { name: 'Consolas', size: 9 };
      row.getCell(17).font = { name: 'Consolas', size: 9 };
    }

    // Total nómina
    const filaTotalNom = wsNom.addRow({
      uuid: '',
      rfc_emisor: '',
      nombre_emisor: '',
      rfc_receptor: '',
      nombre_receptor: 'TOTALES NÓMINA:',
      tipo: '',
      serie: '',
      folio: '',
      fecha: '',
      subtotal: nominas.reduce((s, n) => s + n.totalPercepciones, 0),
      descuento: nominas.reduce((s, n) => s + n.totalDeducciones, 0),
      percepciones: nominas.reduce((s, n) => s + n.totalPercepciones, 0),
      deducciones: nominas.reduce((s, n) => s + n.totalDeducciones, 0),
      isr: nominas.reduce((s, n) => s + n.isr, 0),
      imss: nominas.reduce((s, n) => s + n.imss, 0),
      neto: nominas.reduce((s, n) => s + n.neto, 0),
      uuid2: '',
      estado: '',
    });
    filaTotalNom.font = { bold: true, color: { argb: COLORES.nomina } };
    filaTotalNom.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
    [10, 11, 12, 13, 14, 15, 16].forEach(col => {
      filaTotalNom.getCell(col).numFmt = FMT_MONEDA;
    });

    wsNom.views = [{ freeze: 'A2', showGridLines: false }];

    // ===== Generar buffer =====
    const buffer = await wb.xlsx.writeBuffer();
    const fileName = `Concentrado_${empresa?.rfc || 'empresa'}_${anio}.xlsx`;

    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    });
  } catch (e: any) {
    console.error('Error en /api/export/concentrado:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
