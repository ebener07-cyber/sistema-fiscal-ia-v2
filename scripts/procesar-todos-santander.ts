/**
 * Borrar TODOS los movimientos de Santander y procesar los 6 PDFs (Enero-Junio)
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

// Polyfills
(globalThis as any).DOMMatrix = class DOMMatrix {
  private _a = 1; private _b = 0; private _c = 0; private _d = 1; private _e = 0; private _f = 0;
  constructor(init?: any) {
    if (Array.isArray(init)) {
      this._a = init[0] || 1; this._b = init[1] || 0;
      this._c = init[2] || 0; this._d = init[3] || 1;
      this._e = init[4] || 0; this._f = init[5] || 0;
    }
  }
  multiply() { return this; } translate() { return this; } scale() { return this; }
};
(globalThis as any).Path2D = class Path2D {
  constructor() {} moveTo() {} lineTo() {} closePath() {} arc() {} rect() {} ellipse() {}
};

const MESES_ES: Record<string, number> = {
  'ENE': 0, 'FEB': 1, 'MAR': 2, 'ABR': 3, 'MAY': 4, 'JUN': 5,
  'JUL': 6, 'AGO': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DIC': 11,
  'ENERO': 0, 'FEBRERO': 1, 'MARZO': 2, 'ABRIL': 3, 'MAYO': 4, 'JUNIO': 5,
  'JULIO': 6, 'AGOSTO': 7, 'SEPTIEMBRE': 8, 'OCTUBRE': 9, 'NOVIEMBRE': 10, 'DICIEMBRE': 11,
};

function extraerMontosLinea(linea: string): number[] {
  const montos: number[] = [];
  const regex = /(?:^|\s)(\d{1,3}(?:,\d{3})*\.\d{2})(?:\s|$)/g;
  let match;
  while ((match = regex.exec(linea)) !== null) {
    const valor = parseFloat(match[1].replace(/,/g, ''));
    if (!isNaN(valor) && valor > 0.5) montos.push(valor);
  }
  return montos;
}

// Versión inclusiva: incluye 0.00 (para detectar saldo cero)
function extraerMontosLineaInclusivo(linea: string): number[] {
  const montos: number[] = [];
  const regex = /(?:^|\s)(\d{1,3}(?:,\d{3})*\.\d{2})(?:\s|$)/g;
  let match;
  while ((match = regex.exec(linea)) !== null) {
    const valor = parseFloat(match[1].replace(/,/g, ''));
    if (!isNaN(valor)) montos.push(valor);
  }
  return montos;
}

function quitarMontos(texto: string): string {
  return texto.replace(/(?:^|\s)\d{1,3}(?:,\d{3})*\.\d{2}(?:\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
}

interface Movimiento { fecha: Date; concepto: string; monto: number; saldo: number | null; esInversion: boolean; }
interface Seccion { tipo: 'operaciones' | 'inversion'; cuentaNum: string; lineaInicio: number; lineaFin: number | null; saldoInicial: number | null; }

function parsearPDF(textoPDF: string): { movimientos: Movimiento[]; secciones: Array<Seccion & { count: number }> } {
  const lineas = textoPDF.split(/\r?\n/);
  const patronFechaBanorte = /(\d{1,2})-([A-Z]{3,9})-(\d{2,4})/;
  const patronFechaNum = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
  
  // FASE 1: Detectar secciones
  const secciones: Seccion[] = [];
  let seccionActual: Seccion | null = null;
  
  function cerrar(lineaFin: number) {
    if (seccionActual) {
      seccionActual.lineaFin = lineaFin;
      secciones.push(seccionActual);
      seccionActual = null;
    }
  }
  
  function iniciar(tipo: 'operaciones' | 'inversion', lineaInicio: number) {
    let cuentaNum = '';
    for (let j = lineaInicio; j < Math.min(lineaInicio + 4, lineas.length); j++) {
      let m = lineas[j].match(/(\d{2}-\d{8}-\d)/);
      if (m) { cuentaNum = m[1]; break; }
      m = lineas[j].match(/No\.?\s*de\s*Cuenta:?\s*(\d{6,})/i);
      if (m) { cuentaNum = m[1]; break; }
    }
    let saldoInicial: number | null = null;
    for (let j = lineaInicio; j < Math.min(lineaInicio + 6, lineas.length); j++) {
      const m = lineas[j].match(/SALDO.*?ANTERIOR:?\s*\$?([\d,]+\.\d{2})/i);
      if (m) { saldoInicial = parseFloat(m[1].replace(/[$,]/g, '')); break; }
    }
    seccionActual = { tipo, cuentaNum, lineaInicio, lineaFin: null, saldoInicial };
  }
  
  for (let i = 0; i < lineas.length; i++) {
    const lineaUpper = lineas[i].toUpperCase();
    if (lineaUpper.includes('DETALLE DE MOVIMIENTOS CUENTA DE CHEQUES') ||
        (lineaUpper.includes('DETALLE DE MOVIMIENTOS') && !lineaUpper.includes('DINERO'))) {
      cerrar(i - 1); iniciar('operaciones', i);
    }
    if (lineaUpper.includes('DETALLES DE MOVIMIENTOS DINERO') || 
        (lineaUpper.includes('DETALLE DE MOVIMIENTOS') && lineaUpper.includes('DINERO'))) {
      cerrar(i - 1); iniciar('inversion', i);
    }
    if (lineaUpper.includes('INVERSION') && lineaUpper.includes('ENLACE NEGOCIOS')) {
      cerrar(i - 1); iniciar('inversion', i);
    }
    if (lineaUpper.includes('ENLACE NEGOCIOS AVANZADA') || 
        (lineaUpper.includes('ENLACE NEGOCIOS') && !lineaUpper.includes('INVERSION'))) {
      cerrar(i - 1); iniciar('operaciones', i);
    }
    if (seccionActual && seccionActual.lineaFin === null) {
      if (lineaUpper.match(/^TOTAL\s+\d/) || 
          (lineaUpper.includes('SALDO FINAL DEL PERIODO') && !lineaUpper.includes('ANTERIOR')) ||
          lineaUpper.includes('INFORMACION FISCAL') || lineaUpper.includes('INFORMACIÓN FISCAL')) {
        cerrar(i);
      }
    }
  }
  cerrar(lineas.length - 1);
  
  // FASE 2: Parsear cada sección
  const todosMovimientos: Movimiento[] = [];
  const seccionesConCount = secciones.map(seccion => {
    const movs = parsearSeccion(seccion, lineas);
    todosMovimientos.push(...movs);
    return { ...seccion, count: movs.length };
  });
  
  return { movimientos: todosMovimientos, secciones: seccionesConCount };
}

function parsearSeccion(seccion: Seccion, lineas: string[]): Movimiento[] {
  const movimientos: Movimiento[] = [];
  let saldoAnterior = seccion.saldoInicial;
  const patronFechaBanorte = /(\d{1,2})-([A-Z]{3,9})-(\d{2,4})/;
  const patronFechaNum = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
  
  let i = seccion.lineaInicio;
  while (i <= (seccion.lineaFin ?? lineas.length - 1)) {
    const linea = lineas[i];
    if (!linea || !linea.trim()) { i++; continue; }
    
    const matchFecha = linea.match(patronFechaBanorte) || linea.match(patronFechaNum);
    if (!matchFecha) { i++; continue; }
    
    const lineaUpper = linea.toUpperCase();
    if (lineaUpper.includes('FECHA') && lineaUpper.includes('FOLIO')) { i++; continue; }
    if (lineaUpper.match(/^TOTAL\s/) || lineaUpper.includes('SALDO FINAL DEL PERIODO')) { i++; continue; }
    
    const dia = parseInt(matchFecha[1]);
    let mes: number | undefined;
    if (matchFecha[2] && isNaN(parseInt(matchFecha[2]))) {
      mes = MESES_ES[matchFecha[2].toUpperCase()];
    } else {
      mes = parseInt(matchFecha[2]) - 1;
    }
    let anio = parseInt(matchFecha[3]);
    if (anio < 100) anio = anio < 30 ? 2000 + anio : 1900 + anio;
    if (mes === undefined || mes < 0 || mes > 11 || dia < 1 || dia > 31) { i++; continue; }
    
    const fecha = new Date(anio, mes, dia, 12, 0, 0);
    const restoLinea = linea.substring(matchFecha.index! + matchFecha[0].length).trim();
    
    let concepto = restoLinea;
    let montoEncontrado: number | null = null;
    let saldoEncontrado: number | null = null;
    let lineaMontoIdx = -1;
    
    const montosAqui = extraerMontosLinea(linea);
    const montosAquiInclusivo = extraerMontosLineaInclusivo(linea);
    
    if (montosAquiInclusivo.length >= 2) {
      montoEncontrado = montosAquiInclusivo[0];
      saldoEncontrado = montosAquiInclusivo[1];
      if (Math.abs(montoEncontrado) < 0.5) {
        montoEncontrado = null;
        saldoEncontrado = null;
      } else {
        concepto = quitarMontos(restoLinea);
        lineaMontoIdx = i;
      }
    } else if (montosAqui.length === 1 && restoLinea.length < 50) {
      montoEncontrado = montosAqui[0];
      concepto = quitarMontos(restoLinea);
      lineaMontoIdx = i;
    }
    
    if (montoEncontrado === null) {
      let j = i + 1;
      const limite = Math.min((seccion.lineaFin ?? lineas.length - 1) + 1, i + 20);
      while (j < limite) {
        const lineaSgte = lineas[j];
        if (!lineaSgte || !lineaSgte.trim()) { j++; continue; }
        
        const matchFechaSgte = lineaSgte.match(patronFechaBanorte) || lineaSgte.match(patronFechaNum);
        if (matchFechaSgte && matchFechaSgte.index === 0) break;
        
        const lUpper = lineaSgte.toUpperCase();
        if (lUpper.match(/^TOTAL\s/) || lUpper.includes('SALDO FINAL DEL PERIODO')) break;
        
        const montosSgte = extraerMontosLinea(lineaSgte);
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
        concepto += ' ' + lineaSgte.trim();
        j++;
      }
    }
    
    if (montoEncontrado === null || Math.abs(montoEncontrado) < 0.5) { i++; continue; }
    
    concepto = concepto.replace(/^\s*\d{7}\s*/, '');
    concepto = quitarMontos(concepto).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!concepto) concepto = 'Movimiento bancario';
    
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
    
    movimientos.push({ fecha, concepto, monto: montoFinal, saldo: saldoEncontrado, esInversion: seccion.tipo === 'inversion' });
    i = lineaMontoIdx > 0 ? lineaMontoIdx + 1 : i + 1;
  }
  
  return movimientos;
}

