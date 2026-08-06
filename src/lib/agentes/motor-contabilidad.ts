import { db } from '@/lib/db';
import { registrarAuditTrail } from '@/lib/audit-trail';

/**
 * MOTOR DE CONTABILIDAD AUTOMÁTICA CON PARTIDA DOBLE
 *
 * Inspirado en blnk-ts (ledger de doble entrada).
 *
 * Cada operación genera una póliza con al menos 2 líneas:
 * - Una línea de CARGO (débito)
 * - Una línea de ABONO (crédito)
 * - La suma de cargos = suma de abonos (siempre cuadrado)
 *
 * Catálogo de cuentas (simplificado):
 *
 * ACTIVOS (1xxx)
 *   1000 Bancos
 *   1100 Clientes (cuentas por cobrar)
 *   1200 IVA acreditable
 *   1300 Inventario
 *
 * PASIVOS (2xxx)
 *   2000 Proveedores (cuentas por pagar)
 *   2100 IVA por pagar
 *   2200 ISR por pagar
 *   2300 Nómina por pagar
 *
 * CAPITAL (3xxx)
 *   3000 Capital social
 *
 * INGRESOS (4xxx)
 *   4000 Ventas (ingresos por servicios)
 *   4100 Otros ingresos
 *
 * COSTOS Y GASTOS (5xxx)
 *   5000 Costo de ventas
 *   5100 Gastos administrativos
 *   5200 Gastos de venta
 *   5300 Gastos de nómina
 *   5400 Impuestos (ISR, IVA pagado)
 */

export const CATALOGO_CUENTAS: Record<string, { nombre: string; tipo: string; naturaleza: string }> = {
  '1000': { nombre: 'Bancos', tipo: 'activo', naturaleza: 'deudora' },
  '1100': { nombre: 'Clientes', tipo: 'activo', naturaleza: 'deudora' },
  '1200': { nombre: 'IVA acreditable', tipo: 'activo', naturaleza: 'deudora' },
  '1300': { nombre: 'Inventario', tipo: 'activo', naturaleza: 'deudora' },
  '2000': { nombre: 'Proveedores', tipo: 'pasivo', naturaleza: 'acreedora' },
  '2100': { nombre: 'IVA por pagar', tipo: 'pasivo', naturaleza: 'acreedora' },
  '2200': { nombre: 'ISR por pagar', tipo: 'pasivo', naturaleza: 'acreedora' },
  '2300': { nombre: 'Nómina por pagar', tipo: 'pasivo', naturaleza: 'acreedora' },
  '3000': { nombre: 'Capital social', tipo: 'capital', naturaleza: 'acreedora' },
  '4000': { nombre: 'Ventas', tipo: 'ingreso', naturaleza: 'acreedora' },
  '4100': { nombre: 'Otros ingresos', tipo: 'ingreso', naturaleza: 'acreedora' },
  '5000': { nombre: 'Costo de ventas', tipo: 'gasto', naturaleza: 'deudora' },
  '5100': { nombre: 'Gastos administrativos', tipo: 'gasto', naturaleza: 'deudora' },
  '5200': { nombre: 'Gastos de venta', tipo: 'gasto', naturaleza: 'deudora' },
  '5300': { nombre: 'Gastos de nómina', tipo: 'gasto', naturaleza: 'deudora' },
  '5400': { nombre: 'Impuestos', tipo: 'gasto', naturaleza: 'deudora' },
};

interface LineaPoliza {
  cuentaCodigo: string;
  cuentaNombre: string;
  tipo: 'cargo' | 'abono';
  monto: number;
  origenTipo?: string;
  origenId?: string;
  descripcion?: string;
}

interface PolizaInput {
  folio: string;
  fecha: Date;
  tipo: 'ingreso' | 'egreso' | 'diario';
  concepto: string;
  lineas: LineaPoliza[];
  empresaId: string;
}

/**
 * Crea una póliza con partida doble.
 * Valida que la suma de cargos = suma de abonos.
 */
