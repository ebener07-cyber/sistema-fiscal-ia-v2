import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * POST /api/upload-estado-cuenta
 * Carga un estado de cuenta (Excel, CSV o PDF) y procesa los movimientos.
 *
 * Body (multipart/form-data):
 *   - file: archivo .xlsx, .csv o .pdf
 *   - cuentaId: ID de la cuenta bancaria
 *   - mes: mes del estado (1-12)
 *   - anio: año del estado
 *
 * Formatos soportados:
 *   - Excel (.xlsx, .xls): usa exceljs para leer hojas
 *   - CSV (.csv): parsea con separador automático (, ; \t)
 *   - PDF (.pdf): guarda el archivo pero NO extrae movimientos automáticamente
 *                  (requiere OCR/parseo manual)
 *
 * Si ya existen movimientos con misma fecha + concepto + monto, los salta (dedupe).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { writeFile, mkdir, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

interface MovimientoImportado {
  fecha: Date;
  concepto: string;
  monto: number;
}

// ===== Parser de CSV =====
function parseCSV(texto: string): MovimientoImportado[] {
  const lineas = texto.split(/\r?\n/).filter(l => l.trim());
  if (lineas.length === 0) return [];

  // Detectar separador
  const separador = lineas[0].includes(';') ? ';' : lineas[0].includes('\t') ? '\t' : ',';

  // Saltar header si existe
  let empezarDesde = 0;
  if (lineas[0].toLowerCase().includes('fecha') || lineas[0].toLowerCase().includes('date')) {
    empezarDesde = 1;
  }

  const movimientos: MovimientoImportado[] = [];

  for (let i = empezarDesde; i < lineas.length; i++) {
    const partes = lineas[i].split(separador).map(p => p.trim().replace(/"/g, ''));
    if (partes.length < 3) continue;

    try {
      // Parsear fecha (DD/MM/YYYY o YYYY-MM-DD o DD-MM-YYYY)
      let fecha: Date;
      const fechaStr = partes[0];
      if (fechaStr.match(/^\d{4}-\d{2}-\d{2}/)) {
        fecha = new Date(fechaStr);
      } else if (fechaStr.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
        const [dia, mes, anio] = fechaStr.split('/');
        fecha = new Date(parseInt(anio), parseInt(mes) - 1, parseInt(dia));
      } else if (fechaStr.match(/^\d{1,2}-\d{1,2}-\d{4}/)) {
        const [dia, mes, anio] = fechaStr.split('-');
        fecha = new Date(parseInt(anio), parseInt(mes) - 1, parseInt(dia));
      } else {
        continue;
      }

      // Buscar monto (puede estar en columna 2, 3, 4, etc.)
      let monto = 0;
      let concepto = partes[1] || 'Movimiento';
      for (let j = 2; j < partes.length; j++) {
        const valor = partes[j].replace(/[$,\s]/g, '').replace(',', '.');
        // Intentar parsear como número
        const cleaned = valor.replace(/[^0-9.-]/g, '');
        const parsed = parseFloat(cleaned);
        if (!isNaN(parsed) && parsed !== 0) {
          monto = parsed;
          if (partes[j + 1]) concepto = `${concepto} ${partes[j + 1]}`.trim();
          break;
        }
      }

      if (monto === 0) continue;

      movimientos.push({ fecha, concepto, monto });
    } catch {
      continue;
    }
  }

  return movimientos;
}

// ===== Parser de Excel (.xlsx) usando exceljs =====
// Soporta formatos:
//   - Genérico: Fecha | Concepto | Monto (con signo)
//   - Banorte: CUENTA | FECHA | REFERENCIA | DESCRIPCIÓN | DEPÓSITOS | RETIROS | SALDO
//   - BBVA: Fecha | Concepto | Depósitos | Retiros | Saldo
//   - Cualquier banco con columnas separadas de Cargo/Abono o Depósito/Retiro
async function parseExcel(buffer: Buffer): Promise<MovimientoImportado[]> {
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);

  const movimientos: MovimientoImportado[] = [];

  for (const ws of wb.worksheets) {
    // Buscar fila de headers (puede no ser la primera)
    let headerRow = 1;
    const headers: string[] = [];
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const fila = ws.getRow(r);
      const tempHeaders: string[] = [];
      fila.eachCell((cell, col) => {
        tempHeaders[col] = String(cell.value || '').toLowerCase().trim();
      });
      const joined = tempHeaders.join('|');
      // Detectar fila con headers de banco
      if (
        joined.includes('fecha') &&
        (joined.includes('descripci') || joined.includes('concepto') || joined.includes('descrip'))
      ) {
        for (let c = 1; c <= tempHeaders.length; c++) headers[c] = tempHeaders[c];
        headerRow = r;
        break;
      }
    }

    // Si no encontró headers, intentar con la primera fila
    if (headers.length === 0) {
      const primeraFila = ws.getRow(1);
      primeraFila.eachCell((cell, col) => {
        headers[col] = String(cell.value || '').toLowerCase().trim();
      });
    }

    // Mapear columnas
    let colFecha = 1, colConcepto = 2, colDeposito = 0, colRetiro = 0, colMonto = 0;
    let colDescripcionDetallada = 0;
    let colReferencia = 0;

    for (let c = 1; c <= Math.max(headers.length, 20); c++) {
      const h = headers[c] || '';
      if (h.includes('fecha') && !h.includes('opera')) colFecha = c;
      else if (h.includes('fecha')) colFecha = c; // "FECHA DE OPERACIÓN" también cuenta
      if (h === 'descripción' || h === 'descripcion' || h.includes('descrip') || h.includes('concepto') || h.includes('detalle')) {
        if (!colConcepto || colConcepto === 2) colConcepto = c;
      }
      if (h.includes('descripción detallada') || h.includes('descripcion detallada')) colDescripcionDetallada = c;
      if (h.includes('referencia')) colReferencia = c;
      // Depósitos / Abonos / Créditos
      if (h.includes('depósito') || h.includes('deposito') || h.includes('abono') || h.includes('crédito') || h.includes('credito') || h.includes('ingreso')) {
        colDeposito = c;
      }
      // Retiros / Cargos / Débitos
      if (h.includes('retiro') || h.includes('cargo') || h.includes('débito') || h.includes('debito') || h.includes('egreso')) {
        colRetiro = c;
      }
      // Monto único (con signo)
      if (h.includes('monto') || h.includes('importe') || h.includes('amount') || h.includes('movimiento')) {
        colMonto = c;
      }
    }

    const filaInicio = headerRow + 1;

    for (let r = filaInicio; r <= ws.rowCount; r++) {
      const fila = ws.getRow(r);
      try {
        const cellFecha = fila.getCell(colFecha).value;

        // Saltar filas vacías
        if (!cellFecha) continue;

        // Parsear fecha
        let fecha: Date | null = null;
        if (cellFecha instanceof Date) {
          fecha = cellFecha;
        } else if (typeof cellFecha === 'number') {
          // Excel serial date
          fecha = new Date(Date.UTC(1899, 11, 30) + cellFecha * 24 * 60 * 60 * 1000);
        } else if (typeof cellFecha === 'string') {
          if (cellFecha.match(/^\d{4}-\d{2}-\d{2}/)) {
            fecha = new Date(cellFecha);
          } else if (cellFecha.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
            const [dia, mes, anio] = cellFecha.split('/');
            fecha = new Date(parseInt(anio), parseInt(mes) - 1, parseInt(dia));
          } else if (cellFecha.match(/^\d{1,2}-\d{1,2}-\d{4}/)) {
            const [dia, mes, anio] = cellFecha.split('-');
            fecha = new Date(parseInt(anio), parseInt(mes) - 1, parseInt(dia));
          }
        }
        if (!fecha || isNaN(fecha.getTime())) continue;

        // Concepto (principal + descripción detallada si existe)
        const conceptoBase = String(fila.getCell(colConcepto).value || 'Movimiento').trim();
        let concepto = conceptoBase;
        if (colDescripcionDetallada) {
          const detalle = String(fila.getCell(colDescripcionDetallada).value || '').trim();
          if (detalle && detalle !== '-' && detalle !== conceptoBase) {
            concepto = `${conceptoBase} — ${detalle}`.slice(0, 500);
          }
        }
        if (colReferencia) {
          const ref = String(fila.getCell(colReferencia).value || '').trim();
          if (ref && ref !== '-') {
            concepto = `Ref: ${ref} · ${concepto}`.slice(0, 500);
          }
        }

        // Calcular monto según el formato detectado
        let monto = 0;

        // Caso 1: Banorte-style — columnas separadas Depósito/Retiro
        if (colDeposito || colRetiro) {
          let deposito = 0, retiro = 0;
          if (colDeposito) {
            const val = parseNumberFromCell(fila.getCell(colDeposito).value);
            deposito = val;
          }
          if (colRetiro) {
            const val = parseNumberFromCell(fila.getCell(colRetiro).value);
            retiro = val;
          }
          monto = deposito - retiro;
        }
        // Caso 2: Monto único con signo
        else if (colMonto) {
          monto = parseNumberFromCell(fila.getCell(colMonto).value);
        }
        // Caso 3: Fallback — buscar cualquier número en la fila después de la columna concepto
        else {
          for (let c = colConcepto + 1; c <= Math.min(fila.cellCount, 15); c++) {
            const val = parseNumberFromCell(fila.getCell(c).value);
            if (val !== 0) {
              monto = val;
              break;
            }
          }
        }

        if (monto === 0) continue;

        movimientos.push({ fecha, concepto, monto });
      } catch {
        continue;
      }
    }
  }

  return movimientos;
}

function parseNumberFromCell(value: any): number {
  if (value === null || value === undefined || value === '' || value === '-') return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    // Limpiar: quitar $, comas, espacios, signos de moneda
    const cleaned = value.replace(/[$,\s]/g, '').replace(/[^0-9.-]/g, '');
    return parseFloat(cleaned) || 0;
  }
  if (typeof value === 'object' && 'result' in value) {
    return parseFloat(String(value.result)) || 0;
  }
  return 0;
}

