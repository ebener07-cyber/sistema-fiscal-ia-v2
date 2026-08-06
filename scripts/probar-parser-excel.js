/**
 * Probar parser Excel actualizado con los 2 archivos de saldos
 */
const ExcelJS = require('exceljs');

function parseNumberFromCell(value) {
  if (value === null || value === undefined || value === '' || value === '-') return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,\s]/g, '').replace(/[^0-9.-]/g, '');
    return parseFloat(cleaned) || 0;
  }
  if (typeof value === 'object' && 'result' in value) {
    return parseFloat(String(value.result)) || 0;
  }
  return 0;
}

async function parseExcel(archivo) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(archivo);
  const movimientos = [];

  for (const ws of wb.worksheets) {
    let headerRow = 1;
    const headers = [];
    for (let r = 1; r <= Math.min(10, ws.rowCount); r++) {
      const fila = ws.getRow(r);
      const tempHeaders = [];
      fila.eachCell((cell, col) => {
        tempHeaders[col] = String(cell.value || '').toLowerCase().trim();
      });
      const joined = tempHeaders.join('|');
      if (joined.includes('fecha') && (joined.includes('descripci') || joined.includes('concepto') || joined.includes('descrip'))) {
        for (let c = 1; c <= tempHeaders.length; c++) headers[c] = tempHeaders[c];
        headerRow = r;
        break;
      }
    }
    if (headers.length === 0) {
      const primeraFila = ws.getRow(1);
      primeraFila.eachCell((cell, col) => {
        headers[col] = String(cell.value || '').toLowerCase().trim();
      });
    }

    let colFecha = 1, colConcepto = 2, colDeposito = 0, colRetiro = 0, colMonto = 0;
    let colDescripcionDetallada = 0, colReferencia = 0, colCargoAbono = 0, colImporte = 0;

    for (let c = 1; c <= Math.max(headers.length, 20); c++) {
      const h = headers[c] || '';
      if (h === 'fecha') colFecha = c;
      else if (h.includes('fecha de operaci') || h.includes('fecha operacion')) colFecha = c;
      else if (h.includes('fecha')) colFecha = c;
      if (h === 'descripcion' || h === 'descripción') colConcepto = c;
      else if (h === 'concepto') colDescripcionDetallada = c;
      else if (h.includes('descrip') && !colConcepto) colConcepto = c;
      else if (h.includes('detalle') || h.includes('descripción detallada') || h.includes('descripcion detallada')) colDescripcionDetallada = c;
      if (h.includes('cargo/abono') || h.includes('cargo abono') || h === 'cargo/abono') colCargoAbono = c;
      if (h === 'importe') colImporte = c;
      if (h.includes('referencia') && !h.includes('descripcion')) colReferencia = c;
      if ((h.includes('depósito') || h.includes('deposito') || h.includes('abono') || h.includes('crédito') || h.includes('credito') || h.includes('ingreso')) && !h.includes('cargo/abono') && !h.includes('cargo abono')) colDeposito = c;
      if ((h.includes('retiro') || h.includes('cargo') || h.includes('débito') || h.includes('debito') || h.includes('egreso')) && !h.includes('cargo/abono') && !h.includes('cargo abono')) colRetiro = c;
      if (h.includes('monto') || h.includes('amount') || h.includes('movimiento')) colMonto = c;
    }

    console.log(`  Hoja: "${ws.name}"`);
    console.log(`  Columnas detectadas: fecha=${colFecha}, concepto=${colConcepto}, deposito=${colDeposito}, retiro=${colRetiro}, cargoAbono=${colCargoAbono}, importe=${colImporte}, descripcionDetallada=${colDescripcionDetallada}, referencia=${colReferencia}`);

    const filaInicio = headerRow + 1;
    let count = 0;
    for (let r = filaInicio; r <= ws.rowCount && count < 10; r++) {
      const fila = ws.getRow(r);
      try {
        const cellFecha = fila.getCell(colFecha).value;
        if (!cellFecha) continue;
        let fecha = null;
        if (cellFecha instanceof Date) fecha = cellFecha;
        else if (typeof cellFecha === 'number') fecha = new Date(Date.UTC(1899, 11, 30) + cellFecha * 24 * 60 * 60 * 1000);
        else if (typeof cellFecha === 'string') {
          const fechaLimpia = cellFecha.replace(/['"]/g, '').trim();
          if (fechaLimpia.match(/^\d{8}$/)) {
            const dia = parseInt(fechaLimpia.slice(0, 2));
            const mes = parseInt(fechaLimpia.slice(2, 4));
            const anio = parseInt(fechaLimpia.slice(4, 8));
            fecha = new Date(anio, mes - 1, dia, 12, 0, 0);
          } else if (fechaLimpia.match(/^\d{4}-\d{2}-\d{2}/)) fecha = new Date(fechaLimpia);
          else if (fechaLimpia.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
            const partes = fechaLimpia.split('/');
            const p1 = parseInt(partes[0]), p2 = parseInt(partes[1]), anio = parseInt(partes[2]);
            if (p1 > 12) fecha = new Date(anio, p2 - 1, p1, 12, 0, 0);
            else if (p2 > 12) fecha = new Date(anio, p1 - 1, p2, 12, 0, 0);
            else fecha = new Date(anio, p2 - 1, p1, 12, 0, 0);
          }
        }
        if (!fecha || isNaN(fecha.getTime())) continue;

        const conceptoBase = String(fila.getCell(colConcepto).value || 'Movimiento').trim();
        let concepto = conceptoBase;
        if (colDescripcionDetallada) {
          const detalle = String(fila.getCell(colDescripcionDetallada).value || '').trim();
          if (detalle && detalle !== '-' && detalle !== conceptoBase) concepto = `${conceptoBase} — ${detalle}`.slice(0, 500);
        }
        if (colReferencia) {
          const ref = String(fila.getCell(colReferencia).value || '').trim();
          if (ref && ref !== '-' && ref !== '0') concepto = `Ref: ${ref} · ${concepto}`.slice(0, 500);
        }

        let monto = 0;
        if (colCargoAbono && colImporte) {
          const signo = String(fila.getCell(colCargoAbono).value || '').trim();
          const importe = parseNumberFromCell(fila.getCell(colImporte).value);
          if (signo === '+') monto = Math.abs(importe);
          else if (signo === '-') monto = -Math.abs(importe);
          else monto = importe;
        } else if (colDeposito || colRetiro) {
          let deposito = 0, retiro = 0;
          if (colDeposito) deposito = parseNumberFromCell(fila.getCell(colDeposito).value);
          if (colRetiro) retiro = parseNumberFromCell(fila.getCell(colRetiro).value);
          monto = deposito - retiro;
        } else if (colMonto) monto = parseNumberFromCell(fila.getCell(colMonto).value);

        if (monto === 0) continue;
        movimientos.push({ fecha, concepto, monto });
        count++;
        console.log(`    R${r}: ${fecha.toISOString().slice(0,10)} | ${monto >= 0 ? '+' : ''}$${monto.toFixed(2)} | ${concepto.slice(0, 80)}`);
      } catch (e) { continue; }
    }
  }
  return movimientos;
}

async function main() {
  const archivos = [
    '/home/z/my-project/upload/SALDO SANTANDER $14,755.13.xlsx',
    '/home/z/my-project/upload/SALDO BANORTE $53,756.17.xlsx',
  ];

  for (const archivo of archivos) {
    console.log('\n' + '='.repeat(80));
    console.log(`📄 ${archivo.split('/').pop()}`);
    console.log('='.repeat(80));
    const movs = await parseExcel(archivo);
    console.log(`\n✅ Total movimientos detectados: ${movs.length}`);
    if (movs.length > 0) {
      const ingresos = movs.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
      const egresos = movs.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);
      console.log(`💰 Ingresos: $${ingresos.toFixed(2)} | Egresos: $${egresos.toFixed(2)} | Neto: $${(ingresos-egresos).toFixed(2)}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
