/**
 * REPARACIÓN COMPLETA DE BD NEON
 * 
 * Ejecuta:
 * 1. Limpia movimientos bancarios duplicados/incorrectos
 * 2. Recalcula saldos de cuentas
 * 3. Verifica facturas por empresa
 * 4. Reporta estado final
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

async function main() {
  console.log('🔧 REPARACIÓN DE BD NEON\n');
  console.log('='.repeat(60));

  // ===== 1. LIMPIAR MOVIMIENTOS DUPLICADOS =====
  console.log('\n💸 1. LIMPIANDO MOVIMIENTOS BANCARIOS...');

  // Obtener todos los movimientos ordenados por fecha
  const todosMovs = await db.movimientoBanco.findMany({
    orderBy: { fecha: 'asc' },
    select: { id: true, fecha: true, concepto: true, monto: true, cuentaId: true },
  });

  console.log(`  Total movimientos antes: ${todosMovs.length}`);

  // Detectar duplicados exactos (misma fecha + concepto + monto + cuentaId)
  const vistos = new Set<string>();
  const idsDuplicados: string[] = [];

  for (const m of todosMovs) {
    const key = `${m.cuentaId}_${m.fecha.toISOString()}_${m.concepto.substring(0, 50)}_${m.monto}`;
    if (vistos.has(key)) {
      idsDuplicados.push(m.id);
    } else {
      vistos.add(key);
    }
  }

  console.log(`  Duplicados exactos encontrados: ${idsDuplicados.length}`);

  // Eliminar duplicados
  if (idsDuplicados.length > 0) {
    // Eliminar en lotes de 100
    for (let i = 0; i < idsDuplicados.length; i += 100) {
      const lote = idsDuplicados.slice(i, i + 100);
      await db.movimientoBanco.deleteMany({ where: { id: { in: lote } } });
    }
    console.log(`  ✅ ${idsDuplicados.length} duplicados eliminados`);
  }

  // ===== 2. DETECTAR Y ELIMINAR MOVIMIENTOS CON SIGNO INVERTIDO =====
  console.log('\n🔄 2. DETECTANDO SIGNOS INVERTIDOS...');

  // Si hay un movimiento +X y otro -X con misma fecha y concepto, son duplicados con signo invertido
  const movsRestantes = await db.movimientoBanco.findMany({
    orderBy: { fecha: 'asc' },
    select: { id: true, fecha: true, concepto: true, monto: true, cuentaId: true },
  });

  const idsInvertidos: string[] = [];
  const procesados = new Set<string>();

  for (let i = 0; i < movsRestantes.length; i++) {
    if (procesados.has(movsRestantes[i].id)) continue;
    const m1 = movsRestantes[i];

    for (let j = i + 1; j < movsRestantes.length; j++) {
      if (procesados.has(movsRestantes[j].id)) continue;
      const m2 = movsRestantes[j];

      // Misma fecha, mismo concepto (primeros 50 chars), monto opuesto
      if (
        m1.fecha.getTime() === m2.fecha.getTime() &&
        m1.concepto.substring(0, 50) === m2.concepto.substring(0, 50) &&
        m1.cuentaId === m2.cuentaId &&
        Math.abs(m1.monto + m2.monto) < 0.01 // Son opuestos
      ) {
        // El invertido es el que tiene el signo incorrecto
        // Mantener el positivo si el concepto sugiere depósito, negativo si sugiere retiro
        const conceptoUpper = m1.concepto.toUpperCase();
        const esRetiro = ['COMPRA', 'PAGO', 'RETIRO', 'CARGO', 'TRASPASO', 'COMISION', 'TRANSFERENCIA', 'I.V.A.', 'INTERESES EXENTO', 'PAGO DE CAPITAL', 'PAGO DE CREDITO', 'PAGO DE LDC', 'ADMINISTRACION', 'COM. DISPERSION'].some(k => conceptoUpper.includes(k));

        if (esRetiro) {
          // Debería ser negativo — eliminar el positivo
          if (m1.monto > 0) { idsInvertidos.push(m1.id); procesados.add(m1.id); }
          else { idsInvertidos.push(m2.id); procesados.add(m2.id); }
        } else {
          // Debería ser positivo — eliminar el negativo
          if (m1.monto < 0) { idsInvertidos.push(m1.id); procesados.add(m1.id); }
          else { idsInvertidos.push(m2.id); procesados.add(m2.id); }
        }
        break;
      }
    }
  }

  console.log(`  Signos invertidos encontrados: ${idsInvertidos.length}`);

  if (idsInvertidos.length > 0) {
    for (let i = 0; i < idsInvertidos.length; i += 100) {
      const lote = idsInvertidos.slice(i, i + 100);
      await db.movimientoBanco.deleteMany({ where: { id: { in: lote } } });
    }
    console.log(`  ✅ ${idsInvertidos.length} movimientos con signo invertido eliminados`);
  }

  // ===== 3. RECALCULAR SALDOS =====
  console.log('\n💰 3. RECALCULANDO SALDOS DE CUENTAS...');

  const cuentas = await db.cuentaBancaria.findMany();
  for (const c of cuentas) {
    const movs = await db.movimientoBanco.findMany({
      where: { cuentaId: c.id },
      select: { monto: true },
    });
    const saldoCalculado = movs.reduce((s, m) => s + m.monto, 0);
    
    console.log(`  ${c.banco} ${c.cuenta}:`);
    console.log(`    Movimientos: ${movs.length}`);
    console.log(`    Saldo anterior: $${c.saldo}`);
    console.log(`    Saldo calculado: $${saldoCalculado}`);

    await db.cuentaBancaria.update({
      where: { id: c.id },
      data: { saldo: saldoCalculado },
    });
    console.log(`    ✅ Saldo actualizado`);
  }

  // ===== 4. REPORTE FINAL =====
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 REPORTE FINAL\n');

  const movsFinales = await db.movimientoBanco.count();
  console.log(`  Movimientos totales: ${movsFinales}`);

  for (const c of cuentas) {
    const movs = await db.movimientoBanco.findMany({
      where: { cuentaId: c.id },
      select: { monto: true },
    });
    const ingresos = movs.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
    const egresos = movs.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);
    console.log(`\n  ${c.banco} ${c.cuenta}:`);
    console.log(`    Movimientos: ${movs.length}`);
    console.log(`    Ingresos: $${ingresos.toFixed(2)}`);
    console.log(`    Egresos: $${egresos.toFixed(2)}`);
    console.log(`    Saldo: $${(ingresos - egresos).toFixed(2)}`);
  }

  // Facturas por empresa
  console.log('\n📄 FACTURAS POR EMPRESA:');
  const facturasPorEmpresa = await db.factura.groupBy({
    by: ['empresaId'],
    _count: true,
  });
  for (const f of facturasPorEmpresa) {
    const empresa = await db.empresa.findUnique({ where: { id: f.empresaId } });
    console.log(`  ${empresa?.nombre}: ${f._count} facturas`);
  }

  console.log('\n✅ Reparación completada\n');
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
