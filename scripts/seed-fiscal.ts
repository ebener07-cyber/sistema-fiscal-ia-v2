/**
 * Seed: datos fiscales de ejemplo para probar auditoría con Abbax.
 * Ejecutar con: bun run db:seed
 */
import { db } from '../src/lib/db';

async function main() {
  console.log('🌱 Sembrando datos fiscales...');

  // Limpiar primero
  await db.factura.deleteMany();
  await db.clienteFiscal.deleteMany();
  await db.empresaFiscal.deleteMany();

  // Crear empresa
  const empresa = await db.empresaFiscal.create({
    data: {
      nombre: 'Construcciones Hernández SAC',
      rfc: 'HEH850415ABC',
      regimenFiscal: 'Persona Moral',
      email: 'admin@hernandez.mx',
      telefono: '555-123-4567',
    },
  });
  console.log(`✅ Empresa creada: ${empresa.nombre}`);

  // Crear clientes
  const clientes = await Promise.all([
    db.clienteFiscal.create({
      data: {
        nombre: 'Tania García López',
        rfc: 'GALT850415AB1',
        usoCfdi: 'G03',
        email: 'tania@example.com',
        empresaId: empresa.id,
      },
    }),
    db.clienteFiscal.create({
      data: {
        nombre: 'Constructora Norte SA',
        rfc: 'CNO8501012A1',
        usoCfdi: 'G03',
        email: 'contacto@norte.com',
        empresaId: empresa.id,
      },
    }),
    db.clienteFiscal.create({
      data: {
        nombre: 'Desarrollo Urbano del Bajío',
        rfc: 'DUB9509203K9',
        usoCfdi: 'G03',
        email: 'urban@bajio.mx',
        empresaId: empresa.id,
      },
    }),
  ]);
  console.log(`✅ ${clientes.length} clientes creados`);

  // Crear facturas emitidas (ingresos)
  const facturasEmitidas = [
    { folio: 'A-001', clienteIdx: 0, monto: 45000, subtotal: 39655.17, iva: 5344.83, fecha: '2026-07-01' },
    { folio: 'A-002', clienteIdx: 1, monto: 62500, subtotal: 55088.50, iva: 7411.50, fecha: '2026-07-03' },
    { folio: 'A-003', clienteIdx: 2, monto: 87000, subtotal: 76725.66, iva: 10274.34, fecha: '2026-07-05' },
    { folio: 'A-004', clienteIdx: 0, monto: 32500, subtotal: 28672.41, iva: 3827.59, fecha: '2026-07-07' },
    { folio: 'A-005', clienteIdx: 1, monto: 18500, subtotal: 16327.59, iva: 2172.41, fecha: '2026-07-08' },
    { folio: 'A-006', clienteIdx: 2, monto: 124000, subtotal: 109389.38, iva: 14610.62, fecha: '2026-07-09' },
    { folio: 'A-007', clienteIdx: 0, monto: 8750, subtotal: 7743.36, iva: 1006.64, fecha: '2026-07-10' },
    { folio: 'A-008', clienteIdx: 1, monto: 45600, subtotal: 40212.07, iva: 5387.93, fecha: '2026-06-15' },
    { folio: 'A-009', clienteIdx: 2, monto: 98000, subtotal: 86548.67, iva: 11451.33, fecha: '2026-06-20' },
    { folio: 'A-010', clienteIdx: 0, monto: 15000, subtotal: 13274.51, iva: 1725.49, fecha: '2026-06-25' },
  ];

  for (const f of facturasEmitidas) {
    const cliente = clientes[f.clienteIdx];
    await db.factura.create({
      data: {
        folio: f.folio,
        serie: 'A',
        fecha: new Date(f.fecha),
        monto: f.monto,
        subtotal: f.subtotal,
        totalImpuestos: f.iva,
        moneda: 'MXN',
        tipoComprobante: 'I',
        metodoPago: 'PUE',
        formaPago: '03',
        uuid: `${f.folio}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        direccion: 'emitida',
        estado: 'timbrada',
        empresaId: empresa.id,
        clienteId: cliente.id,
        receptorRfc: cliente.rfc,
        receptorNombre: cliente.nombre,
        emisorRfc: empresa.rfc,
        emisorNombre: empresa.nombre,
      },
    });
  }
  console.log(`✅ ${facturasEmitidas.length} facturas emitidas creadas`);

  // Crear facturas recibidas (gastos)
  const facturasRecibidas = [
    { folio: 'REC-001', emisor: 'Oficina del Centro', rfc: 'OCE8001014M1', monto: 3200, iva: 432.43, fecha: '2026-07-02', concepto: 'Renta oficina' },
    { folio: 'REC-002', emisor: 'Ferretería Industrial', rfc: 'FIN8205063A2', monto: 18750, iva: 2527.59, fecha: '2026-07-04', concepto: 'Material construcción' },
    { folio: 'REC-003', emisor: 'Gasolina Estación 45', rfc: 'GEH9509118P3', monto: 5500, iva: 742.07, fecha: '2026-07-05', concepto: 'Combustible' },
    { folio: 'REC-004', emisor: 'Papelería La Economic', rfc: 'PLE7103155T7', monto: 1850, iva: 249.57, fecha: '2026-07-06', concepto: 'Papelería' },
    { folio: 'REC-005', emisor: 'CFE Suministro', rfc: 'CFE0405173J2', monto: 4200, iva: 566.04, fecha: '2026-07-08', concepto: 'Electricidad' },
    { folio: 'REC-006', emisor: 'AT&T Telecom', rfc: 'ATE0201176J1', monto: 1299, iva: 175.31, fecha: '2026-07-09', concepto: 'Internet y teléfono' },
    { folio: 'REC-007', emisor: 'Home Depot México', rfc: 'HDM9508229I8', monto: 25600, iva: 3457.93, fecha: '2026-07-10', concepto: 'Herramientas' },
  ];

  for (const f of facturasRecibidas) {
    await db.factura.create({
      data: {
        folio: f.folio,
        serie: 'REC',
        fecha: new Date(f.fecha),
        monto: f.monto,
        subtotal: f.monto - f.iva,
        totalImpuestos: f.iva,
        moneda: 'MXN',
        tipoComprobante: 'I',
        metodoPago: 'PUE',
        formaPago: '04',
        uuid: `${f.folio}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        direccion: 'recibida',
        estado: 'timbrada',
        empresaId: empresa.id,
        emisorRfc: f.rfc,
        emisorNombre: f.emisor,
        receptorRfc: empresa.rfc,
        receptorNombre: empresa.nombre,
      },
    });
  }
  console.log(`✅ ${facturasRecibidas.length} facturas recibidas creadas`);

  console.log('🎉 Seed completo!');
  console.log(`   Total: ${facturasEmitidas.length + facturasRecibidas.length} facturas`);
  console.log(`   Emitidas: ${facturasEmitidas.reduce((s, f) => s + f.monto, 0).toLocaleString('es-MX')} MXN`);
  console.log(`   Recibidas: ${facturasRecibidas.reduce((s, f) => s + f.monto, 0).toLocaleString('es-MX')} MXN`);
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
