/**
 * LIMPIEZA PROFUNDA: Elimina TODOS los movimientos bancarios duplicados
 * y deja solo una copia correcta por cada transacción real.
 * 
 * Estrategia: Agrupar por fecha + monto absoluto (±1%) + cuentaId
 * Para cada grupo, mantener solo el movimiento con el signo correcto
 * (basado en keywords del concepto)
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

async function main() {
  console.log('🧹 LIMPIEZA PROFUNDA DE MOVIMIENTOS\n');

  // Obtener todos los movimientos
  const movs = await db.movimientoBanco.findMany({
    orderBy: { fecha: 'asc' },
  });

  console.log(`Total movimientos: ${movs.length}`);

  // Agrupar por: fecha (mismo día) + monto absoluto similar + cuentaId
  const grupos = new Map<string, typeof movs>();

  for (const m of movs) {
    const fechaKey = m.fecha.toISOString().split('T')[0]; // YYYY-MM-DD
    const montoAbs = Math.abs(m.monto);
    // Redondear a centenas para agrupar montos similares
    const montoKey = Math.round(montoAbs / 100) * 100;
    const key = `${m.cuentaId}_${fechaKey}_${montoKey}`;

    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(m);
  }

  console.log(`Grupos únicos: ${grupos.size}`);

  // Para cada grupo, decidir cuál mantener
  const idsAMantener: string[] = [];
  const idsAEliminar: string[] = [];
  let gruposDuplicados = 0;

  const keywordsRetiro = [
    'COMPRA', 'PAGO', 'RETIRO', 'CARGO', 'TRASPASO', 'COMISION', 'COMISIÓN',
    'TRANSFERENCIA', 'I.V.A.', 'INTERESES EXENTO', 'PAGO DE CAPITAL',
    'PAGO DE CREDITO', 'PAGO DE LDC', 'ADMINISTRACION', 'COM. DISPERSION',
    'IVA COM', 'IVA 00054',
  ];
  const keywordsDeposito = [
    'DISPOSICION', 'RECIBIDO', 'DEPOSITO', 'DEPÓSITO', 'DEV. DEPOSITO',
    'DEVOLUCION', 'DEPOSITO DE CUENTA',
  ];

  for (const [key, grupo] of grupos) {
    if (grupo.length === 1) {
      // No duplicado — mantener
      idsAMantener.push(grupo[0].id);
    } else {
      // Duplicado — elegir el correcto
      gruposDuplicados++;
      
      // Determinar el signo correcto basado en el concepto
      const conceptoUpper = grupo[0].concepto.toUpperCase();
      const esRetiro = keywordsRetiro.some(k => conceptoUpper.includes(k));
      const esDeposito = keywordsDeposito.some(k => conceptoUpper.includes(k));

      let movimientoCorrecto = grupo[0];

      if (esRetiro) {
        // Debería ser negativo — buscar el que tenga monto negativo
        movimientoCorrecto = grupo.find(m => m.monto < 0) || grupo[0];
      } else if (esDeposito) {
        // Debería ser positivo — buscar el que tenga monto positivo
        movimientoCorrecto = grupo.find(m => m.monto > 0) || grupo[0];
      }

      // Mantener el correcto, eliminar el resto
      idsAMantener.push(movimientoCorrecto.id);
      for (const m of grupo) {
        if (m.id !== movimientoCorrecto.id) {
          idsAEliminar.push(m.id);
        }
      }
    }
  }

  console.log(`Grupos duplicados: ${gruposDuplicados}`);
  console.log(`Movimientos a mantener: ${idsAMantener.length}`);
  console.log(`Movimientos a eliminar: ${idsAEliminar.length}`);

  // Eliminar en lotes
  let eliminados = 0;
  for (let i = 0; i < idsAEliminar.length; i += 100) {
    const lote = idsAEliminar.slice(i, i + 100);
    const result = await db.movimientoBanco.deleteMany({ where: { id: { in: lote } } });
    eliminados += result.count;
  }
  console.log(`✅ ${eliminados} movimientos eliminados`);

  // Recalcular saldos
  console.log('\n💰 RECALCULANDO SALDOS...');
  const cuentas = await db.cuentaBancaria.findMany();
  for (const c of cuentas) {
    const movsCuenta = await db.movimientoBanco.findMany({
      where: { cuentaId: c.id },
      select: { monto: true },
    });
    const saldo = movsCuenta.reduce((s, m) => s + m.monto, 0);
    const ingresos = movsCuenta.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
    const egresos = movsCuenta.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);

    await db.cuentaBancaria.update({
      where: { id: c.id },
      data: { saldo },
    });

    console.log(`\n  ${c.banco} ${c.cuenta}:`);
    console.log(`    Movimientos: ${movsCuenta.length}`);
    console.log(`    Ingresos: $${ingresos.toFixed(2)}`);
    console.log(`    Egresos: $${egresos.toFixed(2)}`);
    console.log(`    Saldo: $${saldo.toFixed(2)}`);
  }

  // Reporte final
  console.log('\n' + '='.repeat(60));
  console.log('\n📊 ESTADO FINAL\n');
  const totalFinal = await db.movimientoBanco.count();
  console.log(`  Total movimientos: ${totalFinal}`);
  console.log(`  Total cuentas: ${cuentas.length}`);

  // Verificar facturas por empresa
  console.log('\n📄 FACTURAS POR EMPRESA:');
  const empresas = await db.empresa.findMany();
  for (const emp of empresas) {
    const facturas = await db.factura.count({ where: { empresaId: emp.id } });
    const emitidas = await db.factura.count({ where: { empresaId: emp.id, direccion: 'emitida' } });
    const recibidas = await db.factura.count({ where: { empresaId: emp.id, direccion: 'recibida' } });
    console.log(`  ${emp.nombre}: ${facturas} total (${emitidas} emitidas, ${recibidas} recibidas)`);
  }

  console.log('\n✅ Limpieza completada\n');
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
