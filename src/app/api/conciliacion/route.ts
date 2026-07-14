import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * POST /api/conciliacion
 *
 * Recibe un Excel de concentrado (como el de ELECTRONICMA) y lo compara
 * con los CFDIs que ya están en la base de datos. Devuelve:
 *   - CFDIs que están en el Excel pero NO en la BD (faltantes)
 *   - CFDIs que están en la BD pero NO en el Excel (extra)
 *   - Diferencias en montos (mismo UUID pero diferente total)
 *   - Resumen por mes: total Excel vs total BD
 *
 * Formato del Excel esperado (cada hoja mensual):
 *   Columna 1: XML/UUID
 *   Columna 8: Tipo (ingreso / egreso / nota de crédito / Nómina 4.0)
 *   Columna 11: Fecha
 *   Columna 18: Total
 *   Columna 19: UUID (completo)
 *
 * Body (multipart/form-data):
 *   - file: archivo .xlsx o .xls del concentrado
 *   - empresaId: ID de la empresa
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface CFDIExcel {
  uuid: string;
  tipo: string; // ingreso, egreso, nota de crédito, nómina
  fecha: Date;
  total: number;
  rfcEmisor: string;
  rfcReceptor: string;
  folio: string;
  hoja: string;
}

async function parseExcelConcentrado(buffer: Buffer): Promise<CFDIExcel[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const cfdiList: CFDIExcel[] = [];

  for (const ws of wb.worksheets) {
    const nombreHoja = ws.name.toLowerCase();
    // Saltar hojas que no son mensuales
    if (nombreHoja === 'concentrado' || nombreHoja === 'nomina') continue;
    if (!nombreHoja.match(/^(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)/)) continue;

    // Header en fila 1
    const headerRow = ws.getRow(1);
    const headers: string[] = [];
    headerRow.eachCell((cell, col) => {
      headers[col] = String(cell.value || '').toLowerCase().trim();
    });

    // Buscar índices de columnas
    let colUUID = 1, colTipo = 8, colFecha = 11, colTotal = 18, colUUIDAlt = 19;
    let colRfcEmisor = 2, colRfcReceptor = 6, colFolio = 10;

    for (let c = 1; c <= headers.length; c++) {
      const h = headers[c] || '';
      if (h === 'xml' || h === 'uuid') colUUID = c;
      if (h === 'tipo') colTipo = c;
      if (h === 'fecha') colFecha = c;
      if (h === 'total') colTotal = c;
      if (h === 'rfc emisor') colRfcEmisor = c;
      if (h === 'rfc receptor') colRfcReceptor = c;
      if (h === 'folio') colFolio = c;
    }
    // UUID completo suele estar en col 19
    colUUIDAlt = colUUID === 1 ? 19 : colUUID;

    for (let r = 2; r <= ws.rowCount; r++) {
      const fila = ws.getRow(r);
      const uuidCell = fila.getCell(colUUIDAlt).value || fila.getCell(colUUID).value;
      if (!uuidCell) continue;
      const uuidStr = String(uuidCell).trim().toUpperCase();
      if (uuidStr.length < 20) continue; // No es UUID válido

      const tipoStr = String(fila.getCell(colTipo).value || '').toLowerCase().trim();
      const fechaCell = fila.getCell(colFecha).value;
      const totalCell = fila.getCell(colTotal).value;

      // Parsear fecha
      let fecha: Date | null = null;
      if (fechaCell instanceof Date) {
        fecha = fechaCell;
      } else if (typeof fechaCell === 'number') {
        fecha = new Date(Date.UTC(1899, 11, 30) + fechaCell * 24 * 60 * 60 * 1000);
      } else if (typeof fechaCell === 'string') {
        if (fechaCell.match(/^\d{4}-\d{2}-\d{2}/)) fecha = new Date(fechaCell);
      }
      if (!fecha) continue;

      // Parsear total
      let total = 0;
      if (typeof totalCell === 'number') total = totalCell;
      else if (typeof totalCell === 'string') {
        total = parseFloat(totalCell.replace(/[$,\s]/g, '')) || 0;
      }

      cfdiList.push({
        uuid: uuidStr,
        tipo: tipoStr,
        fecha,
        total,
        rfcEmisor: String(fila.getCell(colRfcEmisor).value || '').trim(),
        rfcReceptor: String(fila.getCell(colRfcReceptor).value || '').trim(),
        folio: String(fila.getCell(colFolio).value || '').trim(),
        hoja: ws.name,
      });
    }
  }

  return cfdiList;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const empresaId = formData.get('empresaId') as string;

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
    }
    if (!empresaId) {
      return NextResponse.json({ error: 'Falta empresaId' }, { status: 400 });
    }

    // Parsear Excel
    const buffer = Buffer.from(await file.arrayBuffer());
    const cfdiExcel = await parseExcelConcentrado(buffer);

    if (cfdiExcel.length === 0) {
      return NextResponse.json({
        error: 'No se encontraron CFDIs en el Excel. Verifica que tenga hojas mensuales (Ene, Feb, etc.) con la columna UUID y Total.',
      }, { status: 400 });
    }

    // Separar por tipo
    const facturasExcel = cfdiExcel.filter(c => c.tipo !== 'nómina 4.0' && c.tipo !== 'nomina 4.0');
    const nominasExcel = cfdiExcel.filter(c => c.tipo === 'nómina 4.0' || c.tipo === 'nomina 4.0');

    // Filtrar: excluir CFDIs tipo "pago" si los hubiera (el usuario dijo que no deben aparecer)
    const facturasExcelFiltered = facturasExcel.filter(c => !c.tipo.includes('pago'));

    // Obtener TODAS las facturas de la BD para esta empresa
    const facturasBD = await db.factura.findMany({
      where: {
        empresaId,
        estado: { not: 'cancelada' },
      },
      select: {
        id: true,
        uuid: true,
        fecha: true,
        total: true,
        direccion: true,
        tipoComprobante: true,
        emisorRfc: true,
        receptorRfc: true,
        folio: true,
        serie: true,
      },
    });

    const nominasBD = await db.reciboNomina.findMany({
      where: { empresaId },
      select: {
        id: true,
        uuid: true,
        fecha: true,
        totalPercepciones: true,
        neto: true,
      },
    });

    // Crear mapas por UUID
    const bdFacturasMap = new Map(facturasBD.map(f => [f.uuid?.toUpperCase(), f]));
    const bdNominasMap = new Map(nominasBD.map(n => [n.uuid?.toUpperCase(), n]));
    const excelFacturasMap = new Map(facturasExcelFiltered.map(c => [c.uuid, c]));
    const excelNominasMap = new Map(nominasExcel.map(c => [c.uuid, c]));

    // Comparar
    const faltantesEnBD: any[] = [];   // En Excel pero no en BD
    const extraEnBD: any[] = [];       // En BD pero no en Excel
    const diferenciasMonto: any[] = []; // UUID existe pero monto difiere
    const coincidencias: any[] = [];    // UUID y monto coinciden

    for (const cfdi of facturasExcelFiltered) {
      const enBD = bdFacturasMap.get(cfdi.uuid);
      if (!enBD) {
        faltantesEnBD.push({
          uuid: cfdi.uuid,
          fecha: cfdi.fecha,
          total: cfdi.total,
          rfcEmisor: cfdi.rfcEmisor,
          rfcReceptor: cfdi.rfcReceptor,
          folio: cfdi.folio,
          hoja: cfdi.hoja,
          tipo: cfdi.tipo,
        });
      } else {
        const diff = Math.abs(enBD.total - cfdi.total);
        if (diff > 0.01) {
          diferenciasMonto.push({
            uuid: cfdi.uuid,
            fecha: cfdi.fecha,
            totalExcel: cfdi.total,
            totalBD: enBD.total,
            diferencia: diff,
            folio: cfdi.folio,
            hoja: cfdi.hoja,
          });
        } else {
          coincidencias.push({ uuid: cfdi.uuid, total: cfdi.total });
        }
      }
    }

    for (const f of facturasBD) {
      if (!excelFacturasMap.has(f.uuid?.toUpperCase())) {
        extraEnBD.push({
          uuid: f.uuid,
          fecha: f.fecha,
          total: f.total,
          direccion: f.direccion,
          tipoComprobante: f.tipoComprobante,
          folio: f.serie ? `${f.serie}-${f.folio}` : f.folio,
        });
      }
    }

    // Comparar nómina
    const nominasFaltantes = nominasExcel.filter(n => !bdNominasMap.has(n.uuid));
    const nominasExtra = nominasBD.filter(n => !excelNominasMap.has(n.uuid?.toUpperCase()));

    // Resumen por mes
    const resumenMes: any = {};
    for (const c of facturasExcelFiltered) {
      const key = `${c.fecha.getFullYear()}-${String(c.fecha.getMonth() + 1).padStart(2, '0')}`;
      if (!resumenMes[key]) {
        resumenMes[key] = {
          excelEmitidas: 0, excelRecibidas: 0,
          bdEmitidas: 0, bdRecibidas: 0,
          excelEmitidasTotal: 0, excelRecibidasTotal: 0,
          bdEmitidasTotal: 0, bdRecibidasTotal: 0,
        };
      }
      // Determinar si es emitida o recibida
      const empresa = await db.empresa.findUnique({ where: { id: empresaId } });
      const esEmitida = empresa && c.rfcEmisor === empresa.rfc;
      if (esEmitida) {
        resumenMes[key].excelEmitidas++;
        resumenMes[key].excelEmitidasTotal += c.total;
      } else {
        resumenMes[key].excelRecibidas++;
        resumenMes[key].excelRecibidasTotal += c.total;
      }
    }

    // Agregar BD al resumen
    for (const f of facturasBD) {
      const key = `${f.fecha.getFullYear()}-${String(f.fecha.getMonth() + 1).padStart(2, '0')}`;
      if (!resumenMes[key]) continue;
      if (f.direccion === 'emitida') {
        resumenMes[key].bdEmitidas++;
        resumenMes[key].bdEmitidasTotal += f.total;
      } else {
        resumenMes[key].bdRecibidas++;
        resumenMes[key].bdRecibidasTotal += f.total;
      }
    }

    return NextResponse.json({
      totalExcel: facturasExcelFiltered.length,
      totalBD: facturasBD.length,
      coincidencias: coincidencias.length,
      faltantesEnBD: faltantesEnBD.length,
      extraEnBD: extraEnBD.length,
      diferenciasMonto: diferenciasMonto.length,
      nominasExcel: nominasExcel.length,
      nominasBD: nominasBD.length,
      nominasFaltantes: nominasFaltantes.length,
      nominasExtra: nominasExtra.length,
      detalleFaltantes: faltantesEnBD.slice(0, 100),
      detalleExtra: extraEnBD.slice(0, 100),
      detalleDiferencias: diferenciasMonto.slice(0, 50),
      resumenMes,
      message: `Conciliación: ${coincidencias.length} coincidencias, ${faltantesEnBD.length} faltantes en BD, ${extraEnBD.length} extra en BD, ${diferenciasMonto.length} diferencias de monto`,
    });
  } catch (e: any) {
    console.error('Error en /api/conciliacion:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
