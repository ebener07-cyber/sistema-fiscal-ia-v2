/**
 * LIMPIEZA DE CFDIs MEZCLADOS ENTRE EMPRESAS
 * 
 * Estrategia:
 * 1. Para cada factura con direccion="emitida", buscar la empresa cuyo RFC = emisorRfc y reasignar
 * 2. Para cada factura con direccion="recibida", buscar la empresa cuyo RFC = receptorRfc y reasignar
 * 3. Si no existe la empresa destino, dejar la factura donde está pero registrarla
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

async function main() {
  console.log('🧹 LIMPIEZA DE CFDIs MEZCLADOS\n');
  console.log('='.repeat(80));

  // Cargar empresas y mapearlas por RFC
  const empresas = await db.empresa.findMany();
  const empresasPorRfc = new Map<string, typeof empresas[0]>();
  empresas.forEach(e => {
    empresasPorRfc.set(e.rfc.toUpperCase(), e);
    // Algunos RFC tienen homoclave con longitud variable, normalizamos
    empresasPorRfc.set(e.rfc.toUpperCase().trim(), e);
  });
  
  console.log('\n📋 Empresas registradas:');
  empresas.forEach(e => console.log(`  - ${e.rfc} → ${e.nombre} (ID: ${e.id})`));

  // 1. PROCESAR FACTURAS "EMITIDAS" — el emisorRfc define a qué empresa pertenecen
  console.log('\n\n📤 PROCESANDO FACTURAS EMITIDAS...');
  const emitidas = await db.factura.findMany({
    where: { direccion: 'emitida' },
    select: { id: true, emisorRfc: true, emisorNombre: true, empresaId: true, total: true, fecha: true },
  });
  
  let reasignadasEmitidas = 0;
  let sinEmpresaEmitidas = 0;
  const sinEmpresaEmitDet: any[] = [];
  
  for (const f of emitidas) {
    if (!f.emisorRfc) {
      sinEmpresaEmitidas++;
      sinEmpresaEmitDet.push({ folio: f.id, rfc: '(sin RFC)', total: f.total });
      continue;
    }
    const empDestino = empresasPorRfc.get(f.emisorRfc.toUpperCase().trim());
    if (!empDestino) {
      sinEmpresaEmitidas++;
      sinEmpresaEmitDet.push({ folio: f.id, rfc: f.emisorRfc, nombre: f.emisorNombre, total: f.total });
      continue;
    }
    if (empDestino.id !== f.empresaId) {
      console.log(`  🔄 Reasignando factura ${f.id.slice(-8)} | emisor: ${f.emisorRfc} → empresa: ${empDestino.nombre}`);
      console.log(`     (era: ${f.empresaId.slice(-8)} → ahora: ${empDestino.id.slice(-8)}) | $${f.total.toFixed(2)}`);
      await db.factura.update({
        where: { id: f.id },
        data: { empresaId: empDestino.id },
      });
      reasignadasEmitidas++;
    }
  }
  console.log(`\n  ✅ Emitidas reasignadas: ${reasignadasEmitidas}`);
  console.log(`  ⚠️ Emitidas sin empresa destino: ${sinEmpresaEmitidas}`);
  if (sinEmpresaEmitDet.length > 0) {
    console.log(`\n  📋 Detalle sin empresa destino (emitidas):`);
    sinEmpresaEmitDet.slice(0, 10).forEach(d => {
      console.log(`     - RFC: ${d.rfc} | ${d.nombre || ''} | $${d.total?.toFixed(2)}`);
    });
    if (sinEmpresaEmitDet.length > 10) console.log(`     ... y ${sinEmpresaEmitDet.length - 10} más`);
  }

  // 2. PROCESAR FACTURAS "RECIBIDAS" — el receptorRfc define a qué empresa pertenecen
  console.log('\n\n📥 PROCESANDO FACTURAS RECIBIDAS...');
  const recibidas = await db.factura.findMany({
    where: { direccion: 'recibida' },
    select: { id: true, receptorRfc: true, receptorNombre: true, empresaId: true, total: true, fecha: true },
  });
  
  let reasignadasRecibidas = 0;
  let sinEmpresaRecibidas = 0;
  const sinEmpresaRecDet: any[] = [];
  
  for (const f of recibidas) {
    if (!f.receptorRfc) {
      sinEmpresaRecibidas++;
      sinEmpresaRecDet.push({ folio: f.id, rfc: '(sin RFC)', total: f.total });
      continue;
    }
    const empDestino = empresasPorRfc.get(f.receptorRfc.toUpperCase().trim());
    if (!empDestino) {
      sinEmpresaRecibidas++;
      sinEmpresaRecDet.push({ folio: f.id, rfc: f.receptorRfc, nombre: f.receptorNombre, total: f.total });
      continue;
    }
    if (empDestino.id !== f.empresaId) {
      console.log(`  🔄 Reasignando factura ${f.id.slice(-8)} | receptor: ${f.receptorRfc} → empresa: ${empDestino.nombre}`);
      console.log(`     (era: ${f.empresaId.slice(-8)} → ahora: ${empDestino.id.slice(-8)}) | $${f.total.toFixed(2)}`);
      await db.factura.update({
        where: { id: f.id },
        data: { empresaId: empDestino.id },
      });
      reasignadasRecibidas++;
    }
  }
  console.log(`\n  ✅ Recibidas reasignadas: ${reasignadasRecibidas}`);
  console.log(`  ⚠️ Recibidas sin empresa destino: ${sinEmpresaRecibidas}`);
  if (sinEmpresaRecDet.length > 0) {
    console.log(`\n  📋 Detalle sin empresa destino (recibidas):`);
    const grouped = new Map<string, { count: number; sample: any }>();
    sinEmpresaRecDet.forEach(d => {
      const key = d.rfc || '(sin RFC)';
      if (!grouped.has(key)) grouped.set(key, { count: 0, sample: d });
      grouped.get(key)!.count++;
    });
    Array.from(grouped.entries()).slice(0, 15).forEach(([rfc, info]) => {
      console.log(`     - RFC: ${rfc} | ${info.sample.nombre || ''} | ${info.count} factura(s)`);
    });
  }

  // 3. RESUMEN FINAL
  console.log('\n\n' + '='.repeat(80));
  console.log('\n📊 RESUMEN FINAL:');
  for (const emp of empresas) {
    const stats = await db.factura.groupBy({
      by: ['direccion', 'tipoComprobante'],
      where: { empresaId: emp.id },
      _count: true,
      _sum: { total: true },
    });
    console.log(`\n  🏢 ${emp.nombre} (${emp.rfc}):`);
    stats.forEach(s => {
      console.log(`     ${s.direccion}/${s.tipoComprobante}: ${s._count} facturas | $${s._sum.total?.toFixed(2) || '0'}`);
    });
  }

  console.log('\n✅ Limpieza completada\n');
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
