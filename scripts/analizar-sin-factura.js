/**
 * Análisis profundo: por qué hay tantos movimientos SIN_FACTURA
 */
const { PrismaClient } = require('@prisma/client');
const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

// Keywords de movimientos no conciliables
const NO_REQUIERE = [
  'TRASPASO', 'TRANSFERENCIA ENTRE CUENTAS PROPIAS', 'ENTRE CUENTAS PROPIAS', 'TRANSPASO',
  'COMISION', 'COMISIÓN', 'RENTA MEMBRESIA', 'COM. DISPERSION', 'COM. ADMIN',
  'I V A POR COMISION', 'IVA COM', 'IVA 00054',
  'CARGO CAPITAL', 'PAGO DE CAPITAL', 'CAPITAL DE CREDITO', 'CRE_',
  'CARGO POR INTERESES', 'INTERESES DE CREDITO', 'CGO INTERESES', 'INTERESES MORATORIOS',
  'INTERESES EXENTO', 'INTERES EXENTO', 'RENDIMIENTO',
  'DISPOSICION', 'DISPOSICION CREDITO',
  'PRIMA SEGURO', 'SEGURO PYME', 'SEGURO AUTOCOMPARA',
];

function esNoConciliable(concepto) {
  const upper = concepto.toUpperCase();
  return NO_REQUIERE.some(k => upper.includes(k));
}

