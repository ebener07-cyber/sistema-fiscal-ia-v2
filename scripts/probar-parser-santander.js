/**
 * Probar parser PDF con el Santander
 */
const fs = require('fs');
const path = require('path');

async function main() {
  // Polyfills
  if (typeof (globalThis).DOMMatrix === 'undefined') {
    (globalThis).DOMMatrix = class DOMMatrix {
      constructor(init) { this._a=1;this._b=0;this._c=0;this._d=1;this._e=0;this._f=0; }
      multiply(o){return this;} translate(x,y){return this;} scale(s){return this;}
    };
  }
  if (typeof (globalThis).Path2D === 'undefined') {
    (globalThis).Path2D = class Path2D {
      moveTo(){} lineTo(){} closePath(){} arc(){} rect(){} ellipse(){}
    };
  }
  
  const pdfjsLib = require('/home/z/my-project/node_modules/pdfjs-dist/legacy/build/pdf.js');
  const data = new Uint8Array(fs.readFileSync('/home/z/my-project/upload/52582519_Santander-Enero.pdf'));
  const pdfDoc = await pdfjsLib.getDocument({ data, useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
  
  let textoPDF = '';
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    let lineaActual = '';
    let yAnterior = null;
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
  
  // Ahora cargar el módulo upload-estado-cuenta y probar parsePDFTexto
  // Para evitar imports complejos, reimplementamos la función aquí con la misma lógica
  
  const MESES_ES = {
    'ENE': 0, 'FEB': 1, 'MAR': 2, 'ABR': 3, 'MAY': 4, 'JUN': 5,
    'JUL': 6, 'AGO': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DIC': 11,
    'ENERO': 0, 'FEBRERO': 1, 'MARZO': 2, 'ABRIL': 3, 'MAYO': 4, 'JUNIO': 5,
    'JULIO': 6, 'AGOSTO': 7, 'SEPTIEMBRE': 8, 'OCTUBRE': 9, 'NOVIEMBRE': 10, 'DICIEMBRE': 11,
  };
  
  const patronFechaNum = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
  const patronFechaBanorte = /(\d{1,2})-([A-Z]{3,9})-(\d{2,4})/;
  
  const keywordsDeposito = ['DISPOSICION', 'RECIBIDO', 'DEPOSITO DE CUENTA', 'DEV. DEPOSITO', 'DEVOLUCION', 'ABONO'];
  const keywordsRetiro = ['COMPRA', 'PAGO', 'RETIRO', 'CARGO', 'TRASPASO', 'COMISION', 'COMISIÓN', 'TRANSFERENCIA', 'I.V.A.', 'INTERESES EXENTO', 'PAGO DE CAPITAL', 'PAGO DE CREDITO', 'PAGO DE LDC', 'ADMINISTRACION', 'COM. DISPERSION', 'IVA COM', 'IVA 00054', 'RETIRO DEP.', 'CGO', 'CARGO CAPITAL', 'CARGO POR'];
  
  function extraerMontos(linea) {
    const montos = [];
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
  
  function quitarMontos(texto) {
    return texto.replace(/-?\$?\s?[\d,]+\.\d{2}/g, '').trim();
  }
  
  const movimientos = [];
  const lineas = textoPDF.split(/\r?\n/);
  let saldoAnterior = null;
  let i = 0;
  let enSeccionMovimientos = false;
  
  while (i < lineas.length) {
    const linea = lineas[i].trim();
    if (!linea || linea.length < 5) { i++; continue; }
    
    // Detectar inicio de sección de movimientos
    if (linea.includes('Detalle de movimientos') || linea.includes('FECHA   FOLIO')) {
      enSeccionMovimientos = true;
      // Buscar saldo anterior
      const saldoLinea = lineas[i-1] || '';
      const matchSaldo = saldoLinea.match(/SALDO.*?:?\s*\$?([\d,]+\.\d{2})/i);
      if (matchSaldo) {
        saldoAnterior = parseFloat(matchSaldo[1].replace(/[$,]/g, ''));
        console.log(`💰 Saldo anterior detectado: $${saldoAnterior}`);
      }
      i++;
      continue;
    }
    
    // Si salimos de la sección de movimientos
    if (enSeccionMovimientos && (linea.includes('Estado de cuenta') && linea.includes('Santander'))) {
      enSeccionMovimientos = false;
    }
    
    if (!enSeccionMovimientos) { i++; continue; }
    
    // Intentar parsear fecha
    let fecha = null;
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
        restoLinea = linea.substring(matchBanorte.index + matchBanorte[0].length).trim();
      }
    }
    
    if (!fecha) { i++; continue; }
    
    // Acumular descripción y buscar montos
    let concepto = restoLinea;
    let montoEncontrado = null;
    let saldoEncontrado = null;
    
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
        if (patronFechaBanorte.test(lineaSiguiente) || patronFechaNum.test(lineaSiguiente)) break;
        
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
  
  console.log(`\n📊 Movimientos detectados: ${movimientos.length}\n`);
  movimientos.slice(0, 20).forEach((m, idx) => {
    const fecha = m.fecha.toISOString().slice(0, 10);
    const signo = m.monto >= 0 ? '+' : '';
    console.log(`${idx+1}. ${fecha} | ${signo}$${m.monto.toFixed(2)} | Saldo: $${(m.saldo||0).toFixed(2)} | ${m.concepto.slice(0, 80)}`);
  });
  
  if (movimientos.length > 20) {
    console.log(`\n... y ${movimientos.length - 20} más`);
  }
  
  // Calcular totales
  const ingresos = movimientos.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
  const egresos = movimientos.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);
  console.log(`\n💰 Resumen: ${movimientos.filter(m => m.monto > 0).length} ingresos = $${ingresos.toFixed(2)} | ${movimientos.filter(m => m.monto < 0).length} egresos = $${egresos.toFixed(2)} | Neto: $${(ingresos-egresos).toFixed(2)}`);
}

main().catch(e => { console.error(e); process.exit(1); });
