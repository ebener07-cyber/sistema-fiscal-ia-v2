const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

// Polyfill DOMMatrix
if (typeof (globalThis).DOMMatrix === 'undefined') {
  (globalThis).DOMMatrix = class DOMMatrix {
    constructor(init) {
      this._a = 1; this._b = 0; this._c = 0; this._d = 1; this._e = 0; this._f = 0;
    }
    multiply(other) { return this; }
    translate(x, y) { return this; }
    scale(s) { return this; }
  };
}
if (typeof (globalThis).Path2D === 'undefined') {
  (globalThis).Path2D = class Path2D {
    moveTo() {} lineTo() {} closePath() {} arc() {} rect() {} ellipse() {}
  };
}

async function main() {
  const data = new Uint8Array(fs.readFileSync('/home/z/my-project/upload/52582519_Santander-Enero.pdf'));
  const pdfDoc = await pdfjsLib.getDocument({ data, useSystemFonts: true, disableFontFace: true, isEvalSupported: false }).promise;
  
  let texto = '';
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const content = await page.getTextContent();
    let lineaActual = '';
    let yAnterior = null;
    for (const item of content.items) {
      const y = item.transform ? item.transform[5] : 0;
      if (yAnterior !== null && Math.abs(y - yAnterior) > 2) {
        texto += lineaActual.trim() + '\n';
        lineaActual = '';
      }
      lineaActual += (item.str || '') + ' ';
      yAnterior = y;
    }
    if (lineaActual.trim()) texto += lineaActual.trim() + '\n';
  }
  
  // Imprimir solo las primeras 100 líneas para ver el formato
  const lineas = texto.split('\n');
  console.log('Total de líneas:', lineas.length);
  console.log('---PRIMERAS 100 LÍNEAS---');
  lineas.slice(0, 100).forEach((l, i) => {
    console.log(`${i+1}: ${l}`);
  });
  
  console.log('\n---LÍNEAS CON MONTOS (líneas 100-200)---');
  lineas.slice(100, 200).forEach((l, i) => {
    console.log(`${i+101}: ${l}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