async function main() {
  console.log('🔍 ANÁLISIS PROFUNDO: Movimientos SIN_FACTURA\n');
  console.log('='.repeat(80));

  const empresa = await db.empresa.findFirst({ where: { rfc: 'ALO980508ID6' } });
  if (!empresa) { console.log('❌ No encontré ELECTRONICMA'); return; }

  // 1. Total de movimientos
  const totalMovs = await db.movimientoBanco.count({
    where: { cuenta: { empresaId: empresa.id } },
  });
  console.log(`\n📊 Total movimientos bancarios: ${totalMovs}`);

  // 2. Movimientos conciliados (con facturaConciliadaId)
  const conciliados = await db.movimientoBanco.count({
    where: { cuenta: { empresaId: empresa.id }, facturaConciliadaId: { not: null } },
  });
  console.log(`✅ Conciliados con factura: ${conciliados}`);

  // 3. Movimientos sin conciliar
  const sinConciliar = await db.movimientoBanco.findMany({
    where: { cuenta: { empresaId: empresa.id }, facturaConciliadaId: null },
    select: { id: true, concepto: true, monto: true, fecha: true, cuenta: { select: { banco: true } } },
    orderBy: { fecha: 'desc' },
  });
  console.log(`⚠️ Sin conciliar: ${sinConciliar.length}`);

  // 4. De los sin conciliar, cuántos NO requieren factura
  let noRequieren = 0;
  let realmenteSinFactura = 0;
  const porTipo = {};
  const realmenteSinFacturaList = [];

  for (const mov of sinConciliar) {
    if (esNoConciliable(mov.concepto)) {
      noRequieren++;
    } else {
      realmenteSinFactura++;
      realmenteSinFacturaList.push(mov);
      // Categorizar por tipo
      const esDeposito = mov.monto > 0;
      const tipo = esDeposito ? 'DEPÓSITO' : 'PAGO';
      if (!porTipo[tipo]) porTipo[tipo] = { count: 0, monto: 0 };
      porTipo[tipo].count++;
      porTipo[tipo].monto += Math.abs(mov.monto);
    }
  }

  console.log(`\n📋 DESGLOSE DE LOS ${sinConciliar.length} SIN CONCILIAR:`);
  console.log(`  🔵 No requieren factura (transferencias, comisiones, créditos): ${noRequieren}`);
  console.log(`  🔴 Realmente sin factura: ${realmenteSinFactura}`);

  console.log(`\n📊 DE LOS ${realmenteSinFactura} REALMENTE SIN FACTURA:`);
  for (const [tipo, stats] of Object.entries(porTipo)) {
    console.log(`  ${tipo}: ${stats.count} movimientos — $${stats.monto.toFixed(2)}`);
  }

  // 5. CFDIs en el sistema
  const cfdiEmitidos = await db.factura.count({
    where: { empresaId: empresa.id, direccion: 'emitida', estado: 'timbrada', tipoComprobante: 'I' },
  });
  const cfdiRecibidos = await db.factura.count({
    where: { empresaId: empresa.id, direccion: 'recibida', estado: 'timbrada', tipoComprobante: 'I' },
  });
  const complementosPago = await db.factura.count({
    where: { empresaId: empresa.id, tipoComprobante: 'P' },
  });
  const canceladas = await db.factura.count({
    where: { empresaId: empresa.id, estado: 'cancelada' },
  });

  console.log(`\n📋 CFDIs EN EL SISTEMA:`);
  console.log(`  Facturas emitidas (tipo I): ${cfdiEmitidos}`);
  console.log(`  Facturas recibidas (tipo I): ${cfdiRecibidos}`);
  console.log(`  Complementos de pago (tipo P): ${complementosPago}`);
  console.log(`  Facturas canceladas: ${canceladas}`);

  // 6. Mostrar ejemplos de movimientos realmente sin factura
  console.log(`\n📋 EJEMPLOS DE MOVIMIENTOS REALMENTE SIN FACTURA (primeros 20):`);
  realmenteSinFacturaList.slice(0, 20).forEach((m, i) => {
    const tipo = m.monto > 0 ? 'DEPÓSITO' : 'PAGO';
    console.log(`  ${i+1}. ${m.fecha.toISOString().slice(0,10)} | ${m.cuenta.banco} | ${tipo} | $${m.monto.toFixed(2)} | ${m.concepto.slice(0, 70)}`);
  });

  // 7. Agrupar por patrón de concepto
  console.log(`\n📋 AGRUPADO POR PATRÓN DE CONCEPTO (top 15):`);
  const porPatron = {};
  for (const m of realmenteSinFacturaList) {
    // Extraer las primeras 2-3 palabras del concepto como patrón
    const palabras = m.concepto.split(' ').slice(0, 3).join(' ');
    if (!porPatron[palabras]) porPatron[palabras] = { count: 0, monto: 0, tipo: m.monto > 0 ? 'DEP' : 'PAGO' };
    porPatron[palabras].count++;
    porPatron[palabras].monto += Math.abs(m.monto);
  }
  const patronesOrdenados = Object.entries(porPatron).sort((a, b) => b[1].count - a[1].count).slice(0, 15);
  patronesOrdenados.forEach(([patron, stats]) => {
    console.log(`  ${stats.tipo} | ${stats.count}x | $${stats.monto.toFixed(2)} | "${patron}"`);
  });

  // 8. Resumen de qué falta
  console.log(`\n${'='.repeat(80)}`);
  console.log(`📋 RESUMEN: ¿QUÉ FALTA PARA MEJORAR LA CONCILIACIÓN?`);
  console.log(`  1. Movimientos que NO requieren factura: ${noRequieren} (se categorizarán automáticamente)`);
  console.log(`  2. Movimientos realmente sin factura: ${realmenteSinFactura}`);
  console.log(`     - Depósitos sin factura: ${porTipo['DEPÓSITO']?.count || 0} ($${porTipo['DEPÓSITO']?.monto?.toFixed(2) || 0})`);
  console.log(`     - Pagos sin factura: ${porTipo['PAGO']?.count || 0} ($${porTipo['PAGO']?.monto?.toFixed(2) || 0})`);
  console.log(`  3. Complementos de pago en sistema: ${complementosPago}`);
  if (complementosPago === 0) {
    console.log(`     ⚠️ NO TIENES COMPLEMENTOS DE PAGO CARGADOS`);
    console.log(`     → Necesitas subir los CFDIs tipo Pago (P) del SAT`);
  }
  console.log(`  4. Facturas canceladas en sistema: ${canceladas}`);
  if (canceladas === 0) {
    console.log(`     ⚠️ NO TIENES CFDIs CANCELADOS CARGADOS`);
    console.log(`     → Sube también los cancelados para descartarlos`);
  }

  await db.$disconnect();
}
main().catch(e => { console.error(e); process.exit(1); });
