/**
 * Procesa ambos archivos Excel, sube TODOS los movimientos a BD,
 * cruza con CFDIs y genera reporte profesional en Excel.
 * 
 * Ejecutar con: npx tsx scripts/reporte-completo-bancos.ts
 */
import { PrismaClient } from '@prisma/client';
import ExcelJS from 'exceljs';
import * as fs from 'fs';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

function parseNumberFromCell(value: any): number {
  if (value === null || value === undefined || value === '' || value === '-') return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[$,\s]/g, '').replace(/[^0-9.-]/g, '');
    return parseFloat(cleaned) || 0;
  }
  if (typeof value === 'object' && 'result' in value) return parseFloat(String(value.result)) || 0;
  return 0;
}

interface Movimiento {
  fecha: Date;
  concepto: string;
  monto: number;
  saldo?: number;
  banco: string;
  cuentaNumero: string;
}

async function leerSantander(archivo: string): Promise<Movimiento[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(archivo);
  const ws = wb.worksheets[0];
  const movs: Movimiento[] = [];

  for (let r = 2; r <= 232; r++) {
    const fila = ws.getRow(r);
    const fechaRaw = fila.getCell(2).value;
    if (!fechaRaw) continue;

    const fechaLimpia = String(fechaRaw).replace(/['"]/g, '').trim();
    if (!fechaLimpia.match(/^\d{8}$/)) continue;

    const dia = parseInt(fechaLimpia.slice(0, 2));
    const mes = parseInt(fechaLimpia.slice(2, 4));
    const anio = parseInt(fechaLimpia.slice(4, 8));
    const fecha = new Date(anio, mes - 1, dia, 12, 0, 0);

    const signo = String(fila.getCell(6).value || '').trim();
    const importe = parseNumberFromCell(fila.getCell(7).value);
    const saldo = parseNumberFromCell(fila.getCell(8).value);
    const descripcion = String(fila.getCell(5).value || '').trim();
    const concepto = String(fila.getCell(10).value || '').trim();
    const conceptoFull = concepto ? `${descripcion} — ${concepto}`.slice(0, 500) : descripcion;

    let monto = 0;
    if (signo === '+') monto = Math.abs(importe);
    else if (signo === '-') monto = -Math.abs(importe);
    else monto = importe;

    if (Math.abs(monto) < 0.5) continue;

    movs.push({ fecha, concepto: conceptoFull, monto, saldo, banco: 'SANTANDER', cuentaNumero: '65-50908535-6' });
  }
  return movs;
}

async function leerBanorte(archivo: string): Promise<Movimiento[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(archivo);
  const movs: Movimiento[] = [];

  for (let h = 0; h < wb.worksheets.length; h++) {
    const ws = wb.worksheets[h];
    const maxRow = h === 0 ? 625 : 43;

    let colFecha, colDeposito, colRetiro, colConcepto;
    if (h === 0) {
      colFecha = 2; colDeposito = 8; colRetiro = 9; colConcepto = 5;
    } else {
      colFecha = 1; colDeposito = 2; colRetiro = 3; colConcepto = 5;
    }

    for (let r = 2; r <= maxRow; r++) {
      const fila = ws.getRow(r);
      const fechaCell = fila.getCell(colFecha).value;
      if (!fechaCell) continue;

      let fecha: Date | null = null;
      if (fechaCell instanceof Date) fecha = fechaCell;
      else if (typeof fechaCell === 'number') fecha = new Date(Date.UTC(1899, 11, 30) + fechaCell * 24 * 60 * 60 * 1000);
      else if (typeof fechaCell === 'string') {
        const limpia = fechaCell.replace(/['"]/g, '').trim();
        if (limpia.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
          const partes = limpia.split('/');
          const p1 = parseInt(partes[0]), p2 = parseInt(partes[1]), anio = parseInt(partes[2]);
          fecha = new Date(anio, p2 - 1, p1, 12, 0, 0);
        }
      }
      if (!fecha || isNaN(fecha.getTime())) continue;

      const deposito = parseNumberFromCell(fila.getCell(colDeposito).value);
      const retiro = parseNumberFromCell(fila.getCell(colRetiro).value);
      const monto = deposito - retiro;
      if (Math.abs(monto) < 0.5) continue;

      const concepto = String(fila.getCell(colConcepto).value || 'Movimiento').trim();
      movs.push({
        fecha, concepto, monto,
        banco: 'BANORTE',
        cuentaNumero: h === 0 ? '1282396470' : '1282397637',
      });
    }
  }
  return movs;
}

async function main() {
  console.log('📊 REPORTE COMPLETO BANCOS + CFDIs\n');
  console.log('='.repeat(80));

  // 1. Leer archivos
  console.log('\n📥 Leyendo Santander...');
  const movsSantander = await leerSantander('/home/z/my-project/upload/SALDO SANTANDER $14,755.13.xlsx');
  console.log(`  ✅ ${movsSantander.length} movimientos`);

  console.log('\n📥 Leyendo Banorte...');
  const movsBanorte = await leerBanorte('/home/z/my-project/upload/SALDO BANORTE $53,756.17.xlsx');
  console.log(`  ✅ ${movsBanorte.length} movimientos`);

  const todosMovs = [...movsSantander, ...movsBanorte];
  console.log(`\n📊 Total movimientos: ${todosMovs.length}`);

  // 2. Buscar/crear cuentas en BD
  const empresa = await db.empresa.findFirst({ where: { rfc: 'ALO980508ID6' } });
  if (!empresa) { console.error('❌ No se encontró ELECTRONICMA'); return; }

  let cuentaBanorte = await db.cuentaBancaria.findFirst({ where: { empresaId: empresa.id, cuenta: { contains: '1282396470' } } });
  if (!cuentaBanorte) {
    cuentaBanorte = await db.cuentaBancaria.create({ data: { banco: 'BANORTE', cuenta: '1282396470', saldo: 0, tipo: 'operaciones', empresaId: empresa.id } });
  }

  let cuentaSantander = await db.cuentaBancaria.findFirst({ where: { empresaId: empresa.id, cuenta: { contains: '65-50908535-6' } } });
  if (!cuentaSantander) {
    cuentaSantander = await db.cuentaBancaria.create({ data: { banco: 'SANTANDER', cuenta: '65-50908535-6', saldo: 0, tipo: 'operaciones', empresaId: empresa.id } });
  }

  // 3. Borrar movimientos existentes
  console.log('\n🧹 Borrando movimientos existentes...');
  await db.movimientoBanco.deleteMany({ where: { cuentaId: cuentaBanorte.id } });
  await db.movimientoBanco.deleteMany({ where: { cuentaId: cuentaSantander.id } });
  console.log('  ✅ Borrados');

  // 4. Subir movimientos
  console.log('\n📤 Subiendo movimientos a BD...');
  let creados = 0;
  for (const mov of todosMovs) {
    const cuentaId = mov.banco === 'SANTANDER' ? cuentaSantander.id : cuentaBanorte.id;
    await db.movimientoBanco.create({
      data: {
        fecha: mov.fecha,
        concepto: mov.concepto.slice(0, 300),
        monto: mov.monto,
        tipo: mov.monto > 0 ? 'ingreso' : 'egreso',
        estado: 'conciliado',
        cuentaId,
      },
    });
    creados++;
  }
  console.log(`  ✅ ${creados} movimientos subidos`);

  // 5. Actualizar saldos
  const saldoBanorte = movsBanorte.reduce((s, m) => s + m.monto, 0);
  const saldoSantander = movsSantander.reduce((s, m) => s + m.monto, 0);
  await db.cuentaBancaria.update({ where: { id: cuentaBanorte.id }, data: { saldo: saldoBanorte } });
  await db.cuentaBancaria.update({ where: { id: cuentaSantander.id }, data: { saldo: saldoSantander } });
  console.log(`\n💰 Saldo Banorte: $${saldoBanorte.toFixed(2)}`);
  console.log(`💰 Saldo Santander: $${saldoSantander.toFixed(2)}`);
  console.log(`💰 Saldo Total: $${(saldoBanorte + saldoSantander).toFixed(2)}`);

  // 6. Obtener CFDIs para cruce
  console.log('\n📋 Obteniendo CFDIs para cruce...');
  const facturasEmitidas = await db.factura.findMany({
    where: { empresaId: empresa.id, direccion: 'emitida', estado: 'timbrada' },
    select: { id: true, folio: true, serie: true, fecha: true, total: true, receptorRfc: true, receptorNombre: true, concepto: true, tipoComprobante: true },
  });
  const facturasRecibidas = await db.factura.findMany({
    where: { empresaId: empresa.id, direccion: 'recibida', estado: 'timbrada' },
    select: { id: true, folio: true, serie: true, fecha: true, total: true, emisorRfc: true, emisorNombre: true, concepto: true, tipoComprobante: true },
  });
  console.log(`  Facturas emitidas: ${facturasEmitidas.length}`);
  console.log(`  Facturas recibidas: ${facturasRecibidas.length}`);

  // 7. Cruzar movimientos con CFDIs
  console.log('\n🔗 Cruzando movimientos con CFDIs...');
  const TOLERANCIA_MONTO = 0.02; // 2%
  const TOLERANCIA_FECHA_DIAS = 5;

  const resultadosConciliacion: any[] = [];
  let conciliados = 0;
  let sinMatch = 0;

  for (const mov of todosMovs) {
    const montoAbs = Math.abs(mov.monto);
    const montoMin = montoAbs * (1 - TOLERANCIA_MONTO);
    const montoMax = montoAbs * (1 + TOLERANCIA_MONTO);
    const esDeposito = mov.monto > 0;

    // Buscar facturas que coincidan
    const facturas = esDeposito ? facturasEmitidas : facturasRecibidas;
    const matches = facturas.filter(f => {
      if (f.tipoComprobante !== 'I') return false;
      if (f.total < montoMin || f.total > montoMax) return false;
      const diasDiff = Math.abs(f.fecha.getTime() - mov.fecha.getTime()) / (1000 * 60 * 60 * 24);
      return diasDiff <= TOLERANCIA_FECHA_DIAS;
    });

    if (matches.length === 1) {
      conciliados++;
      resultadosConciliacion.push({
        fecha: mov.fecha,
        banco: mov.banco,
        concepto: mov.concepto,
        monto: mov.monto,
        estado: 'CONCILIADO',
        facturaFolio: `${matches[0].serie || ''}${matches[0].folio}`,
        facturaTotal: matches[0].total,
        facturaNombre: esDeposito ? matches[0].receptorNombre : matches[0].emisorNombre,
        facturaRFC: esDeposito ? matches[0].receptorRfc : matches[0].emisorRfc,
      });
    } else if (matches.length > 1) {
      sinMatch++;
      resultadosConciliacion.push({
        fecha: mov.fecha,
        banco: mov.banco,
        concepto: mov.concepto,
        monto: mov.monto,
        estado: 'MULTIPLES_MATCHES',
        facturaFolio: `${matches.length} facturas similares`,
        facturaTotal: matches[0].total,
        facturaNombre: esDeposito ? matches[0].receptorNombre : matches[0].emisorNombre,
        facturaRFC: '',
      });
    } else {
      sinMatch++;
      resultadosConciliacion.push({
        fecha: mov.fecha,
        banco: mov.banco,
        concepto: mov.concepto,
        monto: mov.monto,
        estado: 'SIN_FACTURA',
        facturaFolio: '',
        facturaTotal: 0,
        facturaNombre: '',
        facturaRFC: '',
      });
    }
  }

  console.log(`  ✅ Conciliados: ${conciliados}`);
  console.log(`  ⚠️ Sin match: ${sinMatch}`);

  // 8. Generar Excel profesional
  console.log('\n📊 Generando Excel profesional...');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sistema Fiscal IA';
  wb.created = new Date();

  // ===== HOJA 1: RESUMEN EJECUTIVO =====
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
  ws1.getCell('A3').font = { italic: true, size: 10 };
  ws1.getCell('A3').alignment = { horizontal: 'center' };

  let r = 5;
  const addRow = (label: string, val1: any, val2?: any, val3?: any, esHeader = false, esTotal = false) => {
    ws1.getCell(`A${r}`).value = label;
    ws1.getCell(`B${r}`).value = val1;
    ws1.getCell(`C${r}`).value = val2;
    ws1.getCell(`D${r}`).value = val3;
    [1, 2, 3].forEach(i => {
      const cell = ws1.getCell(`${String.fromCharCode(65 + i)}${r}`);
      if (typeof (cell.value) === 'number') cell.numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
    });
    if (esHeader) {
      ws1.getRow(r).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws1.getRow(r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    }
    if (esTotal) {
      ws1.getRow(r).font = { bold: true };
      ws1.getRow(r).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    }
    r++;
  };

  addRow('CONCEPTO', 'BANORTE', 'SANTANDER', 'TOTAL', true);

  const ingB = movsBanorte.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
  const ingS = movsSantander.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
  const egrB = movsBanorte.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);
  const egrS = movsSantander.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);

  addRow('Movimientos totales', movsBanorte.length, movsSantander.length, todosMovs.length);
  addRow('Ingresos (depósitos)', ingB, ingS, ingB + ingS);
  addRow('Egresos (retiros)', -egrB, -egrS, -(egrB + egrS));
  addRow('Flujo neto', saldoBanorte, saldoSantander, saldoBanorte + saldoSantander, false, true);
  r++;

  addRow('CONCILIACIÓN CON CFDIs', '', '', '', true);
  addRow('Facturas emitidas en sistema', '', '', facturasEmitidas.length);
  addRow('Facturas recibidas en sistema', '', '', facturasRecibidas.length);
  addRow('Movimientos conciliados con factura', '', '', conciliados);
  addRow('Movimientos sin factura asociada', '', '', sinMatch);
  const tasaConc = todosMovs.length > 0 ? (conciliados / todosMovs.length * 100).toFixed(1) : '0';
  addRow('Tasa de conciliación', '', '', `${tasaConc}%`);
  r++;

  addRow('INDICADORES FINANCIEROS', '', '', '', true);
  const totalIngresos = ingB + ingS;
  const totalEgresos = egrB + egrS;
  addRow('Total ingresos bancarios', '', '', totalIngresos);
  addRow('Total egresos bancarios', '', '', -totalEgresos);
  addRow('Flujo neto total', '', '', totalIngresos - totalEgresos, false, true);
  addRow('Total facturas emitidas (ventas)', '', '', facturasEmitidas.filter(f => f.tipoComprobante === 'I').reduce((s, f) => s + f.total, 0));
  addRow('Total facturas recibidas (compras)', '', '', facturasRecibidas.filter(f => f.tipoComprobante === 'I').reduce((s, f) => s + f.total, 0));
  const totalVentas = facturasEmitidas.filter(f => f.tipoComprobante === 'I').reduce((s, f) => s + f.total, 0);
  const totalCompras = facturasRecibidas.filter(f => f.tipoComprobante === 'I').reduce((s, f) => s + f.total, 0);
  addRow('Utilidad bruta (ventas - compras)', '', '', totalVentas - totalCompras, false, true);
  addRow('Margen de utilidad', '', '', totalVentas > 0 ? `${((totalVentas - totalCompras) / totalVentas * 100).toFixed(1)}%` : 'N/A');

  // ===== HOJA 2: CONCILIACIÓN DETALLADA =====
  const ws2 = wb.addWorksheet('🔗 Conciliación CFDIs');
  ws2.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Banco', key: 'banco', width: 12 },
    { header: 'Tipo', key: 'tipo', width: 10 },
    { header: 'Concepto', key: 'concepto', width: 45 },
    { header: 'Monto', key: 'monto', width: 14 },
    { header: 'Estado', key: 'estado', width: 18 },
    { header: 'Factura', key: 'facturaFolio', width: 14 },
    { header: 'Factura Total', key: 'facturaTotal', width: 14 },
    { header: 'Cliente/Proveedor', key: 'facturaNombre', width: 30 },
  ];
  ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };

  // Ordenar por fecha
  resultadosConciliacion.sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  for (const res of resultadosConciliacion) {
    const row = ws2.addRow({
      ...res,
      fecha: res.fecha.toLocaleDateString('es-MX'),
      tipo: res.monto > 0 ? 'Depósito' : 'Pago',
    });
    row.getCell(5).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
    row.getCell(8).numFmt = '"$"#,##0.00';

    // Color por estado
    if (res.estado === 'CONCILIADO') {
      row.getCell(6).font = { color: { argb: 'FF10B981' }, bold: true };
    } else if (res.estado === 'SIN_FACTURA') {
      row.getCell(6).font = { color: { argb: 'FFEF4444' }, bold: true };
    } else {
      row.getCell(6).font = { color: { argb: 'FFF97316' }, bold: true };
    }
  }

  // ===== HOJA 3: ANÁLISIS FINANCIERO PROFUNDO =====
  const ws3 = wb.addWorksheet('📈 Análisis Financiero', { views: [{ showGridLines: false }] });
  ws3.columns = [{ width: 50 }, { width: 20 }, { width: 50 }];

  ws3.mergeCells('A1:C1');
  ws3.getCell('A1').value = 'ANÁLISIS FINANCIERO PROFESIONAL';
  ws3.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF7C3AED' } };

  let r3 = 3;
  const addFin = (label: string, valor: any, obs: string, esHeader = false) => {
    ws3.getCell(`A${r3}`).value = label;
    ws3.getCell(`B${r3}`).value = valor;
    ws3.getCell(`C${r3}`).value = obs;
    if (typeof valor === 'number') ws3.getCell(`B${r3}`).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
    if (esHeader) {
      ws3.getRow(r3).font = { bold: true, color: { argb: 'FFFFFFFF' } };
      ws3.getRow(r3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    }
    r3++;
  };

  addFin('INDICADOR', 'VALOR', 'OBSERVACIÓN', true);

  // Liquidez
  const saldoTotal = saldoBanorte + saldoSantander;
  const promedioMensualEgresos = totalEgresos / 8; // 8 meses
  const mesesReserva = promedioMensualEgresos > 0 ? saldoTotal / promedioMensualEgresos : 0;

  addFin('SALDO TOTAL EN BANCOS', saldoTotal, mesesReserva > 2 ? '✅ Liquidez adecuada (>2 meses de reserva)' : '⚠️ Liquidez baja (<2 meses de reserva)');

  // Flujo mensual
  const flujoNeto = totalIngresos - totalEgresos;
  addFin('FLUJO NETO ENE-AGO 2026', flujoNeto, flujoNeto > 0 ? '✅ Flujo positivo' : '⚠️ Flujo negativo');

  // Margen
  const margen = totalVentas > 0 ? ((totalVentas - totalCompras) / totalVentas * 100) : 0;
  addFin('MARGEN BRUTO (Ventas-Compras)', `${margen.toFixed(1)}%`, margen > 30 ? '✅ Margen saludable' : margen > 15 ? '⚠️ Margen aceptable' : '⚠️ Margen bajo');

  // Conciliación
  addFin('TASA CONCILIACIÓN BANCO-CFDI', `${tasaConc}%`, parseFloat(tasaConc) > 70 ? '✅ Buena conciliación' : '⚠️ Muchos movimientos sin factura');

  // Concentración
  addFin('CONCENTRACIÓN DE INGRESOS', `${(movsBanorte.length / todosMovs.length * 100).toFixed(0)}% Banorte`, 'Diversificación bancaria recomendada');

  r3++;
  addFin('OBSERVACIONES Y RECOMENDACIONES', '', '', true);

  const observaciones = [
    `1. LIQUIDEZ: El saldo total de $${saldoTotal.toFixed(2)} representa ${mesesReserva.toFixed(1)} meses de egresos. ${mesesReserva > 2 ? 'Es adecuado.' : 'Se recomienda aumentar reservas.'}`,
    `2. FLUJO DE EFECTIVO: ${flujoNeto > 0 ? 'Positivo' : 'Negativo'} en $${Math.abs(flujoNeto).toFixed(2)}. ${flujoNeto > 0 ? 'El negocio genera efectivo.' : 'Revisar gastos no esenciales.'}`,
    `3. CONCILIACIÓN: ${conciliados} de ${todosMovs.length} movimientos están conciliados con facturas (${tasaConc}%). Los ${sinMatch} movimientos sin factura requieren revisión.`,
    `4. MARGEN: El margen bruto es ${margen.toFixed(1)}%. ${margen > 30 ? 'Excelente.' : margen > 15 ? 'Aceptable, pero mejorable.' : 'Bajo, revisar estructura de costos.'}`,
    `5. DISTRIBUCIÓN: Banorte concentra la mayoría de movimientos. Considerar diversificar banking.`,
    `6. FACTURACIÓN: ${facturasEmitidas.length} facturas emitidas vs ${facturasRecibidas.length} recibidas. Ratio de ${facturasRecibidas.length > 0 ? (facturasEmitidas.length / facturasRecibidas.length).toFixed(2) : 'N/A'}:1.`,
    `7. RECOMENDACIÓN: Implementar conciliación automática mensual para mantener tasa >80%.`,
    `8. RECOMENDACIÓN: Los movimientos sin factura deben revisarse para asegurar deducibilidad fiscal.`,
    `9. RECOMENDACIÓN: Mantener reserva mínima de 2 meses de egresos ($${(promedioMensualEgresos * 2).toFixed(2)}).`,
    `10. RECOMENDACIÓN: Considerar cuenta de inversión para excedentes de tesorería.`,
  ];

  for (const obs of observaciones) {
    ws3.mergeCells(`A${r3}:C${r3}`);
    ws3.getCell(`A${r3}`).value = obs;
    ws3.getCell(`A${r3}`).alignment = { horizontal: 'left', wrapText: true };
    ws3.getRow(r3).height = 30;
    r3++;
  }

  // ===== HOJA 4: MOVIMIENTOS BANORTE =====
  const ws4 = wb.addWorksheet('🏦 Banorte Detalle');
  ws4.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Tipo', key: 'tipo', width: 10 },
    { header: 'Concepto', key: 'concepto', width: 50 },
    { header: 'Monto', key: 'monto', width: 14 },
  ];
  ws4.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws4.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10B981' } };

  movsBanorte.sort((a, b) => a.fecha.getTime() - b.fecha.getTime()).forEach(m => {
    const row = ws4.addRow({
      fecha: m.fecha.toLocaleDateString('es-MX'),
      tipo: m.monto > 0 ? 'Depósito' : 'Pago',
      concepto: m.concepto,
      monto: m.monto,
    });
    row.getCell(4).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
  });

  // ===== HOJA 5: MOVIMIENTOS SANTANDER =====
  const ws5 = wb.addWorksheet('🏛️ Santander Detalle');
  ws5.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Tipo', key: 'tipo', width: 10 },
    { header: 'Concepto', key: 'concepto', width: 50 },
    { header: 'Monto', key: 'monto', width: 14 },
  ];
  ws5.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws5.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEF4444' } };

  movsSantander.sort((a, b) => a.fecha.getTime() - b.fecha.getTime()).forEach(m => {
    const row = ws5.addRow({
      fecha: m.fecha.toLocaleDateString('es-MX'),
      tipo: m.monto > 0 ? 'Depósito' : 'Pago',
      concepto: m.concepto,
      monto: m.monto,
    });
    row.getCell(4).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
  });

  // Guardar
  const outputPath = '/home/z/my-project/download/Reporte_Integral_Bancos_CFDIs.xlsx';
  const buffer = await wb.xlsx.writeBuffer();
  fs.writeFileSync(outputPath, buffer);

  console.log(`\n✅ Reporte generado: ${outputPath}`);
  console.log(`📊 ${resultadosConciliacion.length} movimientos analizados`);
  console.log(`🔗 ${conciliados} conciliados, ${sinMatch} sin factura`);
  console.log(`💰 Saldo total: $${(saldoBanorte + saldoSantander).toFixed(2)}`);
}

main()
  .catch(e => { console.error('❌', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
