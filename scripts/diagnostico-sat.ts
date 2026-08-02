/**
 * Diagnóstico: por qué SatView emitidas no muestra nada para ELECTRONICMA
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

async function main() {
  console.log('🔍 DIAGNÓSTICO SAT EMITIDAS\n');
  console.log('='.repeat(80));

  const empresas = await db.empresa.findMany();
  for (const emp of empresas) {
    console.log(`\n📋 Empresa: ${emp.nombre} (RFC: ${emp.rfc})`);
    console.log(`   ID: ${emp.id}`);
    
    // Emitidas - todas
    const emitidasTodas = await db.factura.findMany({
      where: { empresaId: emp.id, direccion: 'emitida' },
      select: { emisorRfc: true, emisorNombre: true, total: true, fecha: true },
    });
    console.log(`   Emitidas totales (sin filtro RFC): ${emitidasTodas.length}`);
    
    // Emitidas con RFC = empresa.rfc
    const emitidasRFC = emitidasTodas.filter(f => 
      (f.emisorRfc || '').toUpperCase() === emp.rfc.toUpperCase()
    );
    console.log(`   Emitidas con RFC matching (${emp.rfc}): ${emitidasRFC.length}`);
    
    // Mostrar emisores únicos
    const emisoresUnicos = Array.from(new Set(emitidasTodas.map(f => f.emisorRfc)));
    console.log(`   Emisores únicos (${emisoresUnicos.length}):`);
    emisoresUnicos.slice(0, 5).forEach(rfc => {
      const match = rfc?.toUpperCase() === emp.rfc.toUpperCase() ? '✅' : '❌';
      const muestra = emitidasTodas.find(f => f.emisorRfc === rfc);
      console.log(`     ${match} ${rfc} - ${muestra?.emisorNombre}`);
    });
    
    // Recibidas
    const recibidasTodas = await db.factura.findMany({
      where: { empresaId: emp.id, direccion: 'recibida' },
      select: { receptorRfc: true, receptorNombre: true, total: true },
    });
    const recibidasRFC = recibidasTodas.filter(f => 
      (f.receptorRfc || '').toUpperCase() === emp.rfc.toUpperCase()
    );
    console.log(`   Recibidas totales: ${recibidasTodas.length}, con RFC matching: ${recibidasRFC.length}`);
  }

  console.log('\n' + '='.repeat(80));
  
  // Cuentas bancarias actuales
  console.log('\n🏦 CUENTAS BANCARIAS:');
  const cuentas = await db.cuentaBancaria.findMany({
    include: { _count: { select: { movimientos: true } } },
  });
  cuentas.forEach(c => {
    console.log(`  - ${c.banco} | ${c.cuenta} | Tipo: ${c.tipo} | Saldo: $${c.saldo} | Movs: ${c._count.movimientos} | Empresa: ${c.empresaId}`);
  });
  
  console.log('\n✅ Diagnóstico completado\n');
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
