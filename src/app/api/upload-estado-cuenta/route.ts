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
  cuentaNumero?: string; // Para PDFs o Excel con múltiples cuentas en el mismo archivo
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
    let colCuenta = 0; // Columna "CUENTA" — permite separar movimientos de varias cuentas en un mismo Excel

    for (let c = 1; c <= Math.max(headers.length, 20); c++) {
      const h = headers[c] || '';
      // Match exacto (no "cta ordenante", "cuenta beneficiario", etc., que son de terceros)
      if (h === 'cuenta') colCuenta = c;
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

        // Número de cuenta de esta fila (si el Excel trae columna "CUENTA", ej. exportes
        // de Banorte/Santander con varias cuentas en la misma hoja). Se quita el apóstrofo
        // inicial que algunos sistemas usan para forzar texto (ej. "'1282396470").
        let cuentaNumero: string | undefined = undefined;
        if (colCuenta) {
          const rawCuenta = String(fila.getCell(colCuenta).value || '').trim();
          cuentaNumero = rawCuenta.replace(/^'/, '').trim() || undefined;
        }

        movimientos.push({ fecha, concepto, monto, cuentaNumero });
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
// Soporta PDFs con MÚLTIPLES cuentas (ej: Banorte con ENLACE NEGOCIOS + INVERSION)
function parsePDFTexto(texto: string): MovimientoImportado[] {
  const movimientos: MovimientoImportado[] = [];
  const lineas = texto.split(/\r?\n/);

  const MESES_ES: Record<string, number> = {
    'ENE': 0, 'FEB': 1, 'MAR': 2, 'ABR': 3, 'MAY': 4, 'JUN': 5,
    'JUL': 6, 'AGO': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DIC': 11,
    'ENERO': 0, 'FEBRERO': 1, 'MARZO': 2, 'ABRIL': 3, 'MAYO': 4, 'JUNIO': 5,
    'JULIO': 6, 'AGOSTO': 7, 'SEPTIEMBRE': 8, 'OCTUBRE': 9, 'NOVIEMBRE': 10, 'DICIEMBRE': 11,
  };

  const patronFechaNum = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/;
  const patronFechaBanorte = /(\d{1,2})[-\/\s]([A-ZÁÉÍÓÚ]{3,9})[-\/\s](\d{2,4})/;

  // Keywords expandidos basados en PDF real de Banorte
  const keywordsDeposito = [
    'DISPOSICION', 'RECIBIDO', 'DEPOSITO', 'DEPÓSITO', 'DEV. DEPOSITO',
    'DEVOLUCION', 'DEPOSITO DE CUENTA',
  ];
  const keywordsRetiro = [
    'COMPRA', 'PAGO', 'RETIRO', 'CARGO', 'TRASPASO', 'COMISION', 'COMISIÓN',
    'TRANSFERENCIA', 'I.V.A.', 'IVA ', 'INTERESES EXENTO', 'PAGO DE CAPITAL',
    'PAGO DE CREDITO', 'PAGO DE LDC', 'ADMINISTRACION', 'COM. DISPERSION',
    'IVA COM', 'IVA 00054',
  ];

  // Detectar sección de cuenta actual
  let cuentaActual: string | null = null;
  let saldoAnterior: number | null = null;

  let i = 0;
  while (i < lineas.length) {
    const linea = lineas[i].trim();
    if (!linea || linea.length < 3) { i++; continue; }

    // ===== Detectar cambio de sección de cuenta =====
    const upperLinea = linea.toUpperCase();
    if (upperLinea.includes('ENLACE NEGOCIOS AVANZADA') && !upperLinea.includes('CONTINUACIÓN')) {
      cuentaActual = 'ENLACE_NEGOCIOS_AVANZADA';
      saldoAnterior = null;
      i++;
      continue;
    }
    if (upperLinea.includes('INVERSION ENLACE NEGOCIOS')) {
      cuentaActual = 'INVERSION_ENLACE_NEGOCIOS';
      saldoAnterior = null;
      i++;
      continue;
    }

    // ===== Intentar parsear fecha =====
    let fecha: Date | null = null;
    let restoLinea = linea;

    const matchBanorte = linea.match(patronFechaBanorte);
    if (matchBanorte) {
      const dia = parseInt(matchBanorte[1]);
      const mesStr = matchBanorte[2].toUpperCase();
      const mes = MESES_ES[mesStr];
      let anio = parseInt(matchBanorte[3]);
      if (anio < 100) anio = anio < 30 ? 2000 + anio : 1900 + anio;
      if (mes !== undefined && dia >= 1 && dia <= 31) {
        // Usar mediodía para evitar desfase de zona horaria
        fecha = new Date(anio, mes, dia, 12, 0, 0);
        restoLinea = linea.substring(matchBanorte.index! + matchBanorte[0].length).trim();
      }
    }

    if (!fecha) {
      const matchNum = linea.match(patronFechaNum);
      if (matchNum) {
        const dia = parseInt(matchNum[1]);
        const mes = parseInt(matchNum[2]) - 1;
        let anio = parseInt(matchNum[3]);
        if (anio < 100) anio = anio < 30 ? 2000 + anio : 1900 + anio;
        if (mes >= 0 && mes <= 11 && dia >= 1 && dia <= 31) {
          fecha = new Date(anio, mes, dia, 12, 0, 0);
          restoLinea = linea.substring(matchNum.index! + matchNum[0].length).trim();
        }
      }
    }

    if (!fecha || isNaN(fecha.getTime())) { i++; continue; }

    // ===== SKIP: SALDO ANTERIOR — no es un movimiento real =====
    if (restoLinea.toUpperCase().includes('SALDO ANTERIOR')) {
      // Pero extraer el saldo para usarlo como referencia
      const montosSaldo = extraerMontos(linea);
      if (montosSaldo.length > 0) {
        saldoAnterior = montosSaldo[0];
      }
      i++;
      continue;
    }

    // ===== Acumular descripción y buscar montos =====
    let concepto = restoLinea;
    let montoEncontrado: number | null = null;
    let saldoEncontrado: number | null = null;

    const montosLineaActual = extraerMontos(linea);
    if (montosLineaActual.length >= 2) {
      montoEncontrado = montosLineaActual[0];
      saldoEncontrado = montosLineaActual[1];
      concepto = quitarMontos(concepto);
    } else if (montosLineaActual.length === 1 && concepto.length < 30) {
      montoEncontrado = montosLineaActual[0];
      concepto = quitarMontos(concepto);
    }

    // Buscar montos en líneas siguientes
    if (montoEncontrado === null) {
      let j = i + 1;
      while (j < lineas.length && j < i + 12) {
        const lineaSig = lineas[j].trim();
        if (!lineaSig) { j++; continue; }

        // Si encontramos otra fecha o sección, parar
        if (patronFechaBanorte.test(lineaSig) || patronFechaNum.test(lineaSig) ||
            lineaSig.toUpperCase().includes('INVERSION ENLACE') ||
            lineaSig.toUpperCase().includes('ENLACE NEGOCIOS AVANZADA')) {
          break;
        }

        const montosSig = extraerMontos(lineaSig);
        if (montosSig.length >= 2) {
          montoEncontrado = montosSig[0];
          saldoEncontrado = montosSig[1];
          break;
        } else if (montosSig.length === 1 && j > i + 1) {
          montoEncontrado = montosSig[0];
          break;
        }

        concepto += ' ' + lineaSig;
        j++;
      }
    }

    if (montoEncontrado === null || Math.abs(montoEncontrado) < 0.5) { i++; continue; }

    // ===== Determinar signo (depósito +/retiro -) =====
    let montoFinal = montoEncontrado;
    const conceptoUpper = concepto.toUpperCase();

    // 1. Verificar keywords de retiro PRIMERO (más específicos)
    const esRetiro = keywordsRetiro.some(k => conceptoUpper.includes(k));
    const esDeposito = keywordsDeposito.some(k => conceptoUpper.includes(k));

    if (esRetiro) {
      montoFinal = -Math.abs(montoEncontrado);
    } else if (esDeposito) {
      montoFinal = Math.abs(montoEncontrado);
    } else {
      // 2. Si no hay keyword claro, usar comparación de saldo
      if (saldoEncontrado !== null && saldoAnterior !== null) {
        const diferencia = saldoEncontrado - saldoAnterior;
        if (Math.abs(Math.abs(diferencia) - montoEncontrado) < montoEncontrado * 0.02) {
          montoFinal = diferencia;
        } else if (diferencia < 0) {
          montoFinal = -Math.abs(montoEncontrado);
        }
      }
    }

    // Actualizar saldo anterior
    if (saldoEncontrado !== null) {
      saldoAnterior = saldoEncontrado;
    }

    // Limpiar concepto
    concepto = quitarMontos(concepto).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!concepto) concepto = 'Movimiento bancario';

    movimientos.push({ fecha, concepto, monto: montoFinal, cuentaNumero: cuentaActual || undefined });
    i++;
  }

  return movimientos;
}

// Extrae montos numéricos de una línea
// Formatos soportados: 80,000.00, $1,234.56, -500.00, 1,500 (sin decimales), $5,000
function extraerMontos(linea: string): number[] {
  const montos: number[] = [];
  // Primero intentar con decimales (formato estándar): 80,000.00 o $1,234.56
  const regexDecimal = /-?\$?\s?[\d,]+\.\d{2}/g;
  let match;
  while ((match = regexDecimal.exec(linea)) !== null) {
    const valor = parseFloat(match[0].replace(/[$,\s]/g, ''));
    if (!isNaN(valor) && Math.abs(valor) > 0.5) {
      montos.push(valor);
    }
  }
  // Si no encontró montos con decimales, buscar montos con separador de miles sin decimales
  // Formato: 1,500 o $5,000 (mínimo 4 dígitos con coma para evitar falsos positivos)
  if (montos.length === 0) {
    const regexSinDecimal = /-?\$?\s?[\d]{1,3}(,\d{3})+/g;
    while ((match = regexSinDecimal.exec(linea)) !== null) {
      const valor = parseFloat(match[0].replace(/[$,\s]/g, ''));
      if (!isNaN(valor) && Math.abs(valor) > 0.5) {
        montos.push(valor);
      }
    }
  }
  return montos;
}

// Quita los montos de un texto para dejar solo la descripción
function quitarMontos(texto: string): string {
  return texto
    .replace(/-?\$?\s?[\d,]+\.\d{2}/g, '')
    .replace(/-?\$?\s?[\d]{1,3}(,\d{3})+/g, '')
    .trim();
}

/**
 * Detecta automáticamente el banco y número de cuenta del texto del archivo.
 * Busca patrones comunes en estados de cuenta mexicanos:
 *   - Nombre del banco (BANORTE, BBVA, SANTANDER, etc.)
 *   - Número de cuenta (10-16 dígitos)
 *   - CLABE interbancaria (18 dígitos)
 *   - Columna "CUENTA" en Excel
 */
function detectarBancoYcuenta(texto: string, fileName: string): { banco: string | null; cuenta: string | null } {
  const upper = texto.toUpperCase();
  let banco: string | null = null;
  let cuenta: string | null = null;

  // ===== Detectar banco por nombre =====
  const bancos = [
    { nombre: 'BANORTE', pattern: /BANORTE|BANORTE\-IEX|ENLACE\s+NEGOCIOS/i },
    { nombre: 'BBVA', pattern: /BBVA|BANCOMER/i },
    { nombre: 'SANTANDER', pattern: /SANTANDER/i },
    { nombre: 'BANAMEX', pattern: /BANAMEX|CITIBANK/i },
    { nombre: 'HSBC', pattern: /HSBC/i },
    { nombre: 'SCOTIABANK', pattern: /SCOTIABANK|SCOTIA/i },
    { nombre: 'AZTECA', pattern: /BANCO\s+AZTECA/i },
    { nombre: 'INBURSA', pattern: /INBURSA/i },
    { nombre: 'MIFEL', pattern: /MIFEL/i },
    { nombre: 'VEPOR.MAS', pattern: /VE\s*POR\s*MAS|VEPORMAS/i },
  ];

  for (const b of bancos) {
    if (b.pattern.test(texto)) {
      banco = b.nombre;
      break;
    }
  }

  // Si no se encontró en el texto, intentar del nombre del archivo
  if (!banco) {
    for (const b of bancos) {
      if (fileName.toUpperCase().includes(b.nombre)) {
        banco = b.nombre;
        break;
      }
    }
  }

  // ===== Detectar número de cuenta =====

  // Buscar "No. de Cuenta" o "CUENTA:" seguido de números (formato PDF Banorte)
  const patronCuenta = /(?:NO\.?\s*DE\s*CUENTA|CUENTA)[:\s]+(\d{8,18})/i;
  const matchCuenta = texto.match(patronCuenta);
  if (matchCuenta) {
    cuenta = matchCuenta[1];
  }

  // Buscar CLABE interbancaria (18 dígitos, empieza con 072 para Banorte)
  if (!cuenta) {
    const patronCLABE = /CLABE[:\s]+(\d{18})/i;
    const matchCLABE = texto.match(patronCLABE);
    if (matchCLABE) {
      cuenta = matchCLABE[1];
    }
  }

  // Buscar número de cuenta en columna de Excel (formato Banorte: "1282396470")
  if (!cuenta) {
    // Buscar secuencias de 10-16 dígitos que parezcan número de cuenta
    const patronNum = /\b(\d{10,16})\b/g;
    let match;
    while ((match = patronNum.exec(texto)) !== null) {
      // Filtrar números que parezcan RFC (12-13 chars alfanuméricos) o fechas
      const num = match[1];
      if (num.length >= 10 && num.length <= 16 && !num.startsWith('2024') && !num.startsWith('2025') && !num.startsWith('2026')) {
        cuenta = num;
        break;
      }
    }
  }

  // Si no se encontró, usar el nombre del archivo
  if (!cuenta) {
    const nameWithoutExt = fileName.replace(/\.[^.]+$/, '').replace(/[^0-9]/g, '');
    if (nameWithoutExt.length >= 4) {
      cuenta = nameWithoutExt;
    }
  }

  return { banco, cuenta };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    let cuentaId = formData.get('cuentaId') as string;
    const cuentaId_original = cuentaId;
    const mes = parseInt(formData.get('mes') as string) || new Date().getMonth() + 1;
    const anio = parseInt(formData.get('anio') as string) || new Date().getFullYear();
    const empresaId = formData.get('empresaId') as string;
    // Banco y cuenta manuales (opcionales — si vienen, se usan para crear la cuenta)
    const bancoManual = formData.get('banco') as string;
    const cuentaManual = formData.get('cuenta') as string;

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
    }

    // ===== Leer el archivo para detectar banco y cuenta =====
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Extraer texto crudo del archivo para detección
    let textoDeteccion = '';
    if (ext === 'xlsx' || ext === 'xls') {
      try {
        const ExcelJS = (await import('exceljs')).default;
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        for (const ws of wb.worksheets) {
          for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
            const fila = ws.getRow(r);
            fila.eachCell((cell) => {
              textoDeteccion += String(cell.value || '') + ' ';
            });
            textoDeteccion += '\n';
          }
        }
      } catch {}
    } else if (ext === 'csv') {
      textoDeteccion = buffer.toString('utf-8').split('\n').slice(0, 15).join('\n');
    } else if (ext === 'pdf') {
      // Para PDF, extraer primeras 2 páginas
      try {
        if (typeof (globalThis as any).DOMMatrix === 'undefined') {
          (globalThis as any).DOMMatrix = class { constructor() {} get a() { return 1; } get b() { return 0; } get c() { return 0; } get d() { return 1; } get e() { return 0; } get f() { return 0; } multiply() { return this; } translate() { return this; } scale() { return this; } };
        }
        if (typeof (globalThis as any).Path2D === 'undefined') {
          (globalThis as any).Path2D = class { constructor() {} moveTo() {} lineTo() {} closePath() {} arc() {} rect() {} ellipse() {} };
        }
        const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.js');
        const data = new Uint8Array(buffer);
        const loadingTask = pdfjsLib.getDocument({ data, useSystemFonts: true, disableFontFace: true, isEvalSupported: false });
        const pdfDoc = await loadingTask.promise;
        for (let i = 1; i <= Math.min(2, pdfDoc.numPages); i++) {
          const page = await pdfDoc.getPage(i);
          const content = await page.getTextContent();
          let lineaActual = '';
          let yAnterior: number | null = null;
          for (const item of content.items) {
            const y = item.transform ? item.transform[5] : 0;
            if (yAnterior !== null && Math.abs(y - yAnterior) > 2) {
              textoDeteccion += lineaActual.trim() + '\n';
              lineaActual = '';
            }
            lineaActual += (item.str || '') + ' ';
            yAnterior = y;
          }
          if (lineaActual.trim()) textoDeteccion += lineaActual.trim() + '\n';
        }
      } catch {}
    }

    // ===== Auto-detectar banco y número de cuenta =====
    const deteccion = detectarBancoYcuenta(textoDeteccion, file.name);

    // Prioridad: manual > detectado
    const bancoFinal = bancoManual || deteccion.banco || 'Banco';
    const cuentaFinal = cuentaManual || deteccion.cuenta || file.name.replace(/\.[^.]+$/, '');

    // ===== Buscar o crear la cuenta bancaria =====
    let cuenta: any = null;

    if (cuentaId) {
      // Se especificó una cuenta existente
      cuenta = await db.cuentaBancaria.findUnique({ where: { id: cuentaId } });
    }

    if (!cuenta && empresaId) {
      // Buscar por número de cuenta
      cuenta = await db.cuentaBancaria.findFirst({
        where: { cuenta: cuentaFinal, empresaId },
      });
    }

    if (!cuenta && empresaId) {
      // Auto-crear la cuenta bancaria
      cuenta = await db.cuentaBancaria.create({
        data: {
          banco: bancoFinal,
          cuenta: cuentaFinal,
          saldo: 0,
          tipo: 'operaciones',
          empresaId,
        },
      });
    }

    if (!cuenta) {
      return NextResponse.json({
        error: 'No se pudo determinar la cuenta bancaria. Especifica banco y número de cuenta.',
        deteccion,
      }, { status: 400 });
    }

    cuentaId = cuenta.id;

    // Guardar el archivo
    const isVercel = !!process.env.VERCEL;
    const uploadBase = isVercel ? '/tmp' : process.cwd();
    const uploadDir = path.join(uploadBase, 'uploads', 'estados-cuenta');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const fileName = `estado_${cuentaId}_${anio}_${String(mes).padStart(2, '0')}.${ext}`;
    const filePath = path.join(uploadDir, fileName);
    await writeFile(filePath, buffer);

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

        // Parsear movimientos desde el texto extraído
        movimientos = parsePDFTexto(textoPDF);

        if (movimientos.length === 0) {
          // Diagnóstico: mostrar líneas donde sí se encontró algún patrón de fecha
          const lineasConFecha = textoPDF.split('\n')
            .filter(l => /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/.test(l) || /(\d{1,2})[-\/\s]([A-ZÁÉÍÓÚ]{3,9})[-\/\s](\d{2,4})/.test(l))
            .slice(0, 15);

          return NextResponse.json({
            success: true,
            fileName,
            fileSize: file.size,
            formato: formatoDetectado,
            textoExtraido: textoPDF.slice(0, 1500),
            lineasConFechaDetectada: lineasConFecha,
            movimientosCreados: 0,
            movimientosTotales: 0,
            message: `📄 PDF procesado (${textoPDF.length} chars) pero no se detectaron movimientos con formato de fecha + monto. ${lineasConFecha.length} líneas tenían fechas reconocibles. Revisa el textoExtraido para diagnosticar.`,
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
    // Para PDFs con múltiples cuentas, cada movimiento se asigna a su cuenta correspondiente.
    let movimientosCreados = 0;
    let movimientosDuplicados = 0;
    let movimientosFueraRango = 0;
    const mesesAfectados = new Set<string>();
    // Mapa de cuentas por sección (para PDFs con múltiples cuentas)
    const cuentasPorSeccion: Record<string, string> = {};

    // Si ya tenemos una cuentaId y todos los movimientos son de la misma sección, usar esa
    const seccionesUnicas = new Set(movimientos.map(m => m.cuentaNumero).filter(Boolean));

    for (const mov of movimientos) {
      // Si la fecha es inválida o muy antigua/futura, saltar
      const yearMov = mov.fecha.getFullYear();
      if (yearMov < 2020 || yearMov > new Date().getFullYear() + 1) {
        movimientosFueraRango++;
        continue;
      }

      // Determinar a qué cuenta pertenece este movimiento
      let cuentaIdMov = cuentaId;

      if (mov.cuentaNumero && seccionesUnicas.size > 1) {
        // PDF con múltiples cuentas — buscar o crear cuenta para esta sección
        if (!cuentasPorSeccion[mov.cuentaNumero]) {
          // Mapear nombre de sección a número de cuenta
          let nombreCuentaSec = cuentaFinal;
          let bancoSec = bancoFinal;
          if (mov.cuentaNumero === 'INVERSION_ENLACE_NEGOCIOS') {
            // Caso especial del parser de PDF (Banorte: sección "Inversión Enlace Negocios")
            nombreCuentaSec = cuentaFinal + ' (Inversión)';
            bancoSec = bancoFinal + ' Inversión';
          } else if (mov.cuentaNumero && mov.cuentaNumero !== cuentaFinal) {
            // Excel con columna "CUENTA": si el número de esta fila es distinto al de la
            // cuenta seleccionada en el formulario, es una cuenta bancaria real distinta
            // (ej. SALDO_BANORTE.xlsx con 1282396470 y 1282397637 en la misma hoja) —
            // se usa el propio número de cuenta como identificador, en vez de mezclarla
            // con la cuenta seleccionada.
            nombreCuentaSec = mov.cuentaNumero;
          }

          // Buscar cuenta existente por nombre
          let cuentaSec = await db.cuentaBancaria.findFirst({
            where: { cuenta: nombreCuentaSec, empresaId: empresaId || '' },
          });

          if (!cuentaSec && empresaId) {
            cuentaSec = await db.cuentaBancaria.create({
              data: {
                banco: bancoSec,
                cuenta: nombreCuentaSec,
                saldo: 0,
                tipo: 'inversion',
                empresaId,
              },
            });
          }

          if (cuentaSec) {
            cuentasPorSeccion[mov.cuentaNumero] = cuentaSec.id;
          }
        }
        cuentaIdMov = cuentasPorSeccion[mov.cuentaNumero] || cuentaId;
      }

      mesesAfectados.add(`${mov.fecha.getFullYear()}-${String(mov.fecha.getMonth() + 1).padStart(2, '0')}`);

      // Dedupe
      const existente = await db.movimientoBanco.findFirst({
        where: {
          cuentaId: cuentaIdMov,
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
          cuentaId: cuentaIdMov,
        },
      });
      movimientosCreados++;
    }

    // Calcular totales del mes seleccionado
    const inicioMes = new Date(anio, mes - 1, 1);
    const finMes = new Date(anio, mes, 0, 23, 59, 59);
    const movimientosMes = await db.movimientoBanco.findMany({
      where: { cuentaId, fecha: { gte: inicioMes, lte: finMes } },
    });
    const saldoCalculado = movimientosMes.reduce((s, m) => s + m.monto, 0);

    // Total de TODOS los movimientos de la cuenta (todos los meses)
    const totalCuenta = await db.movimientoBanco.count({ where: { cuentaId } });

    // Actualizar el saldo de la cuenta con la suma de TODOS los movimientos
    const todosMovimientos = await db.movimientoBanco.findMany({
      where: { cuentaId },
      select: { monto: true },
    });
    const saldoTotalCalculado = todosMovimientos.reduce((s, m) => s + m.monto, 0);

    // Actualizar el saldo en la cuenta bancaria
    await db.cuentaBancaria.update({
      where: { id: cuentaId },
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
      bancoDetectado: cuenta.banco,
      cuentaDetectada: cuenta.cuenta,
      cuentaCreada: !cuentaId_original || cuentaId_original !== cuenta.id,
      message: `✅ ${formatoDetectado} procesado: ${movimientosCreados} nuevos, ${movimientosDuplicados} duplicados de ${movimientos.length} detectados.${messageMonths} Banco: ${cuenta.banco} | Cuenta: ${cuenta.cuenta} | Total: ${totalCuenta} movimientos.`,
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
