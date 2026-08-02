/**
 * Diagnóstico específico: CFDIs mezclados entre empresas
 * Verifica si las facturas tienen empresaId correcto
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

async function main() {
  console.log('🔍 DIAGNÓSTICO CFDIs MEZCLADOS\n');
  console.log('='.repeat(80));

  // 1. Empresas
  console.log('\n📋 EMPRESAS:');
  const empresas = await db.empresa.findMany({ orderBy: { createdAt: 'asc' } });
  empresas.forEach(e => {
    console.log(`  - ${e.nombre} | RFC: ${e.rfc} | ID: ${e.id}`);
  });

  // 2. Para cada empresa, contar facturas emitidas/recibidas
  console.log('\n📄 FACTURAS POR EMPRESA (direccion + tipoComprobante):');
  for (const emp of empresas) {
    console.log(`\n  🏢 ${emp.nombre} (${emp.id}):`);
    const stats = await db.factura.groupBy({
      by: ['direccion', 'tipoComprobante'],
      where: { empresaId: emp.id },
      _count: true,
      _sum: { total: true },
    });
    if (stats.length === 0) {
      console.log(`     ⚠️ SIN FACTURAS`);
    } else {
      stats.forEach(s => {
        console.log(`     ${s.direccion} | tipo ${s.tipoComprobante}: ${s._count} facturas | $${s._sum.total?.toFixed(2) || '0'}`);
      });
    }
  }

  // 3. Buscar facturas SIN empresaId o con empresaId inválido
  console.log('\n⚠️ FACTURAS SIN EMPRESA ID:');
  const sinEmpresa = await db.factura.count({ where: { OR: [{ empresaId: null }, { empresaId: '' }] } });
  console.log(`  Facturas sin empresaId: ${sinEmpresa}`);

  // 4. Mostrar 5 facturas de cada empresa para ver si están bien asignadas
  console.log('\n📋 MUESTRA DE FACTURAS POR EMPRESA (primeras 5 de cada una):');
  for (const emp of empresas) {
    console.log(`\n  🏢 ${emp.nombre}:`);
    const facturas = await db.factura.findMany({
      where: { empresaId: emp.id },
      take: 5,
      orderBy: { fecha: 'desc' },
      select: {
        folio: true,
        serie: true,
        fecha: true,
        total: true,
        direccion: true,
        tipoComprobante: true,
        emisorRfc: true,
        emisorNombre: true,
        receptorRfc: true,
        receptorNombre: true,
        uuid: true,
      },
    });
    facturas.forEach(f => {
      console.log(`    ${f.direccion}/${f.tipoComprobante} | ${f.serie || ''}${f.folio} | $${f.total.toFixed(2)} | ${f.fecha.toISOString().slice(0,10)}`);
      console.log(`      Emisor: ${f.emisorRfc} - ${f.emisorNombre}`);
      console.log(`      Receptor: ${f.receptorRfc} - ${f.receptorNombre}`);
      console.log(`      UUID: ${f.uuid}`);
    });
  }

  // 5. Detectar facturas que NO corresponden a la empresa por RFC
  console.log('\n🔍 ANÁLISIS DE CORRESPONDENCIA RFC EMPRESA:');
  for (const emp of empresas) {
    console.log(`\n  🏢 ${emp.nombre} (RFC: ${emp.rfc}):`);
    // Emitidas: el emisor debería ser la empresa
    const emitidas = await db.factura.findMany({
      where: { empresaId: emp.id, direccion: 'emitida' },
      select: { emisorRfc: true, emisorNombre: true },
      distinct: ['emisorRfc'],
    });
    console.log(`    Emitidas - Emisores únicos:`);
    emitidas.forEach(e => {
      const match = e.emisorRfc?.toUpperCase() === emp.rfc.toUpperCase();
      console.log(`      ${match ? '✅' : '❌'} ${e.emisorRfc} - ${e.emisorNombre}`);
    });

    // Recibidas: el receptor debería ser la empresa
    const recibidas = await db.factura.findMany({
      where: { empresaId: emp.id, direccion: 'recibida' },
      select: { receptorRfc: true, receptorNombre: true },
      distinct: ['receptorRfc'],
    });
    console.log(`    Recibidas - Receptores únicos:`);
    recibidas.forEach(r => {
      const match = r.receptorRfc?.toUpperCase() === emp.rfc.toUpperCase();
      console.log(`      ${match ? '✅' : '❌'} ${r.receptorRfc} - ${r.receptorNombre}`);
    });
  }

  console.log('\n' + '='.repeat(80));
  console.log('✅ Diagnóstico completado\n');
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
