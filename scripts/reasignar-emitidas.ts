/**
 * Reasignar emitidas de ELECTRONICMA que no coinciden por RFC
 * A la empresa correcta según su emisorRfc
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

async function main() {
  console.log('🔧 REASIGNACIÓN DE EMITIDAS SIN COINCIDENCIA RFC\n');
  
  const empresas = await db.empresa.findMany();
  const empresasPorRfc = new Map<string, typeof empresas[0]>();
  empresas.forEach(e => empresasPorRfc.set(e.rfc.toUpperCase().trim(), e));
  
  // Para cada empresa, encontrar emitidas con emisorRfc diferente
  for (const emp of empresas) {
    console.log(`\n📋 ${emp.nombre} (RFC: ${emp.rfc}):`);
    const emitidas = await db.factura.findMany({
      where: { empresaId: emp.id, direccion: 'emitida' },
      select: { id: true, emisorRfc: true, emisorNombre: true, total: true, fecha: true },
    });
    
    // Agrupar las que no coincen por RFC
    const noCoinciden = emitidas.filter(f => 
      (f.emisorRfc || '').toUpperCase().trim() !== emp.rfc.toUpperCase().trim()
    );
    console.log(`  Total emitidas: ${emitidas.length}, sin coincidencia: ${noCoinciden.length}`);
    
    // Agrupar por RFC
    const porRfc = new Map<string, typeof noCoinciden>();
    noCoinciden.forEach(f => {
      const rfc = (f.emisorRfc || '').toUpperCase().trim();
      if (!porRfc.has(rfc)) porRfc.set(rfc, []);
      porRfc.get(rfc)!.push(f);
    });
    
    let reasignadas = 0;
    let sinDestino = 0;
    for (const [rfc, facturas] of porRfc) {
      const empDestino = empresasPorRfc.get(rfc);
      if (empDestino && empDestino.id !== emp.id) {
        // Reasignar a la empresa correcta
        for (const f of facturas) {
          await db.factura.update({
            where: { id: f.id },
            data: { empresaId: empDestino.id },
          });
          reasignadas++;
        }
        console.log(`  ✅ ${facturas.length} facturas con RFC ${rfc} → ${empDestino.nombre}`);
      } else {
        sinDestino += facturas.length;
        console.log(`  ⚠️ ${facturas.length} facturas con RFC ${rfc} (no hay empresa destino)`);
      }
    }
    console.log(`  Resumen: ${reasignadas} reasignadas, ${sinDestino} sin empresa destino`);
  }
  
  // Resultado final
  console.log('\n\n📊 ESTADO FINAL:');
  for (const emp of empresas) {
    const stats = await db.factura.groupBy({
      by: ['direccion', 'tipoComprobante'],
      where: { empresaId: emp.id },
      _count: true,
      _sum: { total: true },
    });
    console.log(`\n${emp.nombre}:`);
    stats.forEach(s => {
      console.log(`  ${s.direccion}/${s.tipoComprobante}: ${s._count} | $${s._sum.total?.toFixed(2) || 0}`);
    });
  }
}

main()
  .catch(e => { console.error('❌', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
