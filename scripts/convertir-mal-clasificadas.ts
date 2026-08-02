/**
 * Convertir las 94 facturas mal clasificadas como 'emitidas' a 'recibidas'
 * (porque el emisorRfc no es el de la empresa, son de proveedores)
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

async function main() {
  console.log('🔧 CONVERSIÓN DE FACTURAS MAL CLASIFICADAS\n');
  
  const empresas = await db.empresa.findMany();
  
  for (const emp of empresas) {
    // Buscar emitidas con emisorRfc != empresa.rfc
    const malClasificadas = await db.factura.findMany({
      where: { 
        empresaId: emp.id, 
        direccion: 'emitida',
        NOT: { emisorRfc: { equals: emp.rfc, mode: 'insensitive' } },
      },
      select: { id: true, emisorRfc: true, emisorNombre: true, receptorRfc: true, receptorNombre: true, total: true },
    });
    
    if (malClasificadas.length === 0) continue;
    
    console.log(`\n📋 ${emp.nombre}: ${malClasificadas.length} facturas mal clasificadas como emitidas`);
    console.log(`   Convirtiendo a 'recibidas'...`);
    
    // Mostrar muestra
    malClasificadas.slice(0, 5).forEach(f => {
      console.log(`   - ${f.emisorRfc} (${f.emisorNombre}) → ${f.receptorRfc} | $${f.total.toFixed(2)}`);
    });
    if (malClasificadas.length > 5) {
      console.log(`   ... y ${malClasificadas.length - 5} más`);
    }
    
    // Convertir todas a 'recibidas'
    let convertidas = 0;
    for (const f of malClasificadas) {
      // Validar que el receptor sea efectivamente la empresa
      const receptorMatch = (f.receptorRfc || '').toUpperCase().trim() === emp.rfc.toUpperCase().trim();
      if (!receptorMatch) {
        // Si el receptor tampoco es la empresa, igual la convertimos a recibida
        // porque el emisor no es la empresa → no puede ser emitida
      }
      
      await db.factura.update({
        where: { id: f.id },
        data: { direccion: 'recibida' },
      });
      convertidas++;
    }
    
    console.log(`   ✅ ${convertidas} facturas convertidas a 'recibidas'`);
  }
  
  // Resumen final
  console.log('\n\n📊 ESTADO FINAL:');
  for (const emp of empresas) {
    const stats = await db.factura.groupBy({
      by: ['direccion', 'tipoComprobante'],
      where: { empresaId: emp.id },
      _count: true,
      _sum: { total: true },
    });
    console.log(`\n${emp.nombre} (RFC: ${emp.rfc}):`);
    stats.forEach(s => {
      console.log(`  ${s.direccion}/${s.tipoComprobante}: ${s._count} | $${s._sum.total?.toFixed(2) || 0}`);
    });
  }
}

main()
  .catch(e => { console.error('❌', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