// ===== Parser de texto extraído de PDF =====

/**
 * Extrae texto de un PDF sin usar librerías externas (compatible con Vercel serverless).
 * 
 * Funciona buscando texto en los content streams del PDF:
 * 1. Busca streams entre "stream" y "endstream"
 * 2. Intenta descomprimir con zlib si están comprimidos con FlateDecode
 * 3. Extrae texto de operadores Tj y TJ dentro de bloques BT/ET
 */
function extraerTextoPDF(buffer: Buffer): string {
  const zlib = require('zlib');
  const textoCompleto: string[] = [];

  // Convertir buffer a string latin1 para preservar bytes
  const pdfStr = buffer.toString('latin1');

  // Buscar todos los streams en el PDF
  const streamRegex = /stream\r?\n([\s\S]*?)endstream/g;
  let streamMatch;

  while ((streamMatch = streamRegex.exec(pdfStr)) !== null) {
    const streamData = streamMatch[1];

    try {
      // Intentar descomprimir con FlateDecode (zlib)
      let decompressed: string;
      try {
        const compressed = Buffer.from(streamData, 'latin1');
        const decompressedBuffer = zlib.inflateSync(compressed);
        decompressed = decompressedBuffer.toString('latin1');
      } catch {
        // Si no se puede descomprimir, usar el texto tal cual
        decompressed = streamData;
      }

      // Extraer texto de operadores Tj: (texto) Tj
      const tjRegex = /\(([^)]{1,200})\)\s*Tj/g;
      let tjMatch;
      while ((tjMatch = tjRegex.exec(decompressed)) !== null) {
        const text = decodePdfString(tjMatch[1]);
        if (text && text.trim()) {
          textoCompleto.push(text);
        }
      }

      // Extraer texto de operadores TJ: [(texto1) -250 (texto2)] TJ
      const tjArrayRegex = /\[([^\]]{1,500})\]\s*TJ/g;
      let tjArrayMatch;
      while ((tjArrayMatch = tjArrayRegex.exec(decompressed)) !== null) {
        const arrayContent = tjArrayMatch[1];
        // Extraer todos los strings entre paréntesis
        const stringParts: string[] = [];
        const partRegex = /\(([^)]{1,200})\)/g;
        let partMatch;
        while ((partMatch = partRegex.exec(arrayContent)) !== null) {
          stringParts.push(decodePdfString(partMatch[1]));
        }
        if (stringParts.length > 0) {
          textoCompleto.push(stringParts.join(''));
        }
      }
    } catch {
      // Saltar streams que no se pueden procesar
      continue;
    }
  }

  // También buscar texto que no esté en streams (algunos PDFs simples)
  const simpleTextRegex = /\(([\w\s\/\-\.,$:#áéíóúñÁÉÍÓÚÑ]{3,80})\)\s*Tj/g;
  let simpleMatch;
  while ((simpleMatch = simpleTextRegex.exec(pdfStr)) !== null) {
    const text = simpleMatch[1];
    if (text && text.trim().length > 2) {
      textoCompleto.push(text);
    }
  }

  return textoCompleto.join('\n');
}

/**
 * Decodifica un string de PDF (maneja escapes básicos)
 */
function decodePdfString(str: string): string {
  return str
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .trim();
}

// Busca patrones de fecha + descripción + monto en cada línea
// Soporta formatos:
//   - DD/MM/YYYY, DD-MM-YYYY (fechas numéricas)
//   - DD-ENE-26 (fechas con mes abreviado en español — formato Banorte)
function parsePDFTexto(texto: string): MovimientoImportado[] {
  // Llamar a la versión nueva que detecta múltiples cuentas
  const resultado = parsePDFTextoMultiCuenta(texto);
  return resultado.movimientos;
}

/**
 * Versión mejorada del parser que detecta MÚLTIPLES cuentas en el mismo PDF.
 * 
 * SOPORTA:
 * 1. Banorte: 2 secciones (ENLACE NEGOCIOS AVANZADA + INVERSION ENLACE NEGOCIOS)
 * 2. Santander: 2 secciones (Detalle de movimientos cuenta de cheques + Detalles de movimientos Dinero Creciente)
 * 
 * MEJORAS v2.4:
 * - Detección explícita de secciones por headers (no por contexto difuso)
 * - Extracción ESTRICTA de montos (NN,NNN.NN con 2 decimales obligatorios)
 * - No confunde folios (7113421), CLABEs (014180655090853560), ni referencias con montos
 * - Captura correctamente "SALDO FINAL DEL PERIODO ANTERIOR" como saldo inicial
 * - Maneja movimientos multi-línea (descripción + varias líneas + monto+saldo)
 * - Detecta fin de sección por línea "TOTAL" o "SALDO FINAL DEL PERIODO"
 */
function parsePDFTextoMultiCuenta(texto: string): {
  movimientos: MovimientoImportado[];
  seccionesDetectadas: Array<{ tipo: string; cuentaNumero: string; count: number; saldoInicial: number | null }>;
} {
  const lineas = texto.split(/\r?\n/);

  // Mapeo de meses abreviados en español (formato Banorte: 08-ENE-26, Santander: 04-MAY-2026)
  const MESES_ES: Record<string, number> = {
    'ENE': 0, 'FEB': 1, 'MAR': 2, 'ABR': 3, 'MAY': 4, 'JUN': 5,
    'JUL': 6, 'AGO': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DIC': 11,
    'ENERO': 0, 'FEBRERO': 1, 'MARZO': 2, 'ABRIL': 3, 'MAYO': 4, 'JUNIO': 5,
    'JULIO': 6, 'AGOSTO': 7, 'SEPTIEMBRE': 8, 'OCTUBRE': 9, 'NOVIEMBRE': 10, 'DICIEMBRE': 11,
  };

  // Patrones de fecha
  const patronFechaBanorte = /(\d{1,2})-([A-Z]{3,9})-(\d{2,4})/;
  const patronFechaNum = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;

  // ===== EXTRACCIÓN ESTRICTA DE MONTOS =====
  // Solo captura números con EXACTAMENTE 2 decimales (NN,NNN.NN o NNN.NN)
  // No captura números pegados a letras ni números sin decimales
  function extraerMontosLinea(linea: string): number[] {
    const montos: number[] = [];
    const regex = /(?:^|\s)(\d{1,3}(?:,\d{3})*\.\d{2})(?:\s|$)/g;
    let match;
    while ((match = regex.exec(linea)) !== null) {
      const valor = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(valor) && valor > 0.5) {
        montos.push(valor);
      }
    }
    return montos;
  }

  function quitarMontos(texto: string): string {
    return texto.replace(/(?:^|\s)\d{1,3}(?:,\d{3})*\.\d{2}(?:\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // ===== FASE 1: DETECTAR SECCIONES =====
  // Buscar headers de secciones conocidos:
  // - Santander: "Detalle de movimientos cuenta de cheques." + "Detalles de movimientos Dinero Creciente"
  // - Banorte: "ENLACE NEGOCIOS AVANZADA" + "INVERSION ENLACE NEGOCIOS"
  interface Seccion {
    tipo: 'operaciones' | 'inversion';
    cuentaNum: string;
    lineaInicio: number;
    lineaFin: number | null;
    saldoInicial: number | null;
    banco: 'santander' | 'banorte' | 'desconocido';
  }
  
  const secciones: Seccion[] = [];
  let seccionActual: Seccion | null = null;

  function cerrarSeccion(lineaFin: number) {
    if (seccionActual) {
      seccionActual.lineaFin = lineaFin;
      secciones.push(seccionActual);
      seccionActual = null;
    }
  }

  function iniciarSeccion(tipo: 'operaciones' | 'inversion', banco: 'santander' | 'banorte', lineaInicio: number) {
    // Buscar número de cuenta en las siguientes 3 líneas
    let cuentaNum = '';
    for (let j = lineaInicio; j < Math.min(lineaInicio + 4, lineas.length); j++) {
      // Santander: 65-50908535-6 (DD-NNNNNNNN-D)
      let match = lineas[j].match(/(\d{2}-\d{8}-\d)/);
      if (match) { cuentaNum = match[1]; break; }
      // Banorte: 1282396470 (10 dígitos)
      match = lineas[j].match(/No\.?\s*de\s*Cuenta:?\s*(\d{6,})/i);
      if (match) { cuentaNum = match[1]; break; }
    }
    
    // Buscar saldo inicial
    let saldoInicial: number | null = null;
    for (let j = lineaInicio; j < Math.min(lineaInicio + 6, lineas.length); j++) {
      // "SALDO FINAL DEL PERIODO ANTERIOR:   $82,075.16" (Santander)
      const matchSaldo = lineas[j].match(/SALDO.*?ANTERIOR:?\s*\$?([\d,]+\.\d{2})/i);
      if (matchSaldo) {
        saldoInicial = parseFloat(matchSaldo[1].replace(/[$,]/g, ''));
        break;
      }
      // "SALDO ANTERIOR: $119,827.38" (Banorte)
      const matchSaldoBn = lineas[j].match(/SALDO\s+ANTERIOR\s*:?\s*\$?([\d,]+\.\d{2})/i);
      if (matchSaldoBn) {
        saldoInicial = parseFloat(matchSaldoBn[1].replace(/[$,]/g, ''));
        break;
      }
    }
    
    seccionActual = { tipo, cuentaNum, lineaInicio, lineaFin: null, saldoInicial, banco };
  }

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaUpper = linea.toUpperCase();
    
    // ===== DETECCIÓN SANTANDER =====
    // "Detalle de movimientos cuenta de cheques."
    if (lineaUpper.includes('DETALLE DE MOVIMIENTOS CUENTA DE CHEQUES') ||
        (lineaUpper.includes('DETALLE DE MOVIMIENTOS') && !lineaUpper.includes('DINERO'))) {
      cerrarSeccion(i - 1);
      iniciarSeccion('operaciones', 'santander', i);
    }
    // "Detalles de movimientos Dinero Creciente Santander." (sección de inversión)
    if (lineaUpper.includes('DETALLES DE MOVIMIENTOS DINERO') || 
        (lineaUpper.includes('DETALLE DE MOVIMIENTOS') && lineaUpper.includes('DINERO'))) {
      cerrarSeccion(i - 1);
      iniciarSeccion('inversion', 'santander', i);
    }
    
    // ===== DETECCIÓN BANORTE =====
    if (lineaUpper.includes('INVERSION') && lineaUpper.includes('ENLACE NEGOCIOS')) {
      cerrarSeccion(i - 1);
      iniciarSeccion('inversion', 'banorte', i);
    }
    if (lineaUpper.includes('ENLACE NEGOCIOS AVANZADA') || 
        (lineaUpper.includes('ENLACE NEGOCIOS') && !lineaUpper.includes('INVERSION'))) {
      cerrarSeccion(i - 1);
      iniciarSeccion('operaciones', 'banorte', i);
    }
    
    // ===== FIN DE SECCIÓN =====
    // "TOTAL   797,935.76   371,869.72" o "SALDO FINAL DEL PERIODO:"
    if (seccionActual && seccionActual.lineaFin === null) {
      if (lineaUpper.match(/^TOTAL\s+\d/) || 
          (lineaUpper.includes('SALDO FINAL DEL PERIODO') && !lineaUpper.includes('ANTERIOR')) ||
          lineaUpper.includes('INFORMACION FISCAL') ||
          lineaUpper.includes('INFORMACIÓN FISCAL')) {
        cerrarSeccion(i);
      }
    }
  }
  // Cerrar última sección
  cerrarSeccion(lineas.length - 1);

  // ===== FASE 2: PARSEAR MOVIMIENTOS DE CADA SECCIÓN =====
  function parsearSeccion(seccion: Seccion): MovimientoImportado[] {
    const movimientos: MovimientoImportado[] = [];
    let saldoAnterior = seccion.saldoInicial;
    
    let i = seccion.lineaInicio;
    while (i <= (seccion.lineaFin ?? lineas.length - 1)) {
      const linea = lineas[i];
      if (!linea || !linea.trim()) { i++; continue; }
      
      // Buscar fecha al inicio de la línea (puede ser Banorte DD-ENE-26 o Santander DD-MAY-2026)
      const matchFecha = linea.match(patronFechaBanorte) || linea.match(patronFechaNum);
      if (!matchFecha) { i++; continue; }
      
      // Saltar headers
      const lineaUpper = linea.toUpperCase();
      if (lineaUpper.includes('FECHA') && lineaUpper.includes('FOLIO')) { i++; continue; }
      if (lineaUpper.match(/^TOTAL\s/) || lineaUpper.includes('SALDO FINAL DEL PERIODO')) { i++; continue; }
      
      const dia = parseInt(matchFecha[1]);
      let mes: number | undefined;
      let mesStr = '';
      
      if (matchFecha[2] && isNaN(parseInt(matchFecha[2]))) {
        // Es mes en texto (ENE, FEB, etc.)
        mesStr = matchFecha[2].toUpperCase();
        mes = MESES_ES[mesStr];
      } else {
        // Es mes numérico (01, 02, etc.)
        mes = parseInt(matchFecha[2]) - 1;
      }
      
      let anio = parseInt(matchFecha[3]);
      if (anio < 100) anio = anio < 30 ? 2000 + anio : 1900 + anio;
      
      if (mes === undefined || mes < 0 || mes > 11 || dia < 1 || dia > 31) { i++; continue; }
      
      const fecha = new Date(anio, mes, dia, 12, 0, 0);
      const restoLinea = linea.substring(matchFecha.index! + matchFecha[0].length).trim();
      
      // Acumular descripción y buscar monto+saldo
      let concepto = restoLinea;
      let montoEncontrado: number | null = null;
      let saldoEncontrado: number | null = null;
      let lineaMontoIdx = -1;
      
      // Buscar montos en la línea actual (caso simple: fecha + descripción + monto + saldo en una línea)
      // Pero tambien considerar que el saldo puede ser 0.00 (que el filtro > 0.5 descarta)
      // Por eso, extraemos TODOS los números con formato monetario (incluso 0.00)
      function extraerMontosLineaInclusivo(linea: string): number[] {
        const montos: number[] = [];
        const regex = /(?:^|\s)(\d{1,3}(?:,\d{3})*\.\d{2})(?:\s|$)/g;
        let match;
        while ((match = regex.exec(linea)) !== null) {
          const valor = parseFloat(match[1].replace(/,/g, ''));
          if (!isNaN(valor)) {
            montos.push(valor);
          }
        }
        return montos;
      }
      
      const montosAqui = extraerMontosLinea(linea);
      const montosAquiInclusivo = extraerMontosLineaInclusivo(linea);
      
      if (montosAquiInclusivo.length >= 2) {
        // Hay al menos 2 montos: el primero es el monto del movimiento, el segundo es el saldo
        montoEncontrado = montosAquiInclusivo[0];
        saldoEncontrado = montosAquiInclusivo[1];
        // Solo aceptar si el monto es > 0.5 (el saldo puede ser 0)
        if (Math.abs(montoEncontrado) < 0.5) {
          montoEncontrado = null;
          saldoEncontrado = null;
        } else {
          concepto = quitarMontos(restoLinea);
          lineaMontoIdx = i;
        }
      } else if (montosAqui.length === 1 && restoLinea.length < 50) {
        // Solo 1 monto y descripción corta — puede ser movimiento simple sin saldo
        montoEncontrado = montosAqui[0];
        concepto = quitarMontos(restoLinea);
        lineaMontoIdx = i;
      }
      
      // Si no, buscar en líneas siguientes (movimientos multi-línea)
      if (montoEncontrado === null) {
        let j = i + 1;
        const limiteBusqueda = Math.min((seccion.lineaFin ?? lineas.length - 1) + 1, i + 20);
        while (j < limiteBusqueda) {
          const lineaSiguiente = lineas[j];
          if (!lineaSiguiente || !lineaSiguiente.trim()) { j++; continue; }
          
          // Si encontramos otra fecha al inicio, ya no hay montos
          const matchFechaSgte = lineaSiguiente.match(patronFechaBanorte) || lineaSiguiente.match(patronFechaNum);
          if (matchFechaSgte && matchFechaSgte.index === 0) break;
          
          const lUpper = lineaSiguiente.toUpperCase();
          if (lUpper.match(/^TOTAL\s/) || lUpper.includes('SALDO FINAL DEL PERIODO')) break;
          
          const montosSgte = extraerMontosLinea(lineaSiguiente);
          if (montosSgte.length >= 2) {
            montoEncontrado = montosSgte[0];
            saldoEncontrado = montosSgte[1];
            lineaMontoIdx = j;
            break;
          } else if (montosSgte.length === 1 && j > i + 1) {
            montoEncontrado = montosSgte[0];
            saldoEncontrado = null;
            lineaMontoIdx = j;
            break;
          }
          
          concepto += ' ' + lineaSiguiente.trim();
          j++;
        }
      }
      
      if (montoEncontrado === null || Math.abs(montoEncontrado) < 0.5) { i++; continue; }
      
      // Limpiar concepto: quitar folio al inicio (7 dígitos) y montos
      concepto = concepto.replace(/^\s*\d{7}\s*/, '');
      concepto = quitarMontos(concepto).replace(/\s+/g, ' ').trim().slice(0, 300);
      if (!concepto) concepto = 'Movimiento bancario';
      
      // Determinar signo
      let montoFinal = montoEncontrado;
      if (saldoEncontrado !== null && saldoAnterior !== null) {
        const diferencia = saldoEncontrado - saldoAnterior;
        if (Math.abs(Math.abs(diferencia) - montoEncontrado) < montoEncontrado * 0.02) {
          montoFinal = diferencia;
        } else if (diferencia < 0) {
          montoFinal = -Math.abs(montoEncontrado);
        } else {
          montoFinal = Math.abs(montoEncontrado);
        }
      } else {
        // Fallback por keywords
        const conceptoUpper = concepto.toUpperCase();
        const esRetiro = ['COMPRA', 'PAGO', 'RETIRO', 'CARGO', 'TRASPASO', 'COMISION', 'COMISIÓN', 
                          'TRANSFERENCIA', 'INTERESES EXENTO', 'PAGO DE CAPITAL', 'PAGO DE CREDITO', 
                          'ADMINISTRACION', 'CGO', 'CARGO CAPITAL', 'CARGO POR', 'CGO INTERESES',
                          'I V A POR COMISION', 'PAGO PRIMA SEGURO', 'I.V.A.'].some(k => conceptoUpper.includes(k));
        const esDeposito = ['DISPOSICION', 'RECIBIDO', 'DEPOSITO DE CUENTA', 'DEV. DEPOSITO', 
                            'DEVOLUCION', 'ABONO', 'APORT LINEA CAPTURA'].some(k => conceptoUpper.includes(k));
        if (esRetiro) montoFinal = -Math.abs(montoEncontrado);
        else if (esDeposito) montoFinal = Math.abs(montoEncontrado);
      }
      
      if (saldoEncontrado !== null) saldoAnterior = saldoEncontrado;
      
      movimientos.push({
        fecha,
        concepto,
        monto: montoFinal,
        ...(seccion.tipo === 'inversion' ? { esInversion: true } : {}),
      } as any);
      
      i = lineaMontoIdx > 0 ? lineaMontoIdx + 1 : i + 1;
    }
    
    return movimientos;
  }

  // ===== FASE 3: PROCESAR TODAS LAS SECCIONES =====
  const todosMovimientos: MovimientoImportado[] = [];
  const seccionesDetectadas: Array<{ tipo: string; cuentaNumero: string; count: number; saldoInicial: number | null }> = [];
  
  for (const seccion of secciones) {
    const movs = parsearSeccion(seccion);
    todosMovimientos.push(...movs);
    seccionesDetectadas.push({
      tipo: seccion.tipo,
      cuentaNumero: seccion.cuentaNum,
      count: movs.length,
      saldoInicial: seccion.saldoInicial,
    });
  }

  return { movimientos: todosMovimientos, seccionesDetectadas };
}

// Extrae montos numéricos de una línea (formato: 80,000.00 o $1,234.56)
function extraerMontos(linea: string): number[] {
  const montos: number[] = [];
  const regex = /-?\$?\s?[\d,]+\.\d{2}/g;
  let match;
  while ((match = regex.exec(linea)) !== null) {
    const valor = parseFloat(match[0].replace(/[$,\s]/g, ''));
    if (!isNaN(valor) && Math.abs(valor) > 0.5) {
      montos.push(valor);
    }
  }
  return montos;
}

// Quita los montos de un texto para dejar solo la descripción
function quitarMontos(texto: string): string {
  return texto.replace(/-?\$?\s?[\d,]+\.\d{2}/g, '').trim();
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const cuentaId = formData.get('cuentaId') as string;
    const mes = parseInt(formData.get('mes') as string);
    const anio = parseInt(formData.get('anio') as string);

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
    }
    if (!cuentaId) {
      return NextResponse.json({ error: 'Falta cuentaId' }, { status: 400 });
    }

    // Verificar que existe la cuenta
    const cuenta = await db.cuentaBancaria.findUnique({ where: { id: cuentaId } });
    if (!cuenta) {
      return NextResponse.json({ error: 'Cuenta bancaria no encontrada' }, { status: 404 });
    }

    // Guardar el archivo
    const isVercel = !!process.env.VERCEL;
    const uploadBase = isVercel ? '/tmp' : process.cwd();
    const uploadDir = path.join(uploadBase, 'uploads', 'estados-cuenta');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const fileName = `estado_${cuentaId}_${anio}_${String(mes).padStart(2, '0')}.${ext}`;
    const filePath = path.join(uploadDir, fileName);

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // ===== AUTO-DETECCIÓN DE BANCO DESDE EL PDF =====
    // Si el PDF es de un banco distinto al de la cuenta seleccionada, 
    // buscar o crear la cuenta correcta automáticamente.
    if (ext === 'pdf') {
      try {
        // Polyfills
        if (typeof (globalThis as any).DOMMatrix === 'undefined') {
          (globalThis as any).DOMMatrix = class DOMMatrix {
            private _a = 1; private _b = 0; private _c = 0; private _d = 1; private _e = 0; private _f = 0;
            constructor(init?: any) {
              if (Array.isArray(init)) {
                this._a = init[0] || 1; this._b = init[1] || 0;
                this._c = init[2] || 0; this._d = init[3] || 1;
                this._e = init[4] || 0; this._f = init[5] || 0;
              }
            }
            get a() { return this._a; } get b() { return this._b; }
            get c() { return this._c; } get d() { return this._d; }
            get e() { return this._e; } get f() { return this._f; }
            multiply() { return this; } translate() { return this; } scale() { return this; }
          };
        }
        if (typeof (globalThis as any).Path2D === 'undefined') {
          (globalThis as any).Path2D = class Path2D {
            constructor() {} moveTo() {} lineTo() {} closePath() {} arc() {} rect() {} ellipse() {}
          };
        }
        const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.js');
        const data = new Uint8Array(buffer);
        const pdfDoc = await pdfjsLib.getDocument({ data, useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
        let textoPreview = '';
        for (let i = 1; i <= Math.min(pdfDoc.numPages, 3); i++) {
          const page = await pdfDoc.getPage(i);
          const content = await page.getTextContent();
          let lineaActual = '';
          let yAnterior: number | null = null;
          for (const item of content.items) {
            const y = item.transform ? item.transform[5] : 0;
            if (yAnterior !== null && Math.abs(y - yAnterior) > 2) {
              textoPreview += lineaActual.trim() + '\n';
              lineaActual = '';
            }
            lineaActual += (item.str || '') + ' ';
            yAnterior = y;
          }
          if (lineaActual.trim()) textoPreview += lineaActual.trim() + '\n';
        }
        
        const textoUpper = textoPreview.toUpperCase();
        const esSantander = textoUpper.includes('SANTANDER') || textoUpper.includes('BANCO SANTANDER');
        const esBanorte = textoUpper.includes('BANORTE') || textoUpper.includes('BANCO MERCANTIL DEL NORTE');
        
        // Buscar número de cuenta en el texto
        // Santander: "CUENTA SANTANDER PYME   65-50908535-6" o "NUMERO DE CUENTA 65-50908535-6"
        // Banorte: "No. de Cuenta: 1282396470"
        let cuentaNumDetectada = '';
        let bancoDetectado = cuenta.banco;
        let tipoCuentaDetectado = cuenta.tipo;
        
        if (esSantander) {
          bancoDetectado = 'SANTANDER';
          // Patrones: "65-50908535-6" o "014180655090853560" (CLABE)
          const matchCuenta = textoPreview.match(/(\d{2}-\d{8}-\d)/);
          if (matchCuenta) cuentaNumDetectada = matchCuenta[1];
          // Detectar si es inversión (INVERSION CRECIENTE)
          if (textoUpper.includes('INVERSION')) tipoCuentaDetectado = 'inversion';
        } else if (esBanorte) {
          bancoDetectado = 'BANORTE';
          const matchCuenta = textoPreview.match(/No\.?\s*de\s*Cuenta:?\s*(\d{6,})/i);
          if (matchCuenta) cuentaNumDetectada = matchCuenta[1];
          if (textoUpper.includes('INVERSION')) tipoCuentaDetectado = 'inversion';
        }
        
        // Si el banco detectado no coincide con la cuenta seleccionada, buscar/crear cuenta correcta
        if (bancoDetectado && cuentaNumDetectada && 
            (cuenta.banco.toUpperCase() !== bancoDetectado || 
             !cuenta.cuenta.includes(cuentaNumDetectada))) {
          
          // Buscar cuenta existente con ese número
          let cuentaCorrecta = await db.cuentaBancaria.findFirst({
            where: { 
              empresaId: cuenta.empresaId,
              cuenta: { contains: cuentaNumDetectada },
            },
          });
          
          if (!cuentaCorrecta) {
            // Crear la cuenta automáticamente
            cuentaCorrecta = await db.cuentaBancaria.create({
              data: {
                banco: bancoDetectado,
                cuenta: cuentaNumDetectada,
                saldo: 0,
                tipo: tipoCuentaDetectado,
                empresaId: cuenta.empresaId,
              },
            });
            console.log(`✅ Cuenta creada automáticamente: ${bancoDetectado} ${cuentaNumDetectada}`);
          }
          
          // Actualizar cuentaId para usar la cuenta correcta
          if (cuentaCorrecta.id !== cuentaId) {
            console.log(`🔄 Cuenta cambiada de ${cuenta.banco} ${cuenta.cuenta} → ${cuentaCorrecta.banco} ${cuentaCorrecta.cuenta}`);
            // Reemplazar en los siguientes pasos usando la nueva cuenta
            // (re-asignamos la variable cuenta para que el resto del flujo use la correcta)
            (cuenta as any).id = cuentaCorrecta.id;
            (cuenta as any).banco = cuentaCorrecta.banco;
            (cuenta as any).cuenta = cuentaCorrecta.cuenta;
            (cuenta as any).tipo = cuentaCorrecta.tipo;
            (cuenta as any).empresaId = cuentaCorrecta.empresaId;
            // Reasignar cuentaId
            (formData as any).cuentaId = cuentaCorrecta.id;
            // El código abajo usa cuentaId variable, así que necesitamos actualizarla
            // Pero como es const, usamos una variable mutable
          }
        }
      } catch (e) {
        console.error('Error en auto-detección de banco:', e);
        // Si falla, continuar con la cuenta original
      }
    }

    // Re-leer cuentaId por si cambió por auto-detección
    let cuentaIdFinal: string = (formData as any).cuentaId || cuentaId;

    // Parsear según formato
    let movimientos: MovimientoImportado[] = [];
    let formatoDetectado = 'desconocido';

    if (ext === 'csv') {
      formatoDetectado = 'CSV';
      const text = buffer.toString('utf-8');
      movimientos = parseCSV(text);
    } else if (ext === 'xlsx' || ext === 'xls') {
      formatoDetectado = 'Excel';
      try {
        movimientos = await parseExcel(buffer);
      } catch (e: any) {
        return NextResponse.json({
          error: `Error leyendo Excel: ${e.message}. Verifica que sea un .xlsx válido.`,
        }, { status: 400 });
      }
    } else if (ext === 'pdf') {
      formatoDetectado = 'PDF';
      // Extraer texto del PDF usando pdfjs-dist legacy con polyfills para Vercel serverless
      try {
        // Polyfill de DOMMatrix para Vercel serverless (pdfjs-dist lo necesita)
        if (typeof (globalThis as any).DOMMatrix === 'undefined') {
          (globalThis as any).DOMMatrix = class DOMMatrix {
            private _a: number; private _b: number; private _c: number; private _d: number;
            private _e: number; private _f: number;
            constructor(init?: any) {
              if (Array.isArray(init)) {
                this._a = init[0] || 1; this._b = init[1] || 0;
                this._c = init[2] || 0; this._d = init[3] || 1;
                this._e = init[4] || 0; this._f = init[5] || 0;
              } else {
                this._a = 1; this._b = 0; this._c = 0; this._d = 1; this._e = 0; this._f = 0;
              }
            }
            get a() { return this._a; }
            get b() { return this._b; }
            get c() { return this._c; }
            get d() { return this._d; }
            get e() { return this._e; }
            get f() { return this._f; }
            multiply(other: any) { return this; }
            translate(x: number, y: number) { return this; }
            scale(s: number) { return this; }
          };
        }

        // Polyfill de Path2D
        if (typeof (globalThis as any).Path2D === 'undefined') {
          (globalThis as any).Path2D = class Path2D {
            constructor() {}
            moveTo() {} lineTo() {} closePath() {} arc() {} rect() {} ellipse() {}
          };
        }

        const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.js');
        const data = new Uint8Array(buffer);
        const loadingTask = pdfjsLib.getDocument({
          data,
          useSystemFonts: true,
          disableFontFace: true,
          isEvalSupported: false,
        });
        const pdfDoc = await loadingTask.promise;

        let textoPDF = '';
        for (let i = 1; i <= pdfDoc.numPages; i++) {
          const page = await pdfDoc.getPage(i);
          const content = await page.getTextContent();
          // Unir items de texto en líneas basándose en coordenada Y
          let lineaActual = '';
          let yAnterior: number | null = null;
          for (const item of content.items) {
            const y = item.transform ? item.transform[5] : 0;
            if (yAnterior !== null && Math.abs(y - yAnterior) > 2) {
              textoPDF += lineaActual.trim() + '\n';
              lineaActual = '';
            }
            lineaActual += (item.str || '') + ' ';
            yAnterior = y;
          }
          if (lineaActual.trim()) textoPDF += lineaActual.trim() + '\n';
        }

        if (!textoPDF || textoPDF.trim().length < 20) {
          return NextResponse.json({
            success: true,
            fileName,
            fileSize: file.size,
            formato: formatoDetectado,
            movimientosCreados: 0,
            movimientosTotales: 0,
            message: `📄 PDF guardado pero no se pudo extraer texto. Usa Excel/CSV.`,
          });
        }

        // Parsear movimientos desde el texto extraído (con detección multi-cuenta)
        const { movimientos: movsPDF, seccionesDetectadas } = parsePDFTextoMultiCuenta(textoPDF);
        movimientos = movsPDF;

        // ===== PROCESAR MÚLTIPLES SECCIONES =====
        // Cada sección tiene su propio tipo y número de cuenta.
        // Vamos a:
        // 1. Para cada sección detectada, buscar/crear la cuenta correspondiente
        // 2. Insertar los movimientos en la cuenta correcta (no solo en la cuentaId original)
        if (seccionesDetectadas.length > 0) {
          console.log(`📊 Secciones detectadas: ${seccionesDetectadas.length}`);
          seccionesDetectadas.forEach(s => {
            console.log(`  - ${s.tipo} (${s.cuentaNumero}): ${s.count} movs`);
          });
          
          // Separar movimientos por sección usando el flag esInversion
          const movsOperaciones = movimientos.filter((m: any) => !m.esInversion);
          const movsInversion = movimientos.filter((m: any) => (m as any).esInversion);
          
          // Quitar el flag esInversion
          for (const m of movsOperaciones) { delete (m as any).esInversion; }
          for (const m of movsInversion) { delete (m as any).esInversion; }
          
          // Buscar la sección de operaciones para saber el número de cuenta
          const secOperaciones = seccionesDetectadas.find(s => s.tipo === 'operaciones');
          const secInversion = seccionesDetectadas.find(s => s.tipo === 'inversion');
          
          // Determinar el banco desde las secciones
          let bancoDetectado = cuenta.banco;
          if (secOperaciones?.cuentaNumero.match(/^\d{2}-\d{8}-\d$/)) {
            bancoDetectado = 'SANTANDER';
          } else if (secOperaciones?.cuentaNumero.match(/^\d{10}$/)) {
            bancoDetectado = 'BANORTE';
          }
          
          // ===== CUENTA DE OPERACIONES =====
          // Si la cuenta seleccionada no coincide con la detectada, buscar/crear la correcta
          let cuentaOperacionesId = cuentaIdFinal;
          if (secOperaciones?.cuentaNumero && 
              !cuenta.cuenta.includes(secOperaciones.cuentaNumero)) {
            let cuentaOp = await db.cuentaBancaria.findFirst({
              where: { 
                empresaId: cuenta.empresaId,
                cuenta: { contains: secOperaciones.cuentaNumero },
              },
            });
            if (!cuentaOp) {
              cuentaOp = await db.cuentaBancaria.create({
                data: {
                  banco: bancoDetectado,
                  cuenta: secOperaciones.cuentaNumero,
                  saldo: 0,
                  tipo: 'operaciones',
                  empresaId: cuenta.empresaId,
                },
              });
              console.log(`✅ Cuenta operaciones creada: ${bancoDetectado} ${secOperaciones.cuentaNumero}`);
            }
            cuentaOperacionesId = cuentaOp.id;
            // Actualizar cuentaIdFinal para que el resto del flujo use esta cuenta
            (formData as any).cuentaId = cuentaOp.id;
            cuentaIdFinal = cuentaOp.id;
          }
          
          // ===== CUENTA DE INVERSIÓN =====
          let cuentaInversionId: string | null = null;
          if (secInversion?.cuentaNumero && movsInversion.length > 0) {
            let cuentaInv = await db.cuentaBancaria.findFirst({
              where: { 
                empresaId: cuenta.empresaId,
                cuenta: { contains: secInversion.cuentaNumero },
              },
            });
            if (!cuentaInv) {
              cuentaInv = await db.cuentaBancaria.create({
                data: {
                  banco: bancoDetectado + ' Inversión',
                  cuenta: secInversion.cuentaNumero,
                  saldo: 0,
                  tipo: 'inversion',
                  empresaId: cuenta.empresaId,
                },
              });
              console.log(`✅ Cuenta inversión creada: ${bancoDetectado} Inversión ${secInversion.cuentaNumero}`);
            }
            cuentaInversionId = cuentaInv.id;
            
            // Insertar movimientos de inversión directamente
            let invCreados = 0;
            let invDuplicados = 0;
            for (const mov of movsInversion) {
              const yearMov = mov.fecha.getFullYear();
              if (yearMov < 2020 || yearMov > new Date().getFullYear() + 1) continue;
              
              const existente = await db.movimientoBanco.findFirst({
                where: {
                  cuentaId: cuentaInversionId,
                  fecha: mov.fecha,
                  concepto: mov.concepto,
                  monto: mov.monto,
                },
              });
              if (existente) { invDuplicados++; continue; }
              
              await db.movimientoBanco.create({
                data: {
                  fecha: mov.fecha,
                  concepto: mov.concepto,
                  monto: mov.monto,
                  tipo: mov.monto > 0 ? 'ingreso' : 'egreso',
                  estado: 'conciliado',
                  cuentaId: cuentaInversionId,
                },
              });
              invCreados++;
            }
            
            // Actualizar saldo de cuenta de inversión
            if (invCreados > 0) {
              const todosInv = await db.movimientoBanco.findMany({
                where: { cuentaId: cuentaInversionId },
                select: { monto: true },
              });
              const saldoInv = todosInv.reduce((s, m) => s + m.monto, 0);
              await db.cuentaBancaria.update({
                where: { id: cuentaInversionId },
                data: { saldo: saldoInv },
              });
            }
            
            console.log(`📊 Inversión: ${movsInversion.length} movs (${invCreados} nuevos, ${invDuplicados} duplicados)`);
          }
          
          // Mantener solo los movimientos de operaciones para el flujo principal
          movimientos = movsOperaciones;
          
          console.log(`📊 Operaciones: ${movsOperaciones.length} movs para cuenta ${cuentaOperacionesId}`);
        }

        if (movimientos.length === 0 && seccionesDetectadas.length === 0) {
          return NextResponse.json({
            success: true,
            fileName,
            fileSize: file.size,
            formato: formatoDetectado,
            textoExtraido: textoPDF.slice(0, 500) + '...',
            movimientosCreados: 0,
            movimientosTotales: 0,
            message: `📄 PDF procesado (${textoPDF.length} chars) pero no se detectaron movimientos. Intenta con Excel/CSV.`,
          });
        }
      } catch (pdfError: any) {
        console.error('Error procesando PDF:', pdfError);
        return NextResponse.json({
          success: true,
          fileName,
          fileSize: file.size,
          formato: formatoDetectado,
          movimientosCreados: 0,
          movimientosTotales: 0,
          message: `📄 PDF guardado. Error: ${pdfError.message}. Usa Excel/CSV.`,
        });
      }
    } else {
      return NextResponse.json({
        error: `Formato .${ext} no soportado. Usa .xlsx, .csv o .pdf`,
      }, { status: 400 });
    }

    // Insertar movimientos (dedupe por fecha+concepto+monto)
    // IMPORTANTE: Procesa TODOS los movimientos del archivo, no solo del mes seleccionado.
    // Esto permite subir un Excel con varios meses (ej. ene-jun) y se importan todos.
    let movimientosCreados = 0;
    let movimientosDuplicados = 0;
    let movimientosFueraRango = 0;
    const mesesAfectados = new Set<string>();

    // ===== MOVIMIENTO DE APERTURA =====
    // Si es un PDF (con secciones detectadas) y la cuenta está vacía,
    // agregar el saldo inicial como movimiento de apertura para que el saldo de la cuenta
    // cuadre con el saldo final del PDF del último mes
    if (ext === 'pdf' && seccionesDetectadas.length > 0) {
      const secOp = seccionesDetectadas.find(s => s.tipo === 'operaciones');
      if (secOp && secOp.saldoInicial !== null && secOp.saldoInicial > 0) {
        // Verificar que la cuenta destino esté vacía
        const movsExistentes = await db.movimientoBanco.count({ where: { cuentaId: cuentaIdFinal } });
        if (movsExistentes === 0) {
          // Crear movimiento de apertura con el saldo inicial
          const fechaApertura = new Date(anio, mes - 1, 1, 12, 0, 0);
          await db.movimientoBanco.create({
            data: {
              fecha: fechaApertura,
              concepto: 'SALDO INICIAL DE APERTURA (saldo final del periodo anterior según PDF)',
              monto: secOp.saldoInicial,
              tipo: 'ingreso',
              estado: 'conciliado',
              cuentaId: cuentaIdFinal,
            },
          });
          movimientosCreados++;
          console.log(`💰 Movimiento de apertura creado: $${secOp.saldoInicial}`);
        }
      }
    }

    for (const mov of movimientos) {
      // Si la fecha es inválida o muy antigua/futura, saltar
      const yearMov = mov.fecha.getFullYear();
      if (yearMov < 2020 || yearMov > new Date().getFullYear() + 1) {
        movimientosFueraRango++;
        continue;
      }

      mesesAfectados.add(`${mov.fecha.getFullYear()}-${String(mov.fecha.getMonth() + 1).padStart(2, '0')}`);

      // Dedupe (usar cuentaIdFinal por si cambió por auto-detección)
      const existente = await db.movimientoBanco.findFirst({
        where: {
          cuentaId: cuentaIdFinal,
          fecha: mov.fecha,
          concepto: mov.concepto,
          monto: mov.monto,
        },
      });
      if (existente) {
        movimientosDuplicados++;
        continue;
      }

      await db.movimientoBanco.create({
        data: {
          fecha: mov.fecha,
          concepto: mov.concepto,
          monto: mov.monto,
          tipo: mov.monto > 0 ? 'ingreso' : 'egreso',
          estado: 'conciliado',
          cuentaId: cuentaIdFinal,
        },
      });
      movimientosCreados++;
    }

    // Calcular totales del mes seleccionado
    const inicioMes = new Date(anio, mes - 1, 1);
    const finMes = new Date(anio, mes, 0, 23, 59, 59);
    const movimientosMes = await db.movimientoBanco.findMany({
      where: { cuentaId: cuentaIdFinal, fecha: { gte: inicioMes, lte: finMes } },
    });
    const saldoCalculado = movimientosMes.reduce((s, m) => s + m.monto, 0);

    // Total de TODOS los movimientos de la cuenta (todos los meses)
    const totalCuenta = await db.movimientoBanco.count({ where: { cuentaId: cuentaIdFinal } });

    // Actualizar el saldo de la cuenta con la suma de TODOS los movimientos
    const todosMovimientos = await db.movimientoBanco.findMany({
      where: { cuentaId: cuentaIdFinal },
      select: { monto: true },
    });
    const saldoTotalCalculado = todosMovimientos.reduce((s, m) => s + m.monto, 0);

    // Actualizar el saldo en la cuenta bancaria
    await db.cuentaBancaria.update({
      where: { id: cuentaIdFinal },
      data: { saldo: saldoTotalCalculado },
    });

    const mesesArray = Array.from(mesesAfectados).sort();
    const messageMonths = mesesArray.length > 1
      ? ` Meses afectados: ${mesesArray.join(', ')}.`
      : '';

    return NextResponse.json({
      success: true,
      fileName,
      fileSize: file.size,
      formato: formatoDetectado,
      movimientosDetectados: movimientos.length,
      movimientosCreados,
      movimientosDuplicados,
      movimientosFueraRango,
      movimientosTotales: movimientosMes.length,
      movimientosTotalesCuenta: totalCuenta,
      mesesAfectados: mesesArray,
      saldoDelMes: saldoCalculado,
      cuentaId: cuentaIdFinal,
      cuentaBanco: cuenta.banco,
      cuentaNumero: cuenta.cuenta,
      message: `✅ ${formatoDetectado} procesado: ${movimientosCreados} nuevos, ${movimientosDuplicados} duplicados de ${movimientos.length} detectados.${messageMonths} Total en la cuenta: ${totalCuenta} movimientos.`,
    });
  } catch (e: any) {
    console.error('Error en upload-estado-cuenta:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** GET /api/upload-estado-cuenta — lista estados de cuenta guardados */
export async function GET() {
  const isVercel = !!process.env.VERCEL;
  const uploadBase = isVercel ? '/tmp' : process.cwd();
  const uploadDir = path.join(uploadBase, 'uploads', 'estados-cuenta');
  if (!existsSync(uploadDir)) {
    return NextResponse.json({ archivos: [] });
  }
  const files = await readdir(uploadDir);
  const archivos = files.map(name => {
    const match = name.match(/estado_(.+)_(\d{4})_(\d{2})\.(.+)/);
    return {
      name,
      cuentaId: match?.[1] || '',
      anio: match?.[2] || '',
      mes: match?.[3] || '',
      ext: match?.[4] || '',
    };
  });
  return NextResponse.json({ archivos });
}

/** DELETE /api/upload-estado-cuenta?cuentaId=xxx&mes=7&anio=2026
 *  Elimina TODOS los movimientos de una cuenta en un mes específico.
 *  Útil cuando quieres reemplazar el estado de cuenta por uno nuevo.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const cuentaId = searchParams.get('cuentaId');
    const mes = parseInt(searchParams.get('mes') || '0');
    const anio = parseInt(searchParams.get('anio') || '0');

    if (!cuentaId) {
      return NextResponse.json({ error: 'Falta cuentaId' }, { status: 400 });
    }
    if (!mes || !anio) {
      return NextResponse.json({ error: 'Falta mes o anio' }, { status: 400 });
    }

    const inicio = new Date(anio, mes - 1, 1);
    const fin = new Date(anio, mes, 0, 23, 59, 59);

    const resultado = await db.movimientoBanco.deleteMany({
      where: {
        cuentaId,
        fecha: { gte: inicio, lte: fin },
      },
    });

    // Eliminar también el archivo guardado
    const isVercel = !!process.env.VERCEL;
    const uploadBase = isVercel ? '/tmp' : process.cwd();
    const fileName = `estado_${cuentaId}_${anio}_${String(mes).padStart(2, '0')}`;
    const uploadDir = path.join(uploadBase, 'uploads', 'estados-cuenta');
    if (existsSync(uploadDir)) {
      const { unlink } = await import('fs/promises');
      const archivos = await readdir(uploadDir);
      for (const a of archivos) {
        if (a.startsWith(fileName)) {
          try { await unlink(path.join(uploadDir, a)); } catch {}
        }
      }
    }

    return NextResponse.json({
      success: true,
      eliminados: resultado.count,
      message: `✅ ${resultado.count} movimiento(s) eliminado(s) de la cuenta en ${mes}/${anio}`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
