/**
 * Seed completo del Sistema Fiscal IA ERP
 * Ejecutar: bun run db:seed
 */
import { db } from '../src/lib/db';

async function main() {
  console.log('🌱 Sembrando sistema completo...');

  // Limpiar
  await db.conversacion.deleteMany();
  await db.recordatorio.deleteMany();
  await db.nota.deleteMany();
  await db.tarea.deleteMany();
  await db.oportunidad.deleteMany();
  await db.poliza.deleteMany();
  await db.movimientoBanco.deleteMany();
  await db.cuentaBancaria.deleteMany();
  await db.producto.deleteMany();
  await db.ordenCompra.deleteMany();
  await db.reciboNomina.deleteMany();
  await db.empleado.deleteMany();
  await db.factura.deleteMany();
  await db.proveedor.deleteMany();
  await db.cliente.deleteMany();
  await db.usuario.deleteMany();
  await db.empresa.deleteMany();

  // EMPRESA
  const empresa = await db.empresa.create({
    data: {
      nombre: 'Construcciones Hernández SAC',
      rfc: 'HEH850415ABC',
      regimenFiscal: 'Persona Moral',
      email: 'admin@hernandez.mx',
      telefono: '555-123-4567',
      direccion: 'Av. Reforma 123, CDMX',
    },
  });
  console.log('✅ Empresa creada');

  // USUARIOS
  await db.usuario.createMany({
    data: [
      { email: 'admin@hernandez.mx', nombre: 'Hernández Admin', password: 'admin123', rol: 'admin', empresaId: empresa.id },
      { email: 'maria@hernandez.mx', nombre: 'María López', password: 'maria123', rol: 'contador', empresaId: empresa.id },
    ],
  });

  // CLIENTES
  const clientes = await Promise.all([
    db.cliente.create({ data: { nombre: 'Tania García López', rfc: 'GALT850415AB1', email: 'tania@example.com', empresaId: empresa.id } }),
    db.cliente.create({ data: { nombre: 'Constructora Norte SA', rfc: 'CNO8501012A1', email: 'contacto@norte.com', empresaId: empresa.id } }),
    db.cliente.create({ data: { nombre: 'Desarrollo Urbano del Bajío', rfc: 'DUB9509203K9', email: 'urban@bajio.mx', empresaId: empresa.id } }),
  ]);

  // PROVEEDORES
  const proveedores = await Promise.all([
    db.proveedor.create({ data: { nombre: 'Oficina del Centro', rfc: 'OCE8001014M1', servicio: 'Renta oficina', empresaId: empresa.id } }),
    db.proveedor.create({ data: { nombre: 'Ferretería Industrial', rfc: 'FIN8205063A2', servicio: 'Material construcción', empresaId: empresa.id } }),
    db.proveedor.create({ data: { nombre: 'Gasolina Estación 45', rfc: 'GEH9509118P3', servicio: 'Combustible', empresaId: empresa.id } }),
    db.proveedor.create({ data: { nombre: 'CFE Suministro', rfc: 'CFE0405173J2', servicio: 'Electricidad', empresaId: empresa.id } }),
    db.proveedor.create({ data: { nombre: 'AT&T Telecom', rfc: 'ATE0201176J1', servicio: 'Internet y teléfono', empresaId: empresa.id } }),
    db.proveedor.create({ data: { nombre: 'Home Depot México', rfc: 'HDM9508229I8', servicio: 'Herramientas', empresaId: empresa.id } }),
    db.proveedor.create({ data: { nombre: 'Papelería La Economic', rfc: 'PLE7103155T7', servicio: 'Papelería', empresaId: empresa.id } }),
  ]);

  // EMPLEADOS
  const empleados = await Promise.all([
    db.empleado.create({ data: { nombre: 'Juan Pérez González', rfc: 'PEGJ850101AB1', puesto: 'Supervisor de obra', departamento: 'Operación', salarioMensual: 22000, empresaId: empresa.id } }),
    db.empleado.create({ data: { nombre: 'María López Ruiz', rfc: 'LORM900215CDE', puesto: 'Administradora', departamento: 'Administración', salarioMensual: 18000, empresaId: empresa.id } }),
    db.empleado.create({ data: { nombre: 'Carlos Ramírez Soto', rfc: 'RASC880712HDF', puesto: 'Arquitecto', departamento: 'Diseño', salarioMensual: 25000, empresaId: empresa.id } }),
    db.empleado.create({ data: { nombre: 'Ana Torres Vega', rfc: 'TOVA920815MDF', puesto: 'Diseñadora', departamento: 'Diseño', salarioMensual: 15000, empresaId: empresa.id } }),
    db.empleado.create({ data: { nombre: 'Luis Mora Díaz', rfc: 'MODL800101HDF', puesto: 'Oficial', departamento: 'Operación', salarioMensual: 12000, empresaId: empresa.id } }),
  ]);

  // FACTURAS EMITIDAS
  const facturasEmitidas = [
    { folio: 'A-001', clienteIdx: 0, total: 45000, concepto: 'Asesoría estructural' },
    { folio: 'A-002', clienteIdx: 1, total: 62500, concepto: 'Supervisión de obra' },
    { folio: 'A-003', clienteIdx: 2, total: 87000, concepto: 'Planos ejecutivos' },
    { folio: 'A-004', clienteIdx: 0, total: 32500, concepto: 'Visita técnica' },
    { folio: 'A-005', clienteIdx: 1, total: 18500, concepto: 'Diseño preliminar' },
    { folio: 'A-006', clienteIdx: 2, total: 124000, concepto: 'Dirección de obra' },
    { folio: 'A-007', clienteIdx: 0, total: 8750, concepto: 'Consultoría' },
  ];

  for (const f of facturasEmitidas) {
    const c = clientes[f.clienteIdx];
    const subtotal = f.total / 1.16;
    const iva = f.total - subtotal;
    await db.factura.create({
      data: {
        folio: f.folio, serie: 'A', fecha: new Date('2026-07-0' + (f.clienteIdx + 1)),
        subtotal, totalImpuestos: iva, total: f.total, tipoComprobante: 'I',
        uuid: `${f.folio}-${Date.now()}`, direccion: 'emitida', estado: 'timbrada',
        empresaId: empresa.id, clienteId: c.id, receptorRfc: c.rfc, receptorNombre: c.nombre,
        emisorRfc: empresa.rfc, emisorNombre: empresa.nombre, concepto: f.concepto,
      },
    });
  }

  // FACTURAS RECIBIDAS
  const facturasRecibidas = [
    { folio: 'REC-001', provIdx: 0, total: 3200, concepto: 'Renta oficina julio' },
    { folio: 'REC-002', provIdx: 1, total: 18750, concepto: 'Material construcción' },
    { folio: 'REC-003', provIdx: 2, total: 5500, concepto: 'Combustible' },
    { folio: 'REC-004', provIdx: 6, total: 1850, concepto: 'Papelería' },
    { folio: 'REC-005', provIdx: 3, total: 4200, concepto: 'Electricidad' },
    { folio: 'REC-006', provIdx: 4, total: 1299, concepto: 'Internet y teléfono' },
    { folio: 'REC-007', provIdx: 5, total: 25600, concepto: 'Herramientas' },
  ];

  for (const f of facturasRecibidas) {
    const p = proveedores[f.provIdx];
    const subtotal = f.total / 1.16;
    const iva = f.total - subtotal;
    await db.factura.create({
      data: {
        folio: f.folio, serie: 'REC', fecha: new Date('2026-07-0' + (f.provIdx + 1)),
        subtotal, totalImpuestos: iva, total: f.total, tipoComprobante: 'I',
        uuid: `${f.folio}-${Date.now()}`, direccion: 'recibida', estado: 'timbrada',
        empresaId: empresa.id, proveedorId: p.id, emisorRfc: p.rfc, emisorNombre: p.nombre,
        receptorRfc: empresa.rfc, receptorNombre: empresa.nombre, concepto: f.concepto,
      },
    });
  }
  console.log(`✅ ${facturasEmitidas.length + facturasRecibidas.length} facturas`);

  // RECIBOS DE NÓMINA
  for (const emp of empleados) {
    const deducciones = emp.salarioMensual * 0.15;
    const neto = emp.salarioMensual - deducciones;
    await db.reciboNomina.create({
      data: {
        folio: `NOM-${emp.rfc.slice(0, 4)}-07-26`,
        fecha: new Date('2026-07-15'),
        periodo: 'Primera quincena julio 2026',
        totalPercepciones: emp.salarioMensual,
        totalDeducciones: deducciones,
        neto,
        isr: deducciones * 0.5,
        imss: deducciones * 0.3,
        estado: 'timbrado',
        empleadoId: emp.id,
        empresaId: empresa.id,
      },
    });
  }

  // ÓRDENES DE COMPRA
  for (const f of facturasRecibidas) {
    const p = proveedores[f.provIdx];
    await db.ordenCompra.create({
      data: {
        folio: `OC-${f.folio}`,
        fecha: new Date('2026-07-0' + (f.provIdx + 1)),
        concepto: f.concepto, monto: f.total, estado: 'recibida',
        proveedorId: p.id, empresaId: empresa.id,
      },
    });
  }

  // PRODUCTOS
  await db.producto.createMany({
    data: [
      { codigo: 'P001', nombre: 'Cemento gris 50kg', categoria: 'Construcción', existencia: 120, minimo: 20, precio: 185, empresaId: empresa.id },
      { codigo: 'P002', nombre: 'Varilla 3/8"', categoria: 'Construcción', existencia: 8, minimo: 20, precio: 95, empresaId: empresa.id },
      { codigo: 'P003', nombre: 'Block 15x20x40', categoria: 'Construcción', existencia: 500, minimo: 100, precio: 15, empresaId: empresa.id },
      { codigo: 'P004', nombre: 'Martillo carpintero', categoria: 'Herramientas', existencia: 5, minimo: 3, precio: 280, empresaId: empresa.id },
      { codigo: 'P005', nombre: 'Taladro 1/2"', categoria: 'Herramientas', existencia: 2, minimo: 5, precio: 1800, empresaId: empresa.id },
      { codigo: 'P006', nombre: 'Papel bond carta', categoria: 'Papelería', existencia: 50, minimo: 10, precio: 85, empresaId: empresa.id },
    ],
  });

  // CUENTAS BANCARIAS
  const banorte = await db.cuentaBancaria.create({ data: { banco: 'Banorte', cuenta: '****4521', saldo: 716000, tipo: 'operaciones', empresaId: empresa.id } });
  const santander = await db.cuentaBancaria.create({ data: { banco: 'Santander', cuenta: '****8830', saldo: 65000, tipo: 'ahorro', empresaId: empresa.id } });

  // MOVIMIENTOS BANCARIOS
  await db.movimientoBanco.createMany({
    data: [
      { fecha: new Date('2026-07-10'), concepto: 'Depósito cliente Tania García', monto: 45000, tipo: 'ingreso', cuentaId: banorte.id },
      { fecha: new Date('2026-07-09'), concepto: 'Pago nómina quincenal', monto: -46000, tipo: 'egreso', cuentaId: banorte.id },
      { fecha: new Date('2026-07-08'), concepto: 'Aporte fondo emergencia', monto: 15000, tipo: 'transferencia', cuentaId: santander.id },
      { fecha: new Date('2026-07-07'), concepto: 'Home Depot herramientas', monto: -25600, tipo: 'egreso', cuentaId: banorte.id },
      { fecha: new Date('2026-07-05'), concepto: 'CFE electricidad', monto: -4200, tipo: 'egreso', cuentaId: banorte.id },
    ],
  });

  // PÓLIZAS
  await db.poliza.createMany({
    data: [
      { folio: 'P-2026-142', fecha: new Date('2026-07-10'), tipo: 'ingreso', concepto: 'Venta factura A-007', cargo: 8750 },
      { folio: 'P-2026-141', fecha: new Date('2026-07-09'), tipo: 'egreso', concepto: 'Nómina quincenal', cargo: 46000 },
      { folio: 'P-2026-140', fecha: new Date('2026-07-08'), tipo: 'egreso', concepto: 'Compra herramientas', cargo: 25600 },
      { folio: 'P-2026-139', fecha: new Date('2026-07-07'), tipo: 'egreso', concepto: 'CFE electricidad', cargo: 4200, estado: 'pendiente' },
    ],
  });

  // OPORTUNIDADES CRM
  await db.oportunidad.createMany({
    data: [
      { nombre: 'Supervisión obra Polanco', etapa: 'negociacion', monto: 180000, probabilidad: 60, fechaCierre: new Date('2026-08-15'), clienteId: clientes[2].id },
      { nombre: 'Diseño plaza', etapa: 'propuesta', monto: 95000, probabilidad: 40, fechaCierre: new Date('2026-08-30'), clienteId: clientes[1].id },
      { nombre: 'Auditoría estructural', etapa: 'cerrada', monto: 45000, probabilidad: 100, fechaCierre: new Date('2026-07-10'), clienteId: clientes[0].id },
    ],
  });

  // TAREAS ABBAX
  await db.tarea.createMany({
    data: [
      { titulo: 'auditar facturas del SAT', prioridad: 'urgente', categoria: 'trabajo', origen: 'voz' },
      { titulo: 'Llamar al contador', prioridad: 'urgente', categoria: 'trabajo', origen: 'voz' },
    ],
  });

  // NOTAS ABBAX
  await db.nota.createMany({
    data: [
      { titulo: '🛒 Lista de compras (5)', contenido: '1. pan\n2. leche\n3. huevos\n4. jabon\n5. fruta', color: 'verde', origen: 'voz' },
      { titulo: 'Compras del supermercado', contenido: 'comprar leche y pan', color: 'amarillo' },
    ],
  });

  console.log('🎉 Sistema sembrado completamente!');
  console.log(`   - 1 empresa, 3 clientes, 7 proveedores, 5 empleados`);
  console.log(`   - ${facturasEmitidas.length + facturasRecibidas.length} facturas, 5 recibos nómina`);
  console.log(`   - 7 órdenes compra, 6 productos, 2 cuentas bancarias`);
  console.log(`   - 5 movimientos, 4 pólizas, 3 oportunidades CRM`);
  console.log(`   - 2 tareas Abbax, 2 notas Abbax`);
}

main()
  .catch((e) => { console.error('❌ Error:', e); process.exit(1); })
  .finally(async () => { await db.$disconnect(); });
