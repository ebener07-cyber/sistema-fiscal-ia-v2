/**
 * Procesar el PDF de Santander y subir los movimientos a la BD
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

async function main() {
  console.log('📄 Procesando PDF Santander...\n');
  
  // Buscar cuenta Santander
  const cuenta = await db.cuentaBancaria.findFirst({
    where: { cuenta: { contains: '65-50908535-6' } },
  });
  if (!cuenta) {
    console.log('❌ No se encontró la cuenta Santander');
    return;
  }
  console.log(`✅ Cuenta encontrada: ${cuenta.banco} ${cuenta.cuenta} (ID: ${cuenta.id})`);
  
  // Cargar PDF
  const pdfPath = '/home/z/my-project/upload/52582519_Santander-Enero.pdf';
  const buffer = fs.readFileSync(pdfPath);
  console.log(`📄 PDF cargado: ${buffer.length} bytes`);
  
  // Extraer texto del PDF
  const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.js');
  const data = new Uint8Array(buffer);
  const pdfDoc = await pdfjsLib.getDocument({ data, useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
  console.log(`📑 PDF tiene ${pdfDoc.numPages} páginas`);
  
  let textoPDF = '';
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
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
  console.log(`📝 Texto extraído: ${textoPDF.length} chars`);
  
  // Parsear movimientos
  const MESES_ES: Record<string, number> = {
    'ENE': 0, 'FEB': 1, 'MAR': 2, 'ABR': 3, 'MAY': 4, 'JUN': 5,
    'JUL': 6, 'AGO': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DIC': 11,
    'ENERO': 0, 'FEBRERO': 1, 'MARZO': 2, 'ABRIL': 3, 'MAYO': 4, 'JUNIO': 5,
    'JULIO': 6, 'AGOSTO': 7, 'SEPTIEMBRE': 8, 'OCTUBRE': 9, 'NOVIEMBRE': 10, 'DICIEMBRE': 11,
  };
  
  const patronFechaBanorte = /(\d{1,2})-([A-Z]{3,9})-(\d{2,4})/;
  const keywordsDeposito = ['DISPOSICION', 'RECIBIDO', 'DEPOSITO DE CUENTA', 'DEV. DEPOSITO', 'DEVOLUCION', 'ABONO'];
  const keywordsRetiro = ['COMPRA', 'PAGO', 'RETIRO', 'CARGO', 'TRASPASO', 'COMISION', 'COMISIÓN', 'TRANSFERENCIA', 'I.V.A.', 'INTERESES EXENTO', 'PAGO DE CAPITAL', 'PAGO DE CREDITO', 'PAGO DE LDC', 'ADMINISTRACION', 'COM. DISPERSION', 'IVA COM', 'IVA 00054', 'RETIRO DEP.', 'CGO', 'CARGO CAPITAL', 'CARGO POR', 'CGO INTERESES'];
  
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
  
  function quitarMontos(texto: string): string {
    return texto.replace(/-?\$?\s?[\d,]+\.\d{2}/g, '').trim();
  }
  
  const movimientos: Array<{ fecha: Date; concepto: string; monto: number; saldo: number | null }> = [];
  const lineas = textoPDF.split(/\r?\n/);
  let saldoAnterior: number | null = null;
  let i = 0;
  let enSeccionMovimientos = false;
  
  while (i < lineas.length) {
    const linea = lineas[i].trim();
    if (!linea || linea.length < 5) { i++; continue; }
    
    // Detectar inicio de sección de movimientos
    if (linea.includes('Detalle de movimientos') || (linea.includes('FECHA') && linea.includes('FOLIO') && linea.includes('DESCRIPCION'))) {
      enSeccionMovimientos = true;
      // Buscar saldo anterior en línea previa
      const saldoLinea = lineas[i-1] || '';
      const matchSaldo = saldoLinea.match(/SALDO.*?:?\s*\$?([\d,]+\.\d{2})/i);
      if (matchSaldo) {
        saldoAnterior = parseFloat(matchSaldo[1].replace(/[$,]/g, ''));
      }
      i++;
      continue;
    }
    
    // Si encontramos fin de movimientos
    if (enSeccionMovimientos && (linea.includes('Estado de cuenta') && linea.includes('Santander'))) {
      enSeccionMovimientos = false;
    }
    
    if (!enSeccionMovimientos) { i++; continue; }
    
    // Intentar parsear fecha
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
        fecha = new Date(anio, mes, dia, 12, 0, 0);
        restoLinea = linea.substring(matchBanorte.index! + matchBanorte[0].length).trim();
      }
    }
    
    if (!fecha) { i++; continue; }
    
    // Acumular descripción y buscar montos
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
    
    if (montoEncontrado === null) {
      let j = i + 1;
      while (j < lineas.length && j < i + 15) {
        const lineaSiguiente = lineas[j].trim();
        if (!lineaSiguiente) { j++; continue; }
        if (patronFechaBanorte.test(lineaSiguiente)) break;
        
        const montosSiguiente = extraerMontos(lineaSiguiente);
        if (montosSiguiente.length >= 2) {
          montoEncontrado = montosSiguiente[0];
          saldoEncontrado = montosSiguiente[1];
          break;
        } else if (montosSiguiente.length === 1 && j > i + 1) {
          montoEncontrado = montosSiguiente[0];
          break;
        }
        concepto += ' ' + lineaSiguiente;
        j++;
      }
    }
    
    if (montoEncontrado === null || Math.abs(montoEncontrado) < 0.5) { i++; continue; }
    
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
      const conceptoUpper = concepto.toUpperCase();
      const esRetiro = keywordsRetiro.some(k => conceptoUpper.includes(k));
      const esDeposito = keywordsDeposito.some(k => conceptoUpper.includes(k));
      if (esRetiro) montoFinal = -Math.abs(montoEncontrado);
      else if (esDeposito) montoFinal = Math.abs(montoEncontrado);
    }
    
    if (saldoEncontrado !== null) saldoAnterior = saldoEncontrado;
    
    concepto = quitarMontos(concepto).replace(/\s+/g, ' ').trim().slice(0, 300);
    if (!concepto) concepto = 'Movimiento bancario';
    
    movimientos.push({ fecha, concepto, monto: montoFinal, saldo: saldoEncontrado });
    i++;
  }
  
  console.log(`\n📊 Movimientos detectados: ${movimientos.length}`);
  
  // Insertar en la BD
  let creados = 0;
  let duplicados = 0;
  let fueraRango = 0;
  
  for (const mov of movimientos) {
    const yearMov = mov.fecha.getFullYear();
    if (yearMov < 2020 || yearMov > new Date().getFullYear() + 1) {
      fueraRango++;
      continue;
    }
    
    // Dedupe
    const existente = await db.movimientoBanco.findFirst({
      where: {
        cuentaId: cuenta.id,
        fecha: mov.fecha,
        concepto: mov.concepto,
        monto: mov.monto,
      },
    });
    if (existente) {
      duplicados++;
      continue;
    }
    
    await db.movimientoBanco.create({
      data: {
        fecha: mov.fecha,
        concepto: mov.concepto,
        monto: mov.monto,
        tipo: mov.monto > 0 ? 'ingreso' : 'egreso',
        estado: 'conciliado',
        cuentaId: cuenta.id,
      },
    });
    creados++;
  }
  
  console.log(`✅ Creados: ${creados}, duplicados: ${duplicados}, fuera de rango: ${fueraRango}`);
  
  // Actualizar saldo
  const todosMovs = await db.movimientoBanco.findMany({
    where: { cuentaId: cuenta.id },
    select: { monto: true },
  });
  const saldoTotal = todosMovs.reduce((s, m) => s + m.monto, 0);
  await db.cuentaBancaria.update({
    where: { id: cuenta.id },
    data: { saldo: saldoTotal },
  });
  console.log(`💰 Saldo actualizado: $${saldoTotal.toFixed(2)}`);
  
  // Resumen
  const ingresos = movimientos.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
  const egresos = movimientos.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);
  console.log(`\n📈 Resumen del mes:`);
  console.log(`  Ingresos: ${movimientos.filter(m => m.monto > 0).length} movs = $${ingresos.toFixed(2)}`);
  console.log(`  Egresos: ${movimientos.filter(m => m.monto < 0).length} movs = $${egresos.toFixed(2)}`);
  console.log(`  Neto: $${(ingresos - egresos).toFixed(2)}`);
}

main()
  .catch(e => { console.error('❌', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
