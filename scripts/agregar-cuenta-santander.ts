/**
 * Agregar cuenta Santander a ELECTRONICMA
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

async function main() {
  console.log('🏦 Agregando cuenta Santander a ELECTRONICMA\n');
  
  const empresa = await db.empresa.findFirst({ where: { rfc: 'ALO980508ID6' } });
  if (!empresa) {
    console.log('❌ No se encontró ELECTRONICMA');
    return;
  }
  console.log(`Empresa: ${empresa.nombre} (ID: ${empresa.id})`);
  
  // Verificar si ya existe la cuenta Santander
  const existente = await db.cuentaBancaria.findFirst({
    where: { 
      empresaId: empresa.id,
      cuenta: { contains: '65-50908535-6' },
    },
  });
  
  if (existente) {
    console.log(`✅ La cuenta Santander ya existe:`);
    console.log(`   - Banco: ${existente.banco}`);
    console.log(`   - Cuenta: ${existente.cuenta}`);
    console.log(`   - Tipo: ${existente.tipo}`);
    console.log(`   - Saldo: $${existente.saldo}`);
    return;
  }
  
  // Crear cuenta Santander (operaciones)
  const cuenta = await db.cuentaBancaria.create({
    data: {
      banco: 'SANTANDER',
      cuenta: '65-50908535-6',
      saldo: 0,
      tipo: 'operaciones',
      empresaId: empresa.id,
    },
  });
  console.log(`✅ Cuenta creada: ${cuenta.banco} ${cuenta.cuenta} (ID: ${cuenta.id})`);
  
  // Listar todas las cuentas
  console.log('\n📋 Cuentas actuales de ELECTRONICMA:');
  const cuentas = await db.cuentaBancaria.findMany({
    where: { empresaId: empresa.id },
    include: { _count: { select: { movimientos: true } } },
  });
  cuentas.forEach(c => {
    console.log(`  - ${c.banco} | ${c.cuenta} | Tipo: ${c.tipo} | Saldo: $${c.saldo} | Movs: ${c._count.movimientos}`);
  });
}

main()
  .catch(e => { console.error('❌', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
