/**
 * Diagnóstico y reparación de la BD Neon
 * Conecta directamente a Neon y muestra/limpia todo
 */
import { PrismaClient } from '@prisma/client';

const db = new PrismaClient({
  datasources: { db: { url: 'postgresql://neondb_owner:npg_XW6B0vjpuDlb@ep-red-smoke-atnx33ih-pooler.c-9.us-east-1.aws.neon.tech/neondb?sslmode=require' } },
});

async function main() {
  console.log('🔍 DIAGNÓSTICO DE BD NEON\n');
  console.log('='.repeat(60));

  // 1. EMPRESAS
  console.log('\n📋 1. EMPRESAS');
  const empresas = await db.empresa.findMany({ orderBy: { createdAt: 'asc' } });
  empresas.forEach((e, i) => {
    console.log(`  ${i+1}. ${e.nombre} | RFC: ${e.rfc} | ID: ${e.id}`);
  });

  // 2. CUENTAS BANCARIAS
  console.log('\n🏦 2. CUENTAS BANCARIAS');
  const cuentas = await db.cuentaBancaria.findMany({
    include: { _count: { select: { movimientos: true } } },
    orderBy: { createdAt: 'asc' },
  });
  cuentas.forEach((c, i) => {
    console.log(`  ${i+1}. Banco: ${c.banco} | Cuenta: ${c.cuenta} | Saldo: $${c.saldo} | Tipo: ${c.tipo} | Movs: ${c._count.movimientos} | Empresa: ${c.empresaId}`);
  });
  console.log(`  TOTAL: ${cuentas.length} cuentas`);

  // Detectar duplicadas
  const cuentasPorNumero = new Map<string, typeof cuentas>();
  cuentas.forEach(c => {
    const key = c.cuenta;
    if (!cuentasPorNumero.has(key)) cuentasPorNumero.set(key, []);
    cuentasPorNumero.get(key)!.push(c);
  });
  const duplicadas = Array.from(cuentasPorNumero.entries()).filter(([_, cs]) => cs.length > 1);
  if (duplicadas.length > 0) {
    console.log(`\n  ⚠️  CUENTAS DUPLICADAS (${duplicadas.length} grupos):`);
    duplicadas.forEach(([num, cs]) => {
      console.log(`    Cuenta "${num}" tiene ${cs.length} registros:`);
      cs.forEach(c => console.log(`      - ID: ${c.id} | Banco: ${c.banco} | Saldo: $${c.saldo} | Movs: ${c._count.movimientos}`));
    });
  }

  // 3. FACTURAS POR EMPRESA
  console.log('\n📄 3. FACTURAS POR EMPRESA');
  const facturasPorEmpresa = await db.factura.groupBy({
    by: ['empresaId', 'direccion', 'tipoComprobante'],
    _count: true,
    _sum: { total: true },
    orderBy: { empresaId: 'asc' },
  });
  facturasPorEmpresa.forEach(f => {
    console.log(`  Empresa: ${f.empresaId} | ${f.direccion} | Tipo: ${f.tipoComprobante} | Count: ${f._count} | Total: $${f._sum.total || 0}`);
  });

  // 4. MOVIMIENTOS POR CUENTA
  console.log('\n💸 4. MOVIMIENTOS POR CUENTA');
  const movsPorCuenta = await db.movimientoBanco.groupBy({
    by: ['cuentaId'],
    _count: true,
    _sum: { monto: true },
  });
  for (const m of movsPorCuenta) {
    const cuenta = cuentas.find(c => c.id === m.cuentaId);
    const ingresos = await db.movimientoBanco.count({ where: { cuentaId: m.cuentaId, monto: { gt: 0 } } });
    const egresos = await db.movimientoBanco.count({ where: { cuentaId: m.cuentaId, monto: { lt: 0 } } });
    console.log(`  Cuenta: ${cuenta?.banco} ${cuenta?.cuenta} | Total: ${m._count} movs | Ingresos: ${ingresos} | Egresos: ${egresos} | Saldo calc: $${m._sum.monto || 0} | Saldo BD: $${cuenta?.saldo || 0}`);
  }

  // 5. NÓMINA
  console.log('\n👥 5. NÓMINA POR EMPRESA');
  const nominaPorEmpresa = await db.reciboNomina.groupBy({
    by: ['empresaId'],
    _count: true,
    _sum: { totalPercepciones: true },
  });
  nominaPorEmpresa.forEach(n => {
    console.log(`  Empresa: ${n.empresaId} | Recibos: ${n._count} | Total: $${n._sum.totalPercepciones || 0}`);
  });

  // 6. USUARIOS
  console.log('\n👤 6. USUARIOS');
  const usuarios = await db.usuario.findMany({ select: { id: true, email: true, nombre: true, rol: true, empresaId: true } });
  usuarios.forEach(u => {
    console.log(`  ${u.email} | ${u.nombre} | Rol: ${u.rol} | Empresa: ${u.empresaId || 'N/A'}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('✅ Diagnóstico completado\n');
}

main()
  .catch(e => { console.error('❌ Error:', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
