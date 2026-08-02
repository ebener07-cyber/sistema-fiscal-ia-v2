/**
 * Análisis detallado del PDF Santander-Mayo.pdf
 * Extrae el texto y muestra TODAS las líneas para ver la estructura completa
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
  console.log(`Total líneas: ${lineas.length}`);
  console.log('='.repeat(80));
  lineas.forEach((l, i) => {
    console.log(`${i+1}: ${l}`);
  });
}

main().catch(e => { console.error(e); process.exit(1); });
