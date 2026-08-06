const { PrismaClient } = require('@prisma/client');
const ExcelJS = require('exceljs');
const fs = require('fs');

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

function parseNum(v) {
  if (v === null || v === undefined || v === '' || v === '-') return 0;
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const c = v.replace(/[$,\s]/g,'').replace(/[^0-9.-]/g,''); return parseFloat(c) || 0; }
  return 0;
}

async function main() {
  console.log('📊 Procesando ambos archivos Excel...\n');

  const empresa = await db.empresa.findFirst({ where: { rfc: 'ALO980508ID6' } });
  let cuentaB = await db.cuentaBancaria.findFirst({ where: { empresaId: empresa.id, cuenta: { contains: '1282396470' } } });
  if (!cuentaB) cuentaB = await db.cuentaBancaria.create({ data: { banco: 'BANORTE', cuenta: '1282396470', saldo: 0, tipo: 'operaciones', empresaId: empresa.id } });
  let cuentaS = await db.cuentaBancaria.findFirst({ where: { empresaId: empresa.id, cuenta: { contains: '65-50908535-6' } } });
  if (!cuentaS) cuentaS = await db.cuentaBancaria.create({ data: { banco: 'SANTANDER', cuenta: '65-50908535-6', saldo: 0, tipo: 'operaciones', empresaId: empresa.id } });

  // Borrar existentes
  console.log('🧹 Borrando movimientos existentes...');
  await db.movimientoBanco.deleteMany({ where: { cuentaId: cuentaB.id } });
  await db.movimientoBanco.deleteMany({ where: { cuentaId: cuentaS.id } });

  // === SANTANDER ===
  console.log('📥 Leyendo Santander...');
  const wbS = new ExcelJS.Workbook();
  await wbS.xlsx.readFile('/home/z/my-project/upload/SALDO SANTANDER $14,755.13.xlsx');
  const wsS = wbS.worksheets[0];
  const movsS = [];
  for (let r = 2; r <= 232; r++) {
    const f = wsS.getRow(r);
    const fr = f.getCell(2).value;
    if (!fr) continue;
    const fl = String(fr).replace(/['"]/g, '').trim();
    if (!fl.match(/^\d{8}$/)) continue;
    const dia = parseInt(fl.slice(0,2)), mes = parseInt(fl.slice(2,4)), anio = parseInt(fl.slice(4,8));
    const fecha = new Date(anio, mes-1, dia, 12, 0, 0);
    const signo = String(f.getCell(6).value || '').trim();
    const importe = parseNum(f.getCell(7).value);
    const desc = String(f.getCell(5).value || '').trim();
    const conc = String(f.getCell(10).value || '').trim();
    let monto = 0;
    if (signo === '+') monto = Math.abs(importe);
    else if (signo === '-') monto = -Math.abs(importe);
    if (Math.abs(monto) < 0.5) continue;
    movsS.push({ fecha, concepto: (conc ? `${desc} — ${conc}` : desc).slice(0,300), monto, tipo: monto > 0 ? 'ingreso' : 'egreso', estado: 'conciliado', cuentaId: cuentaS.id });
  }
  console.log(`  ${movsS.length} movimientos Santander`);

  // === BANORTE ===
  console.log('📥 Leyendo Banorte...');
  const wbB = new ExcelJS.Workbook();
  await wbB.xlsx.readFile('/home/z/my-project/upload/SALDO BANORTE $53,756.17.xlsx');
  const movsB = [];
  for (let h = 0; h < wbB.worksheets.length; h++) {
    const ws = wbB.worksheets[h];
    const maxRow = h === 0 ? 625 : 43;
    const colF = h === 0 ? 2 : 1, colD = h === 0 ? 8 : 2, colR = h === 0 ? 9 : 3, colC = h === 0 ? 5 : 5;
    for (let r = 2; r <= maxRow; r++) {
      const f = ws.getRow(r);
      const fc = f.getCell(colF).value;
      if (!fc) continue;
      let fecha = null;
      if (fc instanceof Date) fecha = fc;
      else if (typeof fc === 'number') fecha = new Date(Date.UTC(1899, 11, 30) + fc * 24*60*60*1000);
      else if (typeof fc === 'string') {
        const l = fc.replace(/['"]/g,'').trim();
        if (l.match(/^\d{1,2}\/\d{1,2}\/\d{4}$/)) {
          const p = l.split('/'); const p1=parseInt(p[0]),p2=parseInt(p[1]),a=parseInt(p[2]);
          fecha = new Date(a, p2-1, p1, 12, 0, 0);
        }
      }
      if (!fecha || isNaN(fecha.getTime())) continue;
      const dep = parseNum(f.getCell(colD).value);
      const ret = parseNum(f.getCell(colR).value);
      const monto = dep - ret;
      if (Math.abs(monto) < 0.5) continue;
      movsB.push({ fecha, concepto: String(f.getCell(colC).value || 'Movimiento').trim().slice(0,300), monto, tipo: monto > 0 ? 'ingreso' : 'egreso', estado: 'conciliado', cuentaId: cuentaB.id });
    }
  }
  console.log(`  ${movsB.length} movimientos Banorte`);

  // Insertar en lotes
  console.log('📤 Subiendo a BD en lotes...');
  // createMany con skipDuplicates
  const batchSize = 100;
  for (let i = 0; i < movsS.length; i += batchSize) {
    await db.movimientoBanco.createMany({ data: movsS.slice(i, i + batchSize), skipDuplicates: true });
  }
  for (let i = 0; i < movsB.length; i += batchSize) {
    await db.movimientoBanco.createMany({ data: movsB.slice(i, i + batchSize), skipDuplicates: true });
  }
  console.log(`✅ ${movsS.length + movsB.length} movimientos subidos`);

  // Actualizar saldos
  const saldoB = movsB.reduce((s,m) => s + m.monto, 0);
  const saldoS = movsS.reduce((s,m) => s + m.monto, 0);
  await db.cuentaBancaria.update({ where: { id: cuentaB.id }, data: { saldo: saldoB } });
  await db.cuentaBancaria.update({ where: { id: cuentaS.id }, data: { saldo: saldoS } });
  console.log(`💰 Banorte: $${saldoB.toFixed(2)} | Santander: $${saldoS.toFixed(2)} | Total: $${(saldoB+saldoS).toFixed(2)}`);

  await db.$disconnect();
}
main().catch(e => { console.error('❌', e); process.exit(1); });
