/**
 * Analizar la estructura de los archivos Excel de saldos
 */
const ExcelJS = require('exceljs');

async function main() {
  const archivos = [
    '/home/z/my-project/upload/SALDO SANTANDER $14,755.13.xlsx',
    '/home/z/my-project/upload/SALDO BANORTE $53,756.17.xlsx',
  ];

  for (const archivo of archivos) {
    console.log('\n' + '='.repeat(80));
    console.log(`📄 Archivo: ${archivo.split('/').pop()}`);
    console.log('='.repeat(80));

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(archivo);

    console.log(`\n📊 Hojas: ${wb.worksheets.length}`);
    wb.worksheets.forEach((ws, i) => {
      console.log(`  ${i + 1}. "${ws.name}" — ${ws.rowCount} filas × ${ws.columnCount} columnas`);
    });

    // Analizar las primeras 3 hojas
    for (let i = 0; i < Math.min(3, wb.worksheets.length); i++) {
      const ws = wb.worksheets[i];
      console.log(`\n--- Hoja ${i + 1}: "${ws.name}" ---`);
      console.log(`Filas: ${ws.rowCount}, Columnas: ${ws.columnCount}`);

      // Mostrar primeras 15 filas
      for (let r = 1; r <= Math.min(15, ws.rowCount); r++) {
        const row = ws.getRow(r);
        const cells = [];
        for (let c = 1; c <= Math.min(ws.columnCount, 10); c++) {
          const cell = row.getCell(c);
          let val = cell.value;
          if (val instanceof Date) val = val.toLocaleDateString('es-MX');
          if (typeof val === 'object' && val?.text) val = val.text;
          if (typeof val === 'object' && val?.result) val = val.result;
          val = val === null || val === undefined ? '' : String(val).slice(0, 40);
          cells.push(val);
        }
        console.log(`  R${r}: ${cells.join(' | ')}`);
      }

      // Si hay muchas filas, mostrar últimas 5
      if (ws.rowCount > 15) {
        console.log('  ...');
        for (let r = Math.max(16, ws.rowCount - 4); r <= ws.rowCount; r++) {
          const row = ws.getRow(r);
          const cells = [];
          for (let c = 1; c <= Math.min(ws.columnCount, 10); c++) {
            const cell = row.getCell(c);
            let val = cell.value;
            if (val instanceof Date) val = val.toLocaleDateString('es-MX');
            if (typeof val === 'object' && val?.text) val = val.text;
            if (typeof val === 'object' && val?.result) val = val.result;
            val = val === null || val === undefined ? '' : String(val).slice(0, 40);
            cells.push(val);
          }
          console.log(`  R${r}: ${cells.join(' | ')}`);
        }
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
