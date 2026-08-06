const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
const fs = require('fs');

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

async function main() {
  console.log('📊 Generando reporte profesional...\n');

  const empresa = await db.empresa.findFirst({ where: { rfc: 'ALO980508ID6' } });

  // Obtener movimientos
  const movs = await db.movimientoBanco.findMany({
    where: { cuenta: { empresaId: empresa.id } },
    include: { cuenta: { select: { banco: true, cuenta: true } } },
    orderBy: { fecha: 'asc' },
  });

  // Obtener CFDIs
  const facturasEmitidas = await db.factura.findMany({
    where: { empresaId: empresa.id, direccion: 'emitida', estado: 'timbrada', tipoComprobante: 'I' },
    select: { id: true, folio: true, serie: true, fecha: true, total: true, receptorRfc: true, receptorNombre: true },
  });
  const facturasRecibidas = await db.factura.findMany({
    where: { empresaId: empresa.id, direccion: 'recibida', estado: 'timbrada', tipoComprobante: 'I' },
    select: { id: true, folio: true, serie: true, fecha: true, total: true, emisorRfc: true, emisorNombre: true },
  });

  console.log(`Movimientos: ${movs.length}, Emitidas: ${facturasEmitidas.length}, Recibidas: ${facturasRecibidas.length}`);

  // Cruzar
  const TOL_MONTO = 0.02, TOL_FECHA = 5;
  const resultados = [];
  let conciliados = 0, sinMatch = 0;

  for (const mov of movs) {
    const montoAbs = Math.abs(mov.monto);
    const min = montoAbs * (1 - TOL_MONTO), max = montoAbs * (1 + TOL_MONTO);
    const esDep = mov.monto > 0;
    const facturas = esDep ? facturasEmitidas : facturasRecibidas;
    const matches = facturas.filter(f => {
      if (f.total < min || f.total > max) return false;
      const dias = Math.abs(f.fecha.getTime() - mov.fecha.getTime()) / 86400000;
      return dias <= TOL_FECHA;
    });

    if (matches.length >= 1) {
      conciliados++;
      resultados.push({
        fecha: mov.fecha, banco: mov.cuenta.banco, concepto: mov.concepto, monto: mov.monto,
        estado: matches.length === 1 ? 'CONCILIADO' : 'MULTIPLES',
        facturaFolio: `${matches[0].serie || ''}${matches[0].folio}`,
        facturaTotal: matches[0].total,
        facturaNombre: esDep ? matches[0].receptorNombre : matches[0].emisorNombre,
      });
    } else {
      sinMatch++;
      resultados.push({
        fecha: mov.fecha, banco: mov.cuenta.banco, concepto: mov.concepto, monto: mov.monto,
        estado: 'SIN_FACTURA', facturaFolio: '', facturaTotal: 0, facturaNombre: '',
      });
    }
  }

  // Totales
  const ingB = movs.filter(m => m.monto > 0 && m.cuenta.banco === 'BANORTE').reduce((s,m) => s + m.monto, 0);
  const ingS = movs.filter(m => m.monto > 0 && m.cuenta.banco === 'SANTANDER').reduce((s,m) => s + m.monto, 0);
  const egrB = movs.filter(m => m.monto < 0 && m.cuenta.banco === 'BANORTE').reduce((s,m) => s + Math.abs(m.monto), 0);
  const egrS = movs.filter(m => m.monto < 0 && m.cuenta.banco === 'SANTANDER').reduce((s,m) => s + Math.abs(m.monto), 0);
  const saldoB = ingB - egrB, saldoS = ingS - egrS;
  const totalIng = ingB + ingS, totalEgr = egrB + egrS;
  const totalVentas = facturasEmitidas.reduce((s,f) => s + f.total, 0);
  const totalCompras = facturasRecibidas.reduce((s,f) => s + f.total, 0);
  const utilidad = totalVentas - totalCompras;
  const margen = totalVentas > 0 ? (utilidad / totalVentas * 100) : 0;
  const tasaConc = movs.length > 0 ? (conciliados / movs.length * 100).toFixed(1) : '0';
  const mesesReserva = totalEgr > 0 ? (saldoB + saldoS) / (totalEgr / 8) : 0;

  // === CREAR EXCEL ===
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema Fiscal IA';

  // HOJA 1: RESUMEN
  const ws1 = wb.addWorksheet('📊 Resumen Ejecutivo', { views: [{ showGridLines: false }] });
  ws1.columns = [{ width: 45 }, { width: 20 }, { width: 20 }, { width: 20 }];
  ws1.mergeCells('A1:D1');
  ws1.getCell('A1').value = 'REPORTE FINANCIERO INTEGRAL — BANCOS + CFDIs';
  ws1.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF7C3AED' } };
  ws1.getCell('A1').alignment = { horizontal: 'center' };
  ws1.mergeCells('A2:D2');
  ws1.getCell('A2').value = `${empresa.nombre} | RFC: ${empresa.rfc}`;
  ws1.getCell('A2').font = { bold: true, size: 12 };
  ws1.getCell('A2').alignment = { horizontal: 'center' };
  ws1.mergeCells('A3:D3');
  ws1.getCell('A3').value = `Periodo: Enero - Agosto 2026 | Generado: ${new Date().toLocaleDateString('es-MX')}`;
  ws1.getCell('A3').font = { italic: true };
  ws1.getCell('A3').alignment = { horizontal: 'center' };

  let r = 5;
  const addR = (l, v1, v2, v3, h, t) => {
    ws1.getCell(`A${r}`).value = l; ws1.getCell(`B${r}`).value = v1; ws1.getCell(`C${r}`).value = v2; ws1.getCell(`D${r}`).value = v3;
    [1,2,3].forEach(i => { const c = ws1.getCell(`${String.fromCharCode(65+i)}${r}`); if (typeof c.value === 'number') c.numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)'; });
    if (h) { ws1.getRow(r).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws1.getRow(r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } }; }
    if (t) { ws1.getRow(r).font = { bold: true }; ws1.getRow(r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } }; }
    r++;
  };

  addR('CONCEPTO', 'BANORTE', 'SANTANDER', 'TOTAL', true);
  addR('Movimientos', movs.filter(m=>m.cuenta.banco==='BANORTE').length, movs.filter(m=>m.cuenta.banco==='SANTANDER').length, movs.length);
  addR('Ingresos', ingB, ingS, totalIng);
  addR('Egresos', -egrB, -egrS, -totalEgr);
  addR('FLUJO NETO', saldoB, saldoS, saldoB + saldoS, false, true);
  r++;
  addR('CONCILIACIÓN CFDI', '', '', '', true);
  addR('Facturas emitidas (ventas)', '', '', facturasEmitidas.length);
  addR('Facturas recibidas (compras)', '', '', facturasRecibidas.length);
  addR('Movimientos conciliados', '', '', conciliados);
  addR('Sin factura', '', '', sinMatch);
  addR('Tasa conciliación', '', '', `${tasaConc}%`);
  r++;
  addR('INDICADORES', '', '', '', true);
  addR('Total ventas (CFDIs emitidos)', '', '', totalVentas);
  addR('Total compras (CFDIs recibidos)', '', '', totalCompras);
  addR('Utilidad bruta', '', '', utilidad, false, true);
  addR('Margen de utilidad', '', '', `${margen.toFixed(1)}%`);
  addR('Meses de reserva', '', '', mesesReserva.toFixed(1));

  // HOJA 2: CONCILIACIÓN
  const ws2 = wb.addWorksheet('🔗 Conciliación CFDIs');
  ws2.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Banco', key: 'banco', width: 12 },
    { header: 'Tipo', key: 'tipo', width: 10 }, { header: 'Concepto', key: 'concepto', width: 45 },
    { header: 'Monto', key: 'monto', width: 14 }, { header: 'Estado', key: 'estado', width: 18 },
    { header: 'Factura', key: 'facturaFolio', width: 14 }, { header: 'Total Factura', key: 'facturaTotal', width: 14 },
    { header: 'Cliente/Proveedor', key: 'facturaNombre', width: 30 },
  ];
  ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
  resultados.forEach(res => {
    const row = ws2.addRow({ ...res, fecha: res.fecha.toLocaleDateString('es-MX'), tipo: res.monto > 0 ? 'Depósito' : 'Pago' });
    row.getCell(5).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
    row.getCell(8).numFmt = '"$"#,##0.00';
    if (res.estado === 'CONCILIADO') row.getCell(6).font = { color: { argb: 'FF10B981' }, bold: true };
    else if (res.estado === 'SIN_FACTURA') row.getCell(6).font = { color: { argb: 'FFEF4444' }, bold: true };
    else row.getCell(6).font = { color: { argb: 'FFF97316' }, bold: true };
  });

  // HOJA 3: ANÁLISIS FINANCIERO
  const ws3 = wb.addWorksheet('📈 Análisis Financiero', { views: [{ showGridLines: false }] });
  ws3.columns = [{ width: 50 }, { width: 22 }, { width: 55 }];
  ws3.mergeCells('A1:C1');
  ws3.getCell('A1').value = 'ANÁLISIS FINANCIERO PROFESIONAL';
  ws3.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF7C3AED' } };

  let r3 = 3;
  const addF = (l, v, o, h) => {
    ws3.getCell(`A${r3}`).value = l; ws3.getCell(`B${r3}`).value = v; ws3.getCell(`C${r3}`).value = o;
    if (typeof v === 'number') ws3.getCell(`B${r3}`).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
    if (h) { ws3.getRow(r3).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws3.getRow(r3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } }; }
    r3++;
  };

  addF('INDICADOR', 'VALOR', 'OBSERVACIÓN', true);
  addF('Saldo total en bancos', saldoB + saldoS, mesesReserva > 2 ? '✅ Liquidez adecuada' : '⚠️ Liquidez baja');
  addF('Flujo neto Ene-Ago', saldoB + saldoS, (saldoB + saldoS) > 0 ? '✅ Flujo positivo' : '⚠️ Flujo negativo');
  addF('Margen bruto', `${margen.toFixed(1)}%`, margen > 30 ? '✅ Excelente' : margen > 15 ? '⚠️ Aceptable' : '⚠️ Bajo');
  addF('Tasa conciliación', `${tasaConc}%`, parseFloat(tasaConc) > 70 ? '✅ Buena' : '⚠️ Revisar movimientos sin factura');
  addF('Meses de reserva', mesesReserva.toFixed(1), mesesReserva > 2 ? '✅ Adecuado' : '⚠️ Aumentar reservas');
  addF('Concentración Banorte', `${(movs.filter(m=>m.cuenta.banco==='BANORTE').length/movs.length*100).toFixed(0)}%`, 'Diversificación recomendada');

  r3++;
  addF('OBSERVACIONES Y RECOMENDACIONES', '', '', true);
  const obs = [
    `1. LIQUIDEZ: Saldo total $${(saldoB+saldoS).toFixed(2)} = ${mesesReserva.toFixed(1)} meses de egresos. ${mesesReserva > 2 ? 'Adecuado.' : 'Aumentar reservas.'}`,
    `2. FLUJO: ${saldoB+saldoS > 0 ? 'Positivo' : 'Negativo'} en $${Math.abs(saldoB+saldoS).toFixed(2)}. ${saldoB+saldoS > 0 ? 'Genera efectivo.' : 'Revisar gastos.'}`,
    `3. CONCILIACIÓN: ${conciliados}/${movs.length} movimientos conciliados (${tasaConc}%). ${sinMatch} sin factura requieren revisión.`,
    `4. MARGEN: ${margen.toFixed(1)}%. ${margen > 30 ? 'Excelente.' : margen > 15 ? 'Mejorable.' : 'Bajo, revisar costos.'}`,
    `5. FACTURACIÓN: ${facturasEmitidas.length} emitidas vs ${facturasRecibidas.length} recibidas.`,
    `6. RECOMENDACIÓN: Conciliación mensual automática para mantener tasa >80%.`,
    `7. RECOMENDACIÓN: Movimientos sin factura pueden NO ser deducibles fiscalmente.`,
    `8. RECOMENDACIÓN: Mantener reserva mínima de 2 meses ($${(totalEgr/8*2).toFixed(2)}).`,
    `9. RECOMENDACIÓN: Considerar cuenta inversión para excedentes.`,
    `10. RECOMENDACIÓN: Diversificar banking para reducir riesgo de concentración.`,
  ];
  obs.forEach(o => {
    ws3.mergeCells(`A${r3}:C${r3}`);
    ws3.getCell(`A${r3}`).value = o;
    ws3.getCell(`A${r3}`).alignment = { horizontal: 'left', wrapText: true };
    ws3.getRow(r3).height = 30;
    r3++;
  });

  // Guardar
  const out = '/home/z/my-project/download/Reporte_Integral_Bancos_CFDIs.xlsx';
  const buf = await wb.xlsx.writeBuffer();
  fs.writeFileSync(out, buf);
  console.log(`✅ Reporte: ${out}`);
  console.log(`📊 ${movs.length} movs | 🔗 ${conciliados} conciliados | ⚠️ ${sinMatch} sin factura`);
  console.log(`💰 Saldo: $${(saldoB+saldoS).toFixed(2)} | 📈 Margen: ${margen.toFixed(1)}% | 🛡️ Reserva: ${mesesReserva.toFixed(1)} meses`);

  await db.$disconnect();
}
main().catch(e => { console.error('❌', e); process.exit(1); });