export async function crearPoliza(input: PolizaInput): Promise<{ id: string; cuadrada: boolean; diferencia: number }> {
  // Validar partida doble
  const totalCargo = input.lineas.filter(l => l.tipo === 'cargo').reduce((s, l) => s + l.monto, 0);
  const totalAbono = input.lineas.filter(l => l.tipo === 'abono').reduce((s, l) => s + l.monto, 0);
  const diferencia = Math.abs(totalCargo - totalAbono);
  const cuadrada = diferencia < 0.01;

  if (!cuadrada) {
    console.warn(`⚠️ Póliza ${input.folio} NO cuadra: cargo=${totalCargo}, abono=${totalAbono}, diff=${diferencia}`);
  }

  // Crear póliza
  const poliza = await db.poliza.create({
    data: {
      folio: input.folio,
      fecha: input.fecha,
      tipo: input.tipo,
      concepto: input.concepto,
      cargo: totalCargo,
      abono: totalAbono,
      estado: cuadrada ? 'conciliada' : 'descuadrada',
      empresaId: input.empresaId,
      lineas: {
        create: input.lineas.map(l => ({
          cuentaCodigo: l.cuentaCodigo,
          cuentaNombre: l.cuentaNombre,
          tipo: l.tipo,
          monto: l.monto,
          origenTipo: l.origenTipo || null,
          origenId: l.origenId || null,
          descripcion: l.descripcion || null,
        })),
      },
    },
  });

  return { id: poliza.id, cuadrada, diferencia };
}

/**
 * Genera automáticamente las pólizas de un mes a partir de:
 * - Facturas emitidas (ingresos)
 * - Facturas recibidas (compras/gastos)
 * - Recibos de nómina
 * - Movimientos bancarios
 */
