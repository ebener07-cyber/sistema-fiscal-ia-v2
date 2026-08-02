/**
 * Parser PDF Santander - Reescritura completa
 * 
 * MEJORAS vs versión anterior:
 * 1. Detecta 2 secciones: "Detalle de movimientos cuenta de cheques" y "Detalles de movimientos Dinero Creciente"
 * 2. NO confunde números de folio, CLABE, ni RFC con montos
 * 3. Solo extrae montos que tengan formato específico (NN,NNN.NN o N,NNN.NN o NN,NNN.NN)
 * 4. Cuando un movimiento ocupa múltiples líneas, acumula toda la descripción hasta encontrar la línea con monto+saldo
 * 5. Detecta el SALDO FINAL DEL PERIODO ANTERIOR como saldo inicial
 * 6. Detecta la línea "TOTAL   depósitos   retiros" como cierre
 */

const fs = require('fs');

async function main() {
  // Polyfills
  (globalThis).DOMMatrix = class DOMMatrix {
    constructor(init) { this._a=1;this._b=0;this._c=0;this._d=1;this._e=0;this._f=0; }
    multiply(o){return this;} translate(x,y){return this;} scale(s){return this;}
  };
  (globalThis).Path2D = class Path2D {
    moveTo(){} lineTo(){} closePath(){} arc(){} rect(){} ellipse(){}
  };
  
  const pdfjsLib = require('/home/z/my-project/node_modules/pdfjs-dist/legacy/build/pdf.js');
  const pdfPath = process.argv[2] || '/home/z/my-project/upload/52582519_Santander-Mayo.pdf';
  const data = new Uint8Array(fs.readFileSync(pdfPath));
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
  
  const lineas = textoPDF.split('\n');
  
  // === NUEVO PARSER SANTANDER ===
  
  // Mapeo de meses
  const MESES_ES = {
    'ENE': 0, 'FEB': 1, 'MAR': 2, 'ABR': 3, 'MAY': 4, 'JUN': 5,
    'JUL': 6, 'AGO': 7, 'SEP': 8, 'OCT': 9, 'NOV': 10, 'DIC': 11,
    'ENERO': 0, 'FEBRERO': 1, 'MARZO': 2, 'ABRIL': 3, 'MAYO': 4, 'JUNIO': 5,
    'JULIO': 6, 'AGOSTO': 7, 'SEPTIEMBRE': 8, 'OCTUBRE': 9, 'NOVIEMBRE': 10, 'DICIEMBRE': 11,
  };
  
  // Patrón de fecha DD-MMM-YYYY (Santander usa 04-MAY-2026, no 04-MAY-26)
  const patronFecha = /(\d{1,2})-([A-Z]{3,9})-(\d{4})/;
  const patronFechaCorto = /(\d{1,2})-([A-Z]{3,9})-(\d{2})/;
  
  // Patrón ESTRICTO de monto: debe ser número con 2 decimales (NN,NNN.NN o NNN.NN)
  // NO debe estar precedido por letras (para evitar confundir con folios como 7113421)
  function extraerMontosLinea(linea) {
    const montos = [];
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
  
  // Versión inclusiva: incluye montos 0.00 (para detección de saldo cero)
  function extraerMontosLineaInclusivo(linea) {
    const montos = [];
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
  
  // Quitar montos de un texto
  function quitarMontos(texto) {
    return texto.replace(/(?:^|\s)\d{1,3}(?:,\d{3})*\.\d{2}(?:\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
  }
  
  // ===== FASE 1: Detectar secciones =====
  const secciones = []; // { tipo: 'operaciones'|'inversion', cuentaNum, lineaInicio, lineaFin, saldoInicial }
  let seccionActual = null;
  
  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    const lineaUpper = linea.toUpperCase();
    
    // Detectar "Detalle de movimientos cuenta de cheques."
    if (lineaUpper.includes('DETALLE DE MOVIMIENTOS CUENTA DE CHEQUES') ||
        lineaUpper.includes('DETALLE DE MOVIMIENTOS')) {
      if (seccionActual) {
        seccionActual.lineaFin = i - 1;
        secciones.push(seccionActual);
      }
      // Buscar número de cuenta en las siguientes 2 líneas
      let cuentaNum = '';
      for (let j = i; j < Math.min(i + 3, lineas.length); j++) {
        const match = lineas[j].match(/(\d{2}-\d{8}-\d)/);
        if (match) { cuentaNum = match[1]; break; }
      }
      // Buscar saldo anterior en las siguientes líneas
      let saldoInicial = null;
      for (let j = i; j < Math.min(i + 5, lineas.length); j++) {
        const matchSaldo = lineas[j].match(/SALDO.*?ANTERIOR:?\s*\$?([\d,]+\.\d{2})/i);
        if (matchSaldo) {
          saldoInicial = parseFloat(matchSaldo[1].replace(/[$,]/g, ''));
          break;
        }
      }
      // La cuenta 65-XXXX es operaciones, 66-XXXX es inversión
      const esInversion = cuentaNum.startsWith('66-');
      seccionActual = {
        tipo: esInversion ? 'inversion' : 'operaciones',
        cuentaNum,
        lineaInicio: i,
        lineaFin: null,
        saldoInicial,
      };
      console.log(`📍 Sección detectada: ${seccionActual.tipo} (${cuentaNum}) - Saldo inicial: $${saldoInicial}`);
    }
    
    // Detectar fin de sección por línea "TOTAL" o cambio de página
    if (seccionActual && seccionActual.lineaFin === null) {
      const lineaUpper2 = linea.toUpperCase();
      if (lineaUpper2.match(/^TOTAL\s/) || lineaUpper2.match(/^TOTAL\s+\d/) || 
          (lineaUpper2.includes('SALDO FINAL DEL PERIODO') && !lineaUpper2.includes('ANTERIOR')) ||
          lineaUpper2.includes('DETALLES DE MOVIMIENTOS DINERO') ||
          lineaUpper2.includes('INFORMACION FISCAL')) {
        seccionActual.lineaFin = i;
        secciones.push(seccionActual);
        // Si la siguiente es otra sección de movimientos, iniciar nueva
        if (lineaUpper2.includes('DETALLES DE MOVIMIENTOS DINERO')) {
          // Es el inicio de la sección de inversión
          let cuentaNum = '';
          for (let j = i; j < Math.min(i + 3, lineas.length); j++) {
            const match = lineas[j].match(/(\d{2}-\d{8}-\d)/);
            if (match) { cuentaNum = match[1]; break; }
          }
          let saldoInicial = null;
          for (let j = i; j < Math.min(i + 5, lineas.length); j++) {
            const matchSaldo = lineas[j].match(/SALDO.*?ANTERIOR:?\s*\$?([\d,]+\.\d{2})/i);
            if (matchSaldo) {
              saldoInicial = parseFloat(matchSaldo[1].replace(/[$,]/g, ''));
              break;
            }
          }
          seccionActual = {
            tipo: 'inversion',
            cuentaNum,
            lineaInicio: i,
            lineaFin: null,
            saldoInicial,
          };
          console.log(`📍 Sección detectada: inversion (${cuentaNum}) - Saldo inicial: $${saldoInicial}`);
        } else {
          seccionActual = null;
        }
      }
    }
  }
  // Cerrar última sección
  if (seccionActual && seccionActual.lineaFin === null) {
    seccionActual.lineaFin = lineas.length - 1;
    secciones.push(seccionActual);
  }
  
  console.log(`\n📊 Secciones detectadas: ${secciones.length}`);
  secciones.forEach(s => console.log(`  - ${s.tipo} (${s.cuentaNum}) líneas ${s.lineaInicio}-${s.lineaFin} | saldo inicial: $${s.saldoInicial}`));
  
  // ===== FASE 2: Parsear movimientos de cada sección =====
  function parsearSeccion(seccion) {
    const movimientos = [];
    let saldoAnterior = seccion.saldoInicial;
    
    let i = seccion.lineaInicio;
    while (i <= seccion.lineaFin) {
      const linea = lineas[i];
      if (!linea || !linea.trim()) { i++; continue; }
      
      // Buscar fecha al inicio de la línea
      const matchFecha = linea.match(patronFecha) || linea.match(patronFechaCorto);
      if (!matchFecha) { i++; continue; }
      
      // Saltar líneas de encabezado
      const lineaUpper = linea.toUpperCase();
      if (lineaUpper.includes('FECHA') && lineaUpper.includes('FOLIO')) { i++; continue; }
      if (lineaUpper.includes('TOTAL') || lineaUpper.includes('SALDO FINAL DEL PERIODO')) { i++; continue; }
      
      const dia = parseInt(matchFecha[1]);
      const mesStr = matchFecha[2].toUpperCase();
      const mes = MESES_ES[mesStr];
      let anio = parseInt(matchFecha[3]);
      if (anio < 100) anio = anio < 30 ? 2000 + anio : 1900 + anio;
      
      if (mes === undefined || dia < 1 || dia > 31) { i++; continue; }
      
      const fecha = new Date(anio, mes, dia, 12, 0, 0);
      
      // Resto de la línea después de la fecha
      const restoLinea = linea.substring(matchFecha.index + matchFecha[0].length).trim();
      
      // Acumular descripción hasta encontrar línea con monto+saldo
      let concepto = restoLinea;
      let montoEncontrado = null;
      let saldoEncontrado = null;
      let lineaMontoIdx = -1;
      
      // Buscar montos en la línea actual (usando versión inclusiva para detectar saldo 0.00)
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
      
      // Si no se encontraron 2 montos, buscar en líneas siguientes
      if (montoEncontrado === null) {
        let j = i + 1;
        while (j <= seccion.lineaFin && j < i + 20) {
          const lineaSiguiente = lineas[j];
          if (!lineaSiguiente || !lineaSiguiente.trim()) { j++; continue; }
          
          // Si encontramos otra fecha, ya no hay montos para este movimiento
          const matchFechaSgte = lineaSiguiente.match(patronFecha) || lineaSiguiente.match(patronFechaCorto);
          if (matchFechaSgte) {
            // Verificar que sea realmente otra fecha (no parte de descripción)
            // Solo rompemos si la fecha está al inicio de la línea
            if (matchFechaSgte.index === 0) break;
          }
          
          // Si es "TOTAL" o "SALDO FINAL DEL PERIODO", ya no hay más movimientos
          const lUpper = lineaSiguiente.toUpperCase();
          if (lUpper.match(/^TOTAL\s/) || lUpper.includes('SALDO FINAL DEL PERIODO')) break;
          
          const montosSgte = extraerMontosLinea(lineaSiguiente);
          if (montosSgte.length >= 2) {
            montoEncontrado = montosSgte[0];
            saldoEncontrado = montosSgte[1];
            lineaMontoIdx = j;
            break;
          } else if (montosSgte.length === 1 && j > i + 1) {
            // Una sola cantidad después de varias líneas de descripción
            // Esto puede pasar cuando solo hay monto pero no saldo
            montoEncontrado = montosSgte[0];
            saldoEncontrado = null;
            lineaMontoIdx = j;
            break;
          }
          
          // Acumular como descripción
          concepto += ' ' + lineaSiguiente.trim();
          j++;
        }
      }
      
      if (montoEncontrado === null || Math.abs(montoEncontrado) < 0.5) { i++; continue; }
      
      // Limpiar concepto: quitar folio (primer número de 7 dígitos después de la fecha)
      // y quitar montos
      concepto = concepto.replace(/^\s*\d{7}\s*/, ''); // Quitar folio al inicio
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
        const esRetiro = ['COMPRA', 'PAGO', 'RETIRO', 'CARGO', 'TRASPASO', 'COMISION', 'TRANSFERENCIA', 
                          'INTERESES EXENTO', 'PAGO DE CAPITAL', 'PAGO DE CREDITO', 'ADMINISTRACION',
                          'CGO', 'CARGO CAPITAL', 'CARGO POR', 'CGO INTERESES', 'I V A POR COMISION',
                          'PAGO PRIMA SEGURO'].some(k => conceptoUpper.includes(k));
        const esDeposito = ['DISPOSICION', 'RECIBIDO', 'DEPOSITO', 'DEVOLUCION', 'ABONO', 
                            'APORT LINEA CAPTURA'].some(k => conceptoUpper.includes(k));
        if (esRetiro) montoFinal = -Math.abs(montoEncontrado);
        else if (esDeposito) montoFinal = Math.abs(montoEncontrado);
      }
      
      if (saldoEncontrado !== null) saldoAnterior = saldoEncontrado;
      
      movimientos.push({ fecha, concepto, monto: montoFinal, saldo: saldoEncontrado });
      
      // Saltar a la línea después de donde encontramos el monto
      i = (lineaMontoIdx > 0 ? lineaMontoIdx + 1 : i + 1);
    }
    
    return movimientos;
  }
  
  // ===== FASE 3: Procesar cada sección =====
  console.log('\n' + '='.repeat(80));
  for (const seccion of secciones) {
    console.log(`\n📊 Sección: ${seccion.tipo} (${seccion.cuentaNum})`);
    console.log(`   Saldo inicial: $${seccion.saldoInicial}`);
    
    const movs = parsearSeccion(seccion);
    console.log(`   Movimientos detectados: ${movs.length}`);
    
    movs.forEach((m, idx) => {
      const fecha = m.fecha.toISOString().slice(0, 10);
      const signo = m.monto >= 0 ? '+' : '';
      const saldoStr = m.saldo !== null ? `$${m.saldo.toFixed(2)}` : '—';
      console.log(`   ${idx+1}. ${fecha} | ${signo}$${m.monto.toFixed(2)} | Saldo: ${saldoStr} | ${m.concepto.slice(0, 70)}`);
    });
    
    if (movs.length > 0) {
      const ingresos = movs.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
      const egresos = movs.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);
      console.log(`   💰 Ingresos: $${ingresos.toFixed(2)} | Egresos: $${egresos.toFixed(2)} | Neto: $${(ingresos-egresos).toFixed(2)}`);
      if (movs[movs.length - 1].saldo !== null) {
        console.log(`   💵 Saldo final calculado: $${movs[movs.length - 1].saldo.toFixed(2)}`);
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