async function main() {
  console.log('🧹 Borrando movimientos existentes de Santander...\n');
  
  // Buscar cuenta Santander operaciones
  const cuentaOp = await db.cuentaBancaria.findFirst({
    where: { cuenta: { contains: '65-50908535-6' } },
  });
  const cuentaInv = await db.cuentaBancaria.findFirst({
    where: { cuenta: { contains: '66-50908535-6' } },
  });
  
  console.log(`Cuenta operaciones: ${cuentaOp?.banco} ${cuentaOp?.cuenta} (ID: ${cuentaOp?.id})`);
  console.log(`Cuenta inversión: ${cuentaInv?.banco} ${cuentaInv?.cuenta} (ID: ${cuentaInv?.id})`);
  
  // Borrar movimientos existentes
  if (cuentaOp) {
    const deleted = await db.movimientoBanco.deleteMany({ where: { cuentaId: cuentaOp.id } });
    console.log(`✅ Borrados ${deleted.count} movimientos de cuenta operaciones`);
    await db.cuentaBancaria.update({ where: { id: cuentaOp.id }, data: { saldo: 0 } });
  }
  if (cuentaInv) {
    const deleted = await db.movimientoBanco.deleteMany({ where: { cuentaId: cuentaInv.id } });
    console.log(`✅ Borrados ${deleted.count} movimientos de cuenta inversión`);
    await db.cuentaBancaria.update({ where: { id: cuentaInv.id }, data: { saldo: 0 } });
  }
  
  // Crear cuenta inversión si no existe
  let cuentaInversion = cuentaInv;
  if (!cuentaInversion && cuentaOp) {
    cuentaInversion = await db.cuentaBancaria.create({
      data: {
        banco: 'SANTANDER Inversión',
        cuenta: '66-50908535-6',
        saldo: 0,
        tipo: 'inversion',
        empresaId: cuentaOp.empresaId,
      },
    });
    console.log(`✅ Cuenta inversión creada: ${cuentaInversion.id}`);
  }
  
  // Procesar los 6 PDFs (Enero - Junio)
  const pdfs = [
    '/tmp/santander-mayo/52582519_Santander-Enero.pdf',
    '/tmp/santander-mayo/52582519_Santander-Febrero.pdf',
    '/tmp/santander-mayo/52582519_Santander-Marzo.pdf',
    '/tmp/santander-mayo/52582519_Santander-Abril.pdf',
    '/tmp/santander-mayo/52582519_Santander-Mayo.pdf',
    '/tmp/santander-mayo/52582519_Santander-Junio.pdf',
  ];
  
  const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.js');
  let totalCreados = 0;
  let totalDuplicados = 0;
  let totalFueraRango = 0;
  let saldoInicialPrimerMes: number | null = null;
  let primerMesProcesado = false;
  
  for (const pdfPath of pdfs) {
    const nombreMes = pdfPath.match(/Santander-(\w+)\.pdf/)?.[1] || 'Desconocido';
    console.log(`\n📄 Procesando ${nombreMes}...`);
    
    if (!fs.existsSync(pdfPath)) {
      console.log(`  ⚠️ Archivo no encontrado: ${pdfPath}`);
      continue;
    }
    
    const buffer = fs.readFileSync(pdfPath);
    const data = new Uint8Array(buffer);
    const pdfDoc = await pdfjsLib.getDocument({ data, useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
    
    let textoPDF = '';
    for (let p = 1; p <= pdfDoc.numPages; p++) {
      const page = await pdfDoc.getPage(p);
      const content = await page.getTextContent();
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
    
    const { movimientos, secciones } = parsearPDF(textoPDF);
    console.log(`  Secciones: ${secciones.length}`);
    secciones.forEach(s => console.log(`    - ${s.tipo} (${s.cuentaNum}): ${s.count} movs | saldo inicial: $${s.saldoInicial}`));
    console.log(`  Movimientos totales detectados: ${movimientos.length}`);
    
    let creados = 0;
    let duplicados = 0;
    let fueraRango = 0;
    
    // Si es el primer mes (Enero) y la cuenta está vacía, agregar el saldo inicial como movimiento de apertura
    if (!primerMesProcesado && cuentaOp && secciones.length > 0 && secciones[0].saldoInicial !== null && secciones[0].saldoInicial > 0) {
      // Verificar que la cuenta no tenga ya movimientos
      const movsExistentes = await db.movimientoBanco.count({ where: { cuentaId: cuentaOp.id } });
      if (movsExistentes === 0) {
        saldoInicialPrimerMes = secciones[0].saldoInicial;
        // Crear movimiento de apertura con el saldo inicial
        await db.movimientoBanco.create({
          data: {
            fecha: new Date(2026, 0, 1, 12, 0, 0), // 1 de enero del 2026
            concepto: 'SALDO INICIAL DE APERTURA (saldo final del periodo anterior según PDF Santander)',
            monto: saldoInicialPrimerMes,
            tipo: 'ingreso',
            estado: 'conciliado',
            cuentaId: cuentaOp.id,
          },
        });
        creados++;
        console.log(`  💰 Movimiento de apertura creado: $${saldoInicialPrimerMes}`);
        primerMesProcesado = true;
      }
    }
    
    for (const mov of movimientos) {
      const yearMov = mov.fecha.getFullYear();
      if (yearMov < 2020 || yearMov > new Date().getFullYear() + 1) {
        fueraRango++;
        continue;
      }
      
      // Determinar a qué cuenta pertenece
      const cuentaDestinoId = mov.esInversion && cuentaInversion ? cuentaInversion.id : (cuentaOp?.id || '');
      if (!cuentaDestinoId) continue;
      
      const existente = await db.movimientoBanco.findFirst({
        where: {
          cuentaId: cuentaDestinoId,
          fecha: mov.fecha,
          concepto: mov.concepto,
          monto: mov.monto,
        },
      });
      if (existente) { duplicados++; continue; }
      
      await db.movimientoBanco.create({
        data: {
          fecha: mov.fecha,
          concepto: mov.concepto,
          monto: mov.monto,
          tipo: mov.monto > 0 ? 'ingreso' : 'egreso',
          estado: 'conciliado',
          cuentaId: cuentaDestinoId,
        },
      });
      creados++;
    }
    
    totalCreados += creados;
    totalDuplicados += duplicados;
    totalFueraRango += fueraRango;
    
    const ingresos = movimientos.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
    const egresos = movimientos.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);
    console.log(`  ✅ Creados: ${creados}, duplicados: ${duplicados}, fuera rango: ${fueraRango}`);
    console.log(`  💰 Ingresos: $${ingresos.toFixed(2)} | Egresos: $${egresos.toFixed(2)} | Neto: $${(ingresos-egresos).toFixed(2)}`);
  }
  
  // Actualizar saldos finales
  console.log('\n\n📊 Actualizando saldos...');
  if (cuentaOp) {
    const todosOp = await db.movimientoBanco.findMany({
      where: { cuentaId: cuentaOp.id },
      select: { monto: true },
    });
    const saldoOp = todosOp.reduce((s, m) => s + m.monto, 0);
    await db.cuentaBancaria.update({ where: { id: cuentaOp.id }, data: { saldo: saldoOp } });
    console.log(`  Cuenta operaciones: ${todosOp.length} movs | Saldo: $${saldoOp.toFixed(2)}`);
  }
  if (cuentaInversion) {
    const todosInv = await db.movimientoBanco.findMany({
      where: { cuentaId: cuentaInversion.id },
      select: { monto: true },
    });
    const saldoInv = todosInv.reduce((s, m) => s + m.monto, 0);
    await db.cuentaBancaria.update({ where: { id: cuentaInversion.id }, data: { saldo: saldoInv } });
    console.log(`  Cuenta inversión: ${todosInv.length} movs | Saldo: $${saldoInv.toFixed(2)}`);
  }
  
  console.log(`\n✅ Total: ${totalCreados} creados, ${totalDuplicados} duplicados, ${totalFueraRango} fuera de rango`);
}

main()
  .catch(e => { console.error('❌', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