export async function generarPolizasMes(empresaId: string, mes: number, anio: number): Promise<{
  polizasCreadas: number;
  errores: string[];
  resumen: any;
}> {
  const inicioMes = new Date(anio, mes - 1, 1);
  const finMes = new Date(anio, mes, 0, 23, 59, 59);
  const errores: string[] = [];
  let polizasCreadas = 0;

  // Borrar pólizas existentes del mes (para regenerar)
  await db.poliza.deleteMany({
    where: {
      empresaId,
      fecha: { gte: inicioMes, lte: finMes },
    },
  });

  // ===== 1. FACTURAS EMITIDAS (Ingresos) =====
  // Póliza: Cargo a Bancos/Clientes, Abono a Ventas e IVA por pagar
  const facturasEmitidas = await db.factura.findMany({
    where: {
      empresaId,
      direccion: 'emitida',
      fecha: { gte: inicioMes, lte: finMes },
      estado: 'timbrada',
      tipoComprobante: 'I',
    },
  });

  for (const f of facturasEmitidas) {
    try {
      const subtotal = f.subtotal - f.descuento;
      const iva = f.totalImpuestos;
      const total = f.total;

      await crearPoliza({
        folio: `ING-${f.serie || ''}${f.folio}`,
        fecha: f.fecha,
        tipo: 'ingreso',
        concepto: `Venta — Folio ${f.serie || ''}${f.folio} — ${f.receptorNombre || 'Cliente'}`,
        empresaId,
        lineas: [
          {
            cuentaCodigo: '1100',
            cuentaNombre: CATALOGO_CUENTAS['1100'].nombre,
            tipo: 'cargo',
            monto: total,
            origenTipo: 'factura',
            origenId: f.id,
            descripcion: `Cliente: ${f.receptorNombre || 'N/A'}`,
          },
          {
            cuentaCodigo: '4000',
            cuentaNombre: CATALOGO_CUENTAS['4000'].nombre,
            tipo: 'abono',
            monto: subtotal,
            origenTipo: 'factura',
            origenId: f.id,
            descripcion: 'Venta de servicios',
          },
          ...(iva > 0 ? [{
            cuentaCodigo: '2100',
            cuentaNombre: CATALOGO_CUENTAS['2100'].nombre,
            tipo: 'abono',
            monto: iva,
            origenTipo: 'factura',
            origenId: f.id,
            descripcion: 'IVA trasladado',
          }] : []),
        ],
      });
      polizasCreadas++;
    } catch (e: any) {
      errores.push(`Error en factura emitida ${f.folio}: ${e.message}`);
    }
  }

  // ===== 2. FACTURAS RECIBIDAS (Compras/Gastos) =====
  // Póliza: Cargo a Costos/Gastos e IVA acreditable, Abono a Proveedores
  const facturasRecibidas = await db.factura.findMany({
    where: {
      empresaId,
      direccion: 'recibida',
      fecha: { gte: inicioMes, lte: finMes },
      estado: 'timbrada',
      tipoComprobante: 'I',
    },
  });

  for (const f of facturasRecibidas) {
    try {
      const subtotal = f.subtotal - f.descuento;
      const iva = f.totalImpuestos;
      const total = f.total;

      // Determinar cuenta de gasto según categoría del proveedor
      const cuentaGasto = '5000'; // Por defecto Costo de ventas

      await crearPoliza({
        folio: `EGR-${f.serie || ''}${f.folio}`,
        fecha: f.fecha,
        tipo: 'egreso',
        concepto: `Compra — Folio ${f.serie || ''}${f.folio} — ${f.emisorNombre || 'Proveedor'}`,
        empresaId,
        lineas: [
          {
            cuentaCodigo: cuentaGasto,
            cuentaNombre: CATALOGO_CUENTAS[cuentaGasto].nombre,
            tipo: 'cargo',
            monto: subtotal,
            origenTipo: 'factura',
            origenId: f.id,
            descripcion: `Proveedor: ${f.emisorNombre || 'N/A'}`,
          },
          ...(iva > 0 ? [{
            cuentaCodigo: '1200',
            cuentaNombre: CATALOGO_CUENTAS['1200'].nombre,
            tipo: 'cargo',
            monto: iva,
            origenTipo: 'factura',
            origenId: f.id,
            descripcion: 'IVA acreditable',
          }] : []),
          {
            cuentaCodigo: '2000',
            cuentaNombre: CATALOGO_CUENTAS['2000'].nombre,
            tipo: 'abono',
            monto: total,
            origenTipo: 'factura',
            origenId: f.id,
            descripcion: `Proveedor: ${f.emisorNombre || 'N/A'}`,
          },
        ],
      });
      polizasCreadas++;
    } catch (e: any) {
      errores.push(`Error en factura recibida ${f.folio}: ${e.message}`);
    }
  }

  // ===== 3. NÓMINA =====
  // Póliza: Cargo a Gastos de nómina, Abono a Bancos
  const recibosNomina = await db.reciboNomina.findMany({
    where: {
      empresaId,
      fecha: { gte: inicioMes, lte: finMes },
    },
  });

  if (recibosNomina.length > 0) {
    try {
      const totalPercepciones = recibosNomina.reduce((s, r) => s + r.totalPercepciones, 0);
      const totalDeducciones = recibosNomina.reduce((s, r) => s + r.totalDeducciones, 0);
      const totalNeto = recibosNomina.reduce((s, r) => s + r.neto, 0);

      await crearPoliza({
        folio: `NOM-${anio}${String(mes).padStart(2, '0')}`,
        fecha: new Date(anio, mes - 1, 15, 12, 0, 0),
        tipo: 'egreso',
        concepto: `Nómina del mes — ${recibosNomina.length} recibos`,
        empresaId,
        lineas: [
          {
            cuentaCodigo: '5300',
            cuentaNombre: CATALOGO_CUENTAS['5300'].nombre,
            tipo: 'cargo',
            monto: totalPercepciones,
            origenTipo: 'nomina',
            descripcion: `Percepciones (${recibosNomina.length} recibos)`,
          },
          {
            cuentaCodigo: '2300',
            cuentaNombre: CATALOGO_CUENTAS['2300'].nombre,
            tipo: 'abono',
            monto: totalDeducciones,
            origenTipo: 'nomina',
            descripcion: 'Deducciones (ISR, IMSS)',
          },
          {
            cuentaCodigo: '1000',
            cuentaNombre: CATALOGO_CUENTAS['1000'].nombre,
            tipo: 'abono',
            monto: totalNeto,
            origenTipo: 'nomina',
            descripcion: 'Pago neto a empleados',
          },
        ],
      });
      polizasCreadas++;
    } catch (e: any) {
      errores.push(`Error en nómina: ${e.message}`);
    }
  }

  // ===== 4. MOVIMIENTOS BANCARIOS (depósitos/pagos) =====
  // Póliza: Cargo a Bancos, Abono a Clientes (depósito) o Cargo a Proveedores, Abono a Bancos (pago)
  const movsBanco = await db.movimientoBanco.findMany({
    where: {
      cuenta: { empresaId },
      fecha: { gte: inicioMes, lte: finMes },
    },
    include: { cuenta: { select: { banco: true } } },
  });

  // Solo crear pólizas por movimientos no conciliados con facturas
  // (los conciliados ya tienen póliza desde la factura)
  const movsSinFactura = movsBanco.filter(m => !m.facturaConciliadaId);

  for (const mov of movsSinFactura) {
    try {
      const esDeposito = mov.monto > 0;
      const montoAbs = Math.abs(mov.monto);

      await crearPoliza({
        folio: `BAN-${mov.id.slice(-8)}`,
        fecha: mov.fecha,
        tipo: 'diario',
        concepto: `${esDeposito ? 'Depósito' : 'Pago'} bancario — ${mov.cuenta.banco} — ${mov.concepto.slice(0, 60)}`,
        empresaId,
        lineas: [
          {
            cuentaCodigo: esDeposito ? '1000' : '2000',
            cuentaNombre: CATALOGO_CUENTAS[esDeposito ? '1000' : '2000'].nombre,
            tipo: 'cargo',
            monto: montoAbs,
            origenTipo: 'movimiento_banco',
            origenId: mov.id,
            descripcion: mov.concepto.slice(0, 100),
          },
          {
            cuentaCodigo: esDeposito ? '4100' : '1000',
            cuentaNombre: CATALOGO_CUENTAS[esDeposito ? '4100' : '1000'].nombre,
            tipo: 'abono',
            monto: montoAbs,
            origenTipo: 'movimiento_banco',
            origenId: mov.id,
            descripcion: esDeposito ? 'Ingreso bancario' : 'Pago bancario',
          },
        ],
      });
      polizasCreadas++;
    } catch (e: any) {
      errores.push(`Error en movimiento banco ${mov.id}: ${e.message}`);
    }
  }

  // ===== RESUMEN =====
  const resumen = {
    facturasEmitidas: facturasEmitidas.length,
    facturasRecibidas: facturasRecibidas.length,
    recibosNomina: recibosNomina.length,
    movimientosBanco: movsBanco.length,
    movimientosSinFactura: movsSinFactura.length,
  };

  // Registrar audit trail
  await registrarAuditTrail({
    agente: 'motor-contabilidad',
    herramienta: 'generar_polizas_mes',
    input: { empresaId, mes, anio },
    output: { polizasCreadas, errores: errores.length, resumen },
    scoreConfianza: errores.length === 0 ? 1.0 : Math.max(0, 1 - errores.length * 0.1),
    verificado: errores.length === 0,
    observaciones: `${polizasCreadas} pólizas generadas, ${errores.length} errores`,
    empresaId,
  });

  return { polizasCreadas, errores, resumen };
}

