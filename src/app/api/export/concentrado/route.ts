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
};

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

      // Totales
      const facturasEmitidas = facturasMes.filter(f => f.direccion === 'emitida');
      const facturasRecibidas = facturasMes.filter(f => f.direccion === 'recibida');

      const totalesEmitidas = {
        subtotal: facturasEmitidas.reduce((s, f) => s + f.subtotal, 0),
        descuento: facturasEmitidas.reduce((s, f) => s + 0, 0), // El schema no tiene descuento separado
        impuesto: facturasEmitidas.reduce((s, f) => s + f.totalImpuestos, 0),
        retenido: 0,
        total: facturasEmitidas.reduce((s, f) => s + f.total, 0),
        count: facturasEmitidas.length,
      };
      const totalesRecibidas = {
        subtotal: facturasRecibidas.reduce((s, f) => s + f.subtotal, 0),
        descuento: facturasRecibidas.reduce((s, f) => s + 0, 0),
        impuesto: facturasRecibidas.reduce((s, f) => s + f.totalImpuestos, 0),
        retenido: 0,
        total: facturasRecibidas.reduce((s, f) => s + f.total, 0),
        count: facturasRecibidas.length,
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
      for (const f of facturasEmitidas) {
        filasMes.push({
          xml: f.uuid || '',
          rfc_emisor: f.emisorRfc || empresa?.rfc || '',
          nombre_emisor: f.emisorNombre || empresa?.nombre || '',
          lugarexp: '',
          regimen_fiscal: empresa?.regimenFiscal || '',
          rfc_receptor: f.receptorRfc || '',
          nombre_receptor: f.receptorNombre || '',
          tipo: f.tipoComprobante === 'E' ? 'nota de crédito' : 'ingreso',
          serie: f.serie || '',
          folio: f.folio || '',
          fecha: new Date(f.fecha),
          sub_total: f.subtotal,
          descuento: 0,
          total_impuesto_trasladado: f.totalImpuestos,
          nombre_impuesto: '002 - IVA',
          total_impuesto_retenido: 0,
          nombre_impuesto_2: '',
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
      // Recibidas después (egreso)
      for (const f of facturasRecibidas) {
        filasMes.push({
          xml: f.uuid || '',
          rfc_emisor: f.emisorRfc || '',
          nombre_emisor: f.emisorNombre || '',
          lugarexp: '',
          regimen_fiscal: '',
          rfc_receptor: f.receptorRfc || empresa?.rfc || '',
          nombre_receptor: f.receptorNombre || empresa?.nombre || '',
          tipo: f.tipoComprobante === 'E' ? 'nota de crédito' : 'egreso',
          serie: f.serie || '',
          folio: f.folio || '',
          fecha: new Date(f.fecha),
          sub_total: f.subtotal,
          descuento: 0,
          total_impuesto_trasladado: f.totalImpuestos,
          nombre_impuesto: '002 - IVA',
          total_impuesto_retenido: 0,
          nombre_impuesto_2: '',
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
          row.getCell(col).numFmt = '"$"#,##0.00';
        });
        // UUID en monoespacio
        row.getCell(19).font = { name: 'Consolas', size: 9 };
        row.height = 18;
      });

      // Fila de totales al final
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
        descuento: 0,
        total_impuesto_trasladado: totalesEmitidas.impuesto + totalesRecibidas.impuesto,
        nombre_impuesto: '',
        total_impuesto_retenido: 0,
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
      [12, 14, 18].forEach(col => {
        filaTotales.getCell(col).numFmt = '"$"#,##0.00';
      });

      // Freeze panes (primera fila + primeras 2 columnas)
      ws.views = [{ freeze: 'C2', showGridLines: false }];
    }

    // ===== Hoja Concentrado =====
    const wsConc = wb.addWorksheet('Concentrado', { views: [{ showGridLines: false }] });

    // Título
    wsConc.mergeCells('A1:O1');
    wsConc.getCell('A1').value = `${empresa?.nombre || 'EMPRESA'} — CONCENTRADO ANUAL ${anio}`;
    wsConc.getCell('A1').font = { bold: true, size: 16, color: { argb: COLORES.header } };
    wsConc.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    wsConc.getRow(1).height = 28;

    // Sub-títulos
    wsConc.mergeCells('A3:A4');
    wsConc.getCell('A3').value = 'Mes';
    wsConc.getCell('A3').font = { bold: true, color: { argb: 'FFFFFFFF' } };
    wsConc.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.concentrado } };
    wsConc.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle' };

    // Facturas Emitidas
    wsConc.mergeCells('B3:G3');
    wsConc.getCell('B3').value = 'FACTURAS EMITIDAS';
    wsConc.getCell('B3').font = { bold: true, color: { argb: 'FFFFFFFF' } };
    wsConc.getCell('B3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.ingreso } };
    wsConc.getCell('B3').alignment = { horizontal: 'center' };

    const headersEmitidas = ['Sub Total', 'Descuentos', 'Impuesto', 'Imp. Retenido', 'Total', 'Count'];
    headersEmitidas.forEach((h, i) => {
      const cell = wsConc.getCell(2 + i, 4); // row 4, col B+
      cell.value = h;
      cell.font = { bold: true, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD1FAE5' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Facturas Recibidas
    wsConc.mergeCells('H3:M3');
    wsConc.getCell('H3').value = 'FACTURAS RECIBIDAS';
    wsConc.getCell('H3').font = { bold: true, color: { argb: 'FFFFFFFF' } };
    wsConc.getCell('H3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.egreso } };
    wsConc.getCell('H3').alignment = { horizontal: 'center' };

    const headersRecibidas = ['Sub Total', 'Descuentos', 'Impuesto', 'Imp. Retenido', 'Total', 'Count'];
    headersRecibidas.forEach((h, i) => {
      const cell = wsConc.getCell(8 + i, 4); // row 4, col H+
      cell.value = h;
      cell.font = { bold: true, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEDD5' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Nómina
    wsConc.mergeCells('N3:O3');
    wsConc.getCell('N3').value = 'NÓMINA';
    wsConc.getCell('N3').font = { bold: true, color: { argb: 'FFFFFFFF' } };
    wsConc.getCell('N3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.nomina } };
    wsConc.getCell('N3').alignment = { horizontal: 'center' };

    ['Total', 'Count'].forEach((h, i) => {
      const cell = wsConc.getCell(14 + i, 4);
      cell.value = h;
      cell.font = { bold: true, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
      cell.alignment = { horizontal: 'center' };
    });

    // Filas por mes
    let rowIdx = 5;
    let granTotalEmitidas = { subtotal: 0, descuento: 0, impuesto: 0, retenido: 0, total: 0, count: 0 };
    let granTotalRecibidas = { subtotal: 0, descuento: 0, impuesto: 0, retenido: 0, total: 0, count: 0 };
    let granTotalNomina = { total: 0, count: 0 };

    totalesPorMes.forEach((tm) => {
      wsConc.getCell(`A${rowIdx}`).value = MESES_LARGO[tm.mes - 1];
      wsConc.getCell(`A${rowIdx}`).font = { bold: true };

      wsConc.getCell(`B${rowIdx}`).value = tm.emitidas.subtotal;
      wsConc.getCell(`C${rowIdx}`).value = tm.emitidas.descuento;
      wsConc.getCell(`D${rowIdx}`).value = tm.emitidas.impuesto;
      wsConc.getCell(`E${rowIdx}`).value = tm.emitidas.retenido;
      wsConc.getCell(`F${rowIdx}`).value = tm.emitidas.total;
      wsConc.getCell(`G${rowIdx}`).value = tm.emitidas.count;

      wsConc.getCell(`H${rowIdx}`).value = tm.recibidas.subtotal;
      wsConc.getCell(`I${rowIdx}`).value = tm.recibidas.descuento;
      wsConc.getCell(`J${rowIdx}`).value = tm.recibidas.impuesto;
      wsConc.getCell(`K${rowIdx}`).value = tm.recibidas.retenido;
      wsConc.getCell(`L${rowIdx}`).value = tm.recibidas.total;
      wsConc.getCell(`M${rowIdx}`).value = tm.recibidas.count;

      wsConc.getCell(`N${rowIdx}`).value = tm.nomina.total;
      wsConc.getCell(`O${rowIdx}`).value = tm.nomina.count;

      // Formato moneda
      ['B', 'C', 'D', 'E', 'F', 'H', 'I', 'J', 'K', 'L', 'N'].forEach(col => {
        wsConc.getCell(`${col}${rowIdx}`).numFmt = '"$"#,##0.00';
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

    // Fila de GRAN TOTAL
    wsConc.getCell(`A${rowIdx}`).value = 'TOTAL ANUAL';
    wsConc.getCell(`A${rowIdx}`).font = { bold: true, color: { argb: 'FF7C3AED' } };
    wsConc.getCell(`B${rowIdx}`).value = granTotalEmitidas.subtotal;
    wsConc.getCell(`C${rowIdx}`).value = granTotalEmitidas.descuento;
    wsConc.getCell(`D${rowIdx}`).value = granTotalEmitidas.impuesto;
    wsConc.getCell(`E${rowIdx}`).value = granTotalEmitidas.retenido;
    wsConc.getCell(`F${rowIdx}`).value = granTotalEmitidas.total;
    wsConc.getCell(`G${rowIdx}`).value = granTotalEmitidas.count;
    wsConc.getCell(`H${rowIdx}`).value = granTotalRecibidas.subtotal;
    wsConc.getCell(`I${rowIdx}`).value = granTotalRecibidas.descuento;
    wsConc.getCell(`J${rowIdx}`).value = granTotalRecibidas.impuesto;
    wsConc.getCell(`K${rowIdx}`).value = granTotalRecibidas.retenido;
    wsConc.getCell(`L${rowIdx}`).value = granTotalRecibidas.total;
    wsConc.getCell(`M${rowIdx}`).value = granTotalRecibidas.count;
    wsConc.getCell(`N${rowIdx}`).value = granTotalNomina.total;
    wsConc.getCell(`O${rowIdx}`).value = granTotalNomina.count;

    for (let c = 1; c <= 15; c++) {
      const cell = wsConc.getCell(rowIdx, c);
      cell.font = { bold: true, color: { argb: 'FF7C3AED' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORES.total } };
    }
    ['B', 'C', 'D', 'E', 'F', 'H', 'I', 'J', 'K', 'L', 'N'].forEach(col => {
      wsConc.getCell(`${col}${rowIdx}`).numFmt = '"$"#,##0.00';
    });

    // Anchos de columna
    wsConc.columns = [
      { width: 14 }, // A - Mes
      { width: 14 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 8 }, // B-G Emitidas
      { width: 14 }, { width: 12 }, { width: 12 }, { width: 14 }, { width: 16 }, { width: 8 }, // H-M Recibidas
      { width: 16 }, { width: 8 }, // N-O Nómina
    ];

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
        row.getCell(col).numFmt = '"$"#,##0.00';
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
      filaTotalNom.getCell(col).numFmt = '"$"#,##0.00';
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
