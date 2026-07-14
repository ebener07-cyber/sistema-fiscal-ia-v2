const ExcelJS = require('/home/z/my-project/node_modules/exceljs');
const path = require('path');

async function analyze(filePath) {
  console.log(`\n========== ${path.basename(filePath)} ==========`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  console.log(`Hojas: ${wb.worksheets.length}`);
  for (const ws of wb.worksheets) {
    console.log(`\n--- Hoja: "${ws.name}" (${ws.rowCount} filas, ${ws.columnCount} cols) ---`);
    const headerRow = ws.getRow(1);
    const headers = [];
    headerRow.eachCell((cell, col) => {
      headers[col] = String(cell.value || '');
    });
    console.log('Headers:', headers.filter(h => h).join(' | '));
    for (let r = 2; r <= Math.min(5, ws.rowCount); r++) {
      const fila = ws.getRow(r);
      const valores = [];
      for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) {
        const v = fila.getCell(c).value;
        valores.push(typeof v === 'object' && v ? JSON.stringify(v).slice(0, 40) : String(v || '').slice(0, 40));
      }
      console.log(`Fila ${r}:`, valores.join(' | '));
    }
    if (ws.rowCount > 5) {
      const fila = ws.getRow(ws.rowCount);
      const valores = [];
      for (let c = 1; c <= Math.min(ws.columnCount, 20); c++) {
        const v = fila.getCell(c).value;
        valores.push(typeof v === 'object' && v ? JSON.stringify(v).slice(0, 40) : String(v || '').slice(0, 40));
      }
      console.log(`Fila ${ws.rowCount} (última):`, valores.join(' | '));
    }
  }
}

(async () => {
  await analyze('/home/z/my-project/upload/SALDO BANORTE $266,132.67.xlsx');
})();
