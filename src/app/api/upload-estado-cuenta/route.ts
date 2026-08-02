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
 * El PDF de Banorte tiene 2 secciones:
 *   1. ENLACE NEGOCIOS AVANZADA (cuenta de operaciones)
 *   2. INVERSION ENLACE NEGOCIOS (cuenta de inversión)
 * 
 * Esta función devuelve los movimientos etiquetados con el tipo de cuenta
 * para que el backend pueda asignarlos correctamente.
 */
function parsePDFTextoMultiCuenta(texto: string): {
  movimientos: MovimientoImportado[];
  seccionesDetectadas: Array<{ tipo: string; cuentaNumero: string; count: number }>;
} {
  const movimientos: MovimientoImportado[] = [];
  const lineas = texto.split(/\r?\n/);

  // Mapeo de meses abreviados en español (formato Banorte: 08-ENE-26)
  const MESES_ES: Record<string, number> = {
    'ENE': 0, 'FEB': 1, 'MAR': 2, 'ABR': 3, 'MAY': 4, 'JUN': 5,
    'JUL': 6, 'AGO': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DIC': 11,
    'ENERO': 0, 'FEBRERO': 1, 'MARZO': 2, 'ABRIL': 3, 'MAYO': 4, 'JUNIO': 5,
    'JULIO': 6, 'AGOSTO': 7, 'SEPTIEMBRE': 8, 'OCTUBRE': 9, 'NOVIEMBRE': 10, 'DICIEMBRE': 11,
  };

  // Patrón de fecha numérica: DD/MM/YYYY o DD-MM-YYYY
  const patronFechaNum = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
  // Patrón de fecha Banorte: DD-ENE-26 (día + mes abreviado + año 2 dígitos)
  const patronFechaBanorte = /(\d{1,2})-([A-Z]{3,9})-(\d{2,4})/;

  // Patrones de palabras clave para identificar depósitos vs retiros
  const keywordsDeposito = ['DISPOSICION', 'RECIBIDO', 'DEPOSITO DE CUENTA', 'DEV. DEPOSITO', 'DEVOLUCION', 'ABONO'];
  const keywordsRetiro = ['COMPRA', 'PAGO', 'RETIRO', 'CARGO', 'TRASPASO', 'COMISION', 'COMISIÓN', 'TRANSFERENCIA', 'I.V.A.', 'INTERESES EXENTO', 'PAGO DE CAPITAL', 'PAGO DE CREDITO', 'PAGO DE LDC', 'ADMINISTRACION', 'COM. DISPERSION', 'IVA COM', 'IVA 00054', 'RETIRO DEP.', 'CGO', 'CARGO CAPITAL', 'CARGO POR', 'CGO INTERESES'];

  // Variable para rastrear el saldo anterior (para determinar depósito vs retiro)
  let saldoAnterior: number | null = null;

  // ===== DETECCIÓN DE SECCIONES DE CUENTA =====
  // El PDF de Banorte tiene headers como:
  //   "ENLACE NEGOCIOS AVANZADA"
  //   "INVERSION ENLACE NEGOCIOS"
  // Y cada sección tiene su propio "No. de Cuenta: 1282396470"
  let seccionActual: 'operaciones' | 'inversion' = 'operaciones';
  const seccionesDetectadas: Array<{ tipo: string; cuentaNumero: string; count: number }> = [];
  let cuentaNumeroActual = '';
  let movsPorSeccion = 0;

  // Procesar línea por línea, agrupando bloques de movimientos
  let i = 0;
  while (i < lineas.length) {
    const linea = lineas[i].trim();
    if (!linea || linea.length < 5) { i++; continue; }

    // ===== DETECTAR CAMBIO DE SECCIÓN =====
    const lineaUpper = linea.toUpperCase();
    if (lineaUpper.includes('INVERSION') || lineaUpper.includes('INVERSIÓN')) {
      // Si ya había una sección activa con movimientos, registrarla
      if (movsPorSeccion > 0) {
        seccionesDetectadas.push({ tipo: seccionActual, cuentaNumero: cuentaNumeroActual, count: movsPorSeccion });
      }
      seccionActual = 'inversion';
      movsPorSeccion = 0;
      // Buscar número de cuenta en las siguientes líneas
      const cuentaMatch = linea.match(/No\.?\s*de\s*Cuenta:?\s*(\d{6,})/i);
      if (cuentaMatch) cuentaNumeroActual = cuentaMatch[1];
      i++;
      continue;
    }
    if (lineaUpper.includes('ENLACE NEGOCIOS AVANZADA') || 
        (lineaUpper.includes('ENLACE NEGOCIOS') && !lineaUpper.includes('INVERSION') && !lineaUpper.includes('INVERSIÓN'))) {
      if (movsPorSeccion > 0) {
        seccionesDetectadas.push({ tipo: seccionActual, cuentaNumero: cuentaNumeroActual, count: movsPorSeccion });
      }
      seccionActual = 'operaciones';
      movsPorSeccion = 0;
      i++;
      continue;
    }
    
    // Buscar "No. de Cuenta: XXXXXXX" en cualquier línea
    const cuentaMatch = linea.match(/No\.?\s*de\s*Cuenta:?\s*(\d{6,})/i);
    if (cuentaMatch) {
      cuentaNumeroActual = cuentaMatch[1];
      i++;
      continue;
    }

    // Intentar parsear fecha de esta línea
    let fecha: Date | null = null;
    let fechaMatch: RegExpMatchArray | null = null;
    let restoLinea = linea;

    // Intentar formato Banorte primero (DD-ENE-26)
    const matchBanorte = linea.match(patronFechaBanorte);
    if (matchBanorte) {
      const dia = parseInt(matchBanorte[1]);
      const mesStr = matchBanorte[2].toUpperCase();
      const mes = MESES_ES[mesStr];
      let anio = parseInt(matchBanorte[3]);
      if (anio < 100) anio = anio < 30 ? 2000 + anio : 1900 + anio;

      if (mes !== undefined && dia >= 1 && dia <= 31) {
        fecha = new Date(anio, mes, dia, 12, 0, 0);
        fechaMatch = matchBanorte;
        restoLinea = linea.substring(matchBanorte.index! + matchBanorte[0].length).trim();
      }
    }

    // Si no es Banorte, intentar formato numérico
    if (!fecha) {
      const matchNum = linea.match(patronFechaNum);
      if (matchNum) {
        const dia = parseInt(matchNum[1]);
        const mes = parseInt(matchNum[2]) - 1;
        let anio = parseInt(matchNum[3]);
        if (anio < 100) anio = anio < 30 ? 2000 + anio : 1900 + anio;

        if (mes >= 0 && mes <= 11 && dia >= 1 && dia <= 31) {
          fecha = new Date(anio, mes, dia, 12, 0, 0);
          fechaMatch = matchNum;
          restoLinea = linea.substring(matchNum.index! + matchNum[0].length).trim();
        }
      }
    }

    if (!fecha || isNaN(fecha.getTime())) { i++; continue; }

    // ===== Acumular descripción y buscar línea de montos =====
    let concepto = restoLinea;
    let montoEncontrado: number | null = null;
    let saldoEncontrado: number | null = null;

    // Buscar montos en la línea actual (puede que fecha y monto estén juntos)
    const montosLineaActual = extraerMontos(linea);
    if (montosLineaActual.length >= 2) {
      montoEncontrado = montosLineaActual[0];
      saldoEncontrado = montosLineaActual[1];
      // Quitar montos del concepto
      concepto = quitarMontos(concepto);
    } else if (montosLineaActual.length === 1 && concepto.length < 30) {
      // Solo un monto y concepto corto — puede ser un movimiento simple
      montoEncontrado = montosLineaActual[0];
      concepto = quitarMontos(concepto);
    }

    // Si no se encontraron montos en la línea actual, buscar en líneas siguientes
    if (montoEncontrado === null) {
      let j = i + 1;
      while (j < lineas.length && j < i + 10) {
        const lineaSiguiente = lineas[j].trim();
        if (!lineaSiguiente) { j++; continue; }

        // Si encontramos otra fecha, ya no hay montos para este movimiento
        if (patronFechaBanorte.test(lineaSiguiente) || patronFechaNum.test(lineaSiguiente)) {
          break;
        }

        const montosSiguiente = extraerMontos(lineaSiguiente);
        if (montosSiguiente.length >= 2) {
          montoEncontrado = montosSiguiente[0];
          saldoEncontrado = montosSiguiente[1];
          break;
        } else if (montosSiguiente.length === 1 && j > i + 1) {
          // Una sola cantidad después de varias líneas de descripción
          montoEncontrado = montosSiguiente[0];
          break;
        }

        // Acumular como parte de la descripción
        concepto += ' ' + lineaSiguiente;
        j++;
      }
    }

    if (montoEncontrado === null || Math.abs(montoEncontrado) < 0.5) { i++; continue; }

    // ===== Determinar si es depósito o retiro =====
    let montoFinal = montoEncontrado;

    // Método 1: PRIMERO comparar con saldo anterior (MÁS CONFIABLE)
    if (saldoEncontrado !== null && saldoAnterior !== null) {
      const diferencia = saldoEncontrado - saldoAnterior;
      // Si la diferencia coincide con el monto (±2%), usar el signo de la diferencia
      if (Math.abs(Math.abs(diferencia) - montoEncontrado) < montoEncontrado * 0.02) {
        montoFinal = diferencia; // Positive = deposit, negative = withdrawal
      } else if (diferencia < 0) {
        // El saldo bajó — es un retiro
        montoFinal = -Math.abs(montoEncontrado);
      } else {
        // El saldo subió — es un depósito
        montoFinal = Math.abs(montoEncontrado);
      }
    } else {
      // Método 2: Si no hay saldo, usar keywords como FALLBACK
      const conceptoUpper = concepto.toUpperCase();
      const esRetiro = keywordsRetiro.some(k => conceptoUpper.includes(k));
      const esDeposito = keywordsDeposito.some(k => conceptoUpper.includes(k));

      if (esRetiro) {
        montoFinal = -Math.abs(montoEncontrado);
      } else if (esDeposito) {
        montoFinal = Math.abs(montoEncontrado);
      }
      // Si no hay keyword, mantener positivo (depósito por defecto)
    }

    // Actualizar saldo anterior
    if (saldoEncontrado !== null) {
      saldoAnterior = saldoEncontrado;
    }

    // Limpiar concepto
    concepto = quitarMontos(concepto).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!concepto) concepto = 'Movimiento bancario';

    // Agregar movimiento con tipo de cuenta detectado
    movimientos.push({
      fecha,
      concepto,
      monto: montoFinal,
      // Campo extra para saber a qué cuenta asignarlo
      // Usamos el campo concepto temporalmente para que el backend lo procese
      ...(seccionActual === 'inversion' ? { esInversion: true } : {}),
    } as any);
    movsPorSeccion++;
    i++;
  }

  // Registrar última sección
  if (movsPorSeccion > 0) {
    seccionesDetectadas.push({ tipo: seccionActual, cuentaNumero: cuentaNumeroActual, count: movsPorSeccion });
  }

  return { movimientos, seccionesDetectadas };
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
    const cuentaIdFinal = (formData as any).cuentaId || cuentaId;

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

        // Si se detectaron múltiples secciones (operaciones + inversión),
        // buscar/crear la cuenta de inversión y asignar los movimientos automáticamente
        if (seccionesDetectadas.length > 1 || seccionesDetectadas.some(s => s.tipo === 'inversion')) {
          const tieneInversion = seccionesDetectadas.some(s => s.tipo === 'inversion');
          if (tieneInversion) {
            // Buscar si ya existe una cuenta de inversión para esta empresa
            let cuentaInversion = await db.cuentaBancaria.findFirst({
              where: { empresaId: cuenta.empresaId, tipo: 'inversion' },
            });
            
            if (!cuentaInversion) {
              // Crear la cuenta de inversión automáticamente
              cuentaInversion = await db.cuentaBancaria.create({
                data: {
                  banco: cuenta.banco + ' Inversión',
                  cuenta: cuenta.cuenta + ' (Inversión)',
                  saldo: 0,
                  tipo: 'inversion',
                  empresaId: cuenta.empresaId,
                },
              });
              console.log(`✅ Cuenta de inversión creada automáticamente: ${cuentaInversion.id}`);
            }
            
            // Reasignar movimientos: los marcados como esInversion van a la cuenta de inversión
            // Procesar movimientos con etiqueta esInversion
            const movsOperaciones = movimientos.filter((m: any) => !m.esInversion);
            const movsInversion = movimientos.filter((m: any) => (m as any).esInversion);
            
            // Quitar la marca esInversion de los objetos (no se guarda en BD)
            for (const m of movsOperaciones) { delete (m as any).esInversion; }
            for (const m of movsInversion) { delete (m as any).esInversion; }
            
            // Insertar movimientos de inversión directamente en la cuenta de inversión
            let movsInvCreados = 0;
            let movsInvDuplicados = 0;
            for (const mov of movsInversion) {
              const yearMov = mov.fecha.getFullYear();
              if (yearMov < 2020 || yearMov > new Date().getFullYear() + 1) continue;
              
              const existente = await db.movimientoBanco.findFirst({
                where: {
                  cuentaId: cuentaInversion.id,
                  fecha: mov.fecha,
                  concepto: mov.concepto,
                  monto: mov.monto,
                },
              });
              if (existente) {
                movsInvDuplicados++;
                continue;
              }
              
              await db.movimientoBanco.create({
                data: {
                  fecha: mov.fecha,
                  concepto: mov.concepto,
                  monto: mov.monto,
                  tipo: mov.monto > 0 ? 'ingreso' : 'egreso',
                  estado: 'conciliado',
                  cuentaId: cuentaInversion.id,
                },
              });
              movsInvCreados++;
            }
            
            // Actualizar saldo de la cuenta de inversión
            if (movsInvCreados > 0) {
              const todosMovsInv = await db.movimientoBanco.findMany({
                where: { cuentaId: cuentaInversion.id },
                select: { monto: true },
              });
              const saldoInv = todosMovsInv.reduce((s, m) => s + m.monto, 0);
              await db.cuentaBancaria.update({
                where: { id: cuentaInversion.id },
                data: { saldo: saldoInv },
              });
            }
            
            // Filtrar movimientos para que solo se inserten los de operaciones en la cuenta original
            movimientos = movsOperaciones;
            
            console.log(`📊 PDF multi-cuenta: ${movsOperaciones.length} operaciones, ${movsInversion.length} inversión (${movsInvCreados} nuevos, ${movsInvDuplicados} duplicados)`);
          }
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
