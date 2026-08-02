/**
 * Diagnóstico completo: CFDIs, Bancos, Inversión
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

async function main() {
  console.log('🔍 DIAGNÓSTICO COMPLETO\n');
  console.log('='.repeat(80));

  // 1. Empresas
  console.log('\n📋 EMPRESAS:');
  const empresas = await db.empresa.findMany({ orderBy: { createdAt: 'asc' } });
  empresas.forEach(e => {
    console.log(`  - ${e.nombre} | RFC: ${e.rfc} | ID: ${e.id}`);
  });

  // 2. Para cada empresa, ver facturas y comprobar correspondencia RFC
  console.log('\n📄 CORRESPONDENCIA RFC EMPRESA-FACTURA:');
  for (const emp of empresas) {
    console.log(`\n  🏢 ${emp.nombre} (RFC esperado: ${emp.rfc}):`);
    
    // Emitidas - el emisor debería ser la empresa
    const emisoresEmitidas = await db.factura.findMany({
      where: { empresaId: emp.id, direccion: 'emitida' },
      select: { emisorRfc: true, emisorNombre: true },
      distinct: ['emisorRfc'],
    });
    console.log(`    Emitidas - Emisores únicos (${emisoresEmitidas.length}):`);
    emisoresEmitidas.forEach(e => {
      const match = e.emisorRfc?.toUpperCase() === emp.rfc.toUpperCase();
      console.log(`      ${match ? '✅' : '❌'} ${e.emisorRfc} - ${e.emisorNombre}`);
    });

    // Recibidas - el receptor debería ser la empresa
    const receptoresRecibidas = await db.factura.findMany({
      where: { empresaId: emp.id, direccion: 'recibida' },
      select: { receptorRfc: true, receptorNombre: true },
      distinct: ['receptorRfc'],
    });
    console.log(`    Recibidas - Receptores únicos (${receptoresRecibidas.length}):`);
    receptoresRecibidas.forEach(r => {
      const match = r.receptorRfc?.toUpperCase() === emp.rfc.toUpperCase();
      console.log(`      ${match ? '✅' : '❌'} ${r.receptorRfc} - ${r.receptorNombre}`);
    });
  }

  // 3. CUENTAS BANCARIAS - verificar cuenta de inversión
  console.log('\n\n🏦 CUENTAS BANCARIAS:');
  const cuentas = await db.cuentaBancaria.findMany({
    include: { _count: { select: { movimientos: true } } },
    orderBy: { createdAt: 'asc' },
  });
  cuentas.forEach(c => {
    console.log(`  - Banco: ${c.banco} | Cuenta: ${c.cuenta} | Tipo: ${c.tipo} | Saldo: $${c.saldo} | Movs: ${c._count.movimientos} | Empresa: ${c.empresaId}`);
  });

  // 4. Movimientos por cuenta con detalle mensual
  console.log('\n\n💸 MOVIMIENTOS POR CUENTA (detalle mensual):');
  for (const c of cuentas) {
    console.log(`\n  🏦 ${c.banco} - ${c.cuenta} (Tipo: ${c.tipo}):`);
    const movs = await db.movimientoBanco.findMany({
      where: { cuentaId: c.id },
      orderBy: { fecha: 'asc' },
      select: { fecha: true, monto: true, concepto: true, saldo: true },
    });
    if (movs.length === 0) {
      console.log(`    ⚠️ SIN MOVIMIENTOS`);
    } else {
      // Agrupar por mes
      const porMes = new Map<string, { ingresos: number; egresos: number; count: number }>();
      movs.forEach(m => {
        const fecha = new Date(m.fecha);
        const key = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
        if (!porMes.has(key)) porMes.set(key, { ingresos: 0, egresos: 0, count: 0 });
        const s = porMes.get(key)!;
        if (m.monto > 0) s.ingresos += m.monto;
        else s.egresos += Math.abs(m.monto);
        s.count++;
      });
      porMes.forEach((s, k) => {
        console.log(`    ${k}: ${s.count} movs | Ingresos: $${s.ingresos.toFixed(2)} | Egresos: $${s.egresos.toFixed(2)} | Neto: $${(s.ingresos - s.egresos).toFixed(2)}`);
      });
      console.log(`    TOTAL: ${movs.length} movs | Saldo BD: $${c.saldo}`);
    }
  }

  // 5. Clientes/Proveedores/Empleados por empresa
  console.log('\n\n👥 CLIENTES, PROVEEDORES, EMPLEADOS POR EMPRESA:');
  for (const emp of empresas) {
    console.log(`\n  🏢 ${emp.nombre}:`);
    const clientes = await db.cliente.count({ where: { empresaId: emp.id } });
    const proveedores = await db.proveedor.count({ where: { empresaId: emp.id } });
    const empleadosActivos = await db.empleado.count({ where: { empresaId: emp.id, status: 'activo' } });
    const empleadosInactivos = await db.empleado.count({ where: { empresaId: emp.id, status: { not: 'activo' } } });
    console.log(`    Clientes: ${clientes}`);
    console.log(`    Proveedores: ${proveedores}`);
    console.log(`    Empleados: ${empleadosActivos} activos / ${empleadosInactivos} inactivos`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Diagnóstico completado\n');
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