/**
 * Obtiene el balance de prueba (saldos de todas las cuentas)
 */
export async function obtenerBalancePrueba(empresaId: string, mes: number, anio: number) {
  const inicioMes = new Date(anio, mes - 1, 1);
  const finMes = new Date(anio, mes, 0, 23, 59, 59);

  const lineas = await db.polizaLinea.findMany({
    where: {
      poliza: {
        empresaId,
        fecha: { gte: inicioMes, lte: finMes },
      },
    },
    select: {
      cuentaCodigo: true,
      cuentaNombre: true,
      tipo: true,
      monto: true,
    },
  });

  // Agrupar por cuenta
  const porCuenta = new Map<string, { codigo: string; nombre: string; cargos: number; abonos: number }>();

  for (const l of lineas) {
    const key = l.cuentaCodigo;
    if (!porCuenta.has(key)) {
      porCuenta.set(key, { codigo: l.cuentaCodigo, nombre: l.cuentaNombre, cargos: 0, abonos: 0 });
    }
    const cuenta = porCuenta.get(key)!;
    if (l.tipo === 'cargo') cuenta.cargos += l.monto;
    else cuenta.abonos += l.monto;
  }

  const cuentas = Array.from(porCuenta.values()).map(c => {
    const catalogo = CATALOGO_CUENTAS[c.codigo];
    const naturaleza = catalogo?.naturaleza || 'deudora';
    const saldo = naturaleza === 'deudora' ? c.cargos - c.abonos : c.abonos - c.cargos;
    return {
      ...c,
      tipo: catalogo?.tipo || 'desconocido',
      naturaleza,
      saldo,
    };
  });

  const totalCargos = cuentas.reduce((s, c) => s + c.cargos, 0);
  const totalAbonos = cuentas.reduce((s, c) => s + c.abonos, 0);

  return {
    cuentas: cuentas.sort((a, b) => a.codigo.localeCompare(b.codigo)),
    totalCargos,
    totalAbonos,
    cuadrado: Math.abs(totalCargos - totalAbonos) < 0.01,
  };
}
