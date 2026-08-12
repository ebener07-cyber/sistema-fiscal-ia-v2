import { db } from '@/lib/db';
import { registrarAuditTrail } from '@/lib/audit-trail';

/**
 * CONCILIADOR INTELIGENTE v2 — Motor de mapeo + semáforo + pagos múltiples
 *
 * Inspirado en la estrategia de 3 pasos:
 * 1. Motor de Mapeo: clasifica movimientos con cuenta contable + estado
 * 2. Detección de Pagos Múltiples: agrupa movimientos del mismo día + beneficiario
 * 3. Dashboard: genera datos estructurados con semáforo verde/amarillo/rojo
 *
 * Estados (semáforo):
 * - 🟢 Conciliado Auto: coincide con regla o CFDI
 * - 🟡 Pendiente Comprobación: anticipo a empleado, requiere factura
 * - 🔴 Requiere Acción: no coincide con nada, necesita revisión humana
 */

interface ReglaMapeo {
  keywords: string[];
  categoria: string;
  cuentaContable: string;
  requiereCfdi: boolean;
  estado: 'Conciliado Auto' | 'Pendiente Comprobación' | 'Requiere Acción';
}

const REGLAS_INTELIGENTES: ReglaMapeo[] = [
  // Gastos Financieros (no requieren CFDI)
  { keywords: ['CGO IMPTO FED', 'IMPTO FED'], categoria: 'Gastos Financieros', cuentaContable: '5100', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['IVA POR COMISION', 'IVA COM'], categoria: 'Impuestos Acreditables', cuentaContable: '1200', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['COMISION', 'COMISIÓN', 'MEMBRESIA'], categoria: 'Gastos Financieros', cuentaContable: '5100', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['INTERESES EXENTO', 'RENDIMIENTO'], categoria: 'Ingresos Financieros', cuentaContable: '4100', requiereCfdi: false, estado: 'Conciliado Auto' },

  // Servicio de Deuda (no requiere CFDI) — MEJORA 1: ampliado con más keywords
  { keywords: ['CAPITAL DE CREDITO', 'CARGO CAPITAL', 'CRE_', 'PAGO DE CREDITO', 'PAGO DE CAPITAL', 'PAGO CAPITAL', '089615962', '91416982'], categoria: 'Servicio de Deuda', cuentaContable: '2200', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['INTERESES DE CREDITO', 'CGO INTERESES', 'INTERES HIPOTECARIO', 'CREDITO SANTANDER TANIA'], categoria: 'Financiamiento / Deuda', cuentaContable: '2200', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['DISPOSICION', 'DISPOSICION CREDITO', 'CREDITO EN LINEA'], categoria: 'Financiamiento / Deuda', cuentaContable: '3100', requiereCfdi: false, estado: 'Conciliado Auto' },

  // Seguros (no requieren CFDI)
  { keywords: ['SEGURO', 'PRIMA SEGURO'], categoria: 'Seguros', cuentaContable: '5100', requiereCfdi: false, estado: 'Conciliado Auto' },

  // Impuestos y Nómina (no requieren CFDI)
  { keywords: ['IMSS', 'LDC-IMSS'], categoria: 'Impuestos y Nómina', cuentaContable: '5300', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['INFONAVIT'], categoria: 'Impuestos y Nómina', cuentaContable: '5300', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['PAGO REFERENCIADO', 'LINEA CAPTURA'], categoria: 'Impuestos y Nómina', cuentaContable: '5400', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['ISR', 'PAGO PROVISIONAL', 'DECLARACION'], categoria: 'Impuestos y Nómina', cuentaContable: '5400', requiereCfdi: false, estado: 'Conciliado Auto' },

  // Movimientos Internos (no requieren CFDI)
  { keywords: ['TRASPASO', 'ENTRE CUENTAS PROPIAS'], categoria: 'Movimientos Internos', cuentaContable: '1000', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['RETIRO DEP.', 'RETIRO DEPOSITO'], categoria: 'Caja Chica', cuentaContable: '1000', requiereCfdi: false, estado: 'Conciliado Auto' },

  // Tarjetas de Crédito (no requieren CFDI)
  { keywords: ['PAGO TARJETA', 'TARJETA DE CREDITO'], categoria: 'Pasivos', cuentaContable: '2000', requiereCfdi: false, estado: 'Conciliado Auto' },

  // ===== ANTICIPOS / PRÉSTAMOS / CAJA CHICA (🟡 Mapeado Auto — No requieren CFDI) ===== MEJORA 1: ampliado
  { keywords: ['TANIA GUADALUPE', 'TANIA ROBLEDO', 'ROET951111', 'SUPERVISION DE CONSTRUCCION TANIA', 'SUPERVISION TANIA'], categoria: 'Anticipo Nómina / Caja Chica', cuentaContable: '1400', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['JUAN MANUEL POLO', 'POLO VELAZQUEZ'], categoria: 'Anticipo Nómina / Caja Chica', cuentaContable: '1400', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['GORDO', 'REEMBOLSO COMBUSTIBLE GORDO'], categoria: 'Anticipo Nómina / Caja Chica', cuentaContable: '1400', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['JUCA', 'REEMBOLSO JUCA'], categoria: 'Anticipo Nómina / Caja Chica', cuentaContable: '1400', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['ABEL LOREDO'], categoria: 'Préstamo / Cuenta por Cobrar', cuentaContable: '1300', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['ROBERTO ACOSTA', 'LUCIANO'], categoria: 'Anticipo Nómina / Caja Chica', cuentaContable: '1400', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['VIATICO', 'VIÁTICO', 'REEMBOLSO'], categoria: 'Anticipo Nómina / Caja Chica', cuentaContable: '1400', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['COMBUSTIBLE', 'GASOLINA', 'NICMA'], categoria: 'Anticipo Nómina / Caja Chica', cuentaContable: '5200', requiereCfdi: false, estado: 'Conciliado Auto' },

  // Gastos personales no deducibles
  { keywords: ['PENSION ALIMENTICIA', 'MISAYRA'], categoria: 'Gastos Personales', cuentaContable: '5100', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['TARJETA DE CREDITO FER', 'TARJETA TANIA', 'PAGO DE TARJETAS DE CREDITO'], categoria: 'Pasivos', cuentaContable: '2000', requiereCfdi: false, estado: 'Conciliado Auto' },
  { keywords: ['RETIRO DEP. ELECTRONICO', 'RETIRO DEPOSITO ELECTRONICO'], categoria: 'Traspaso Interno (No Deducible)', cuentaContable: '1000', requiereCfdi: false, estado: 'Conciliado Auto' },
];

interface ResultadoMovimiento {
  movimientoId: string;
  fecha: Date;
  banco: string;
  concepto: string;
  monto: number;
  categoria: string;
  cuentaContable: string;
  estado: 'Conciliado Auto' | 'Pendiente Comprobación' | 'Requiere Acción';
  requiereCfdi: boolean;
  esPagoMultiple: boolean;
  facturaConciliada?: string;
}

/**
 * PASO 1: Aplica el motor de mapeo automático a un movimiento
 *
 * CORRECCIÓN v6 (Problema #8): Las reglas de INTERESES ahora son sensibles
 * al signo del monto. Un CARGO (monto < 0) con concepto "INTERESES" debe
 * clasificarse como Gasto Financiero (5100), NO como Ingreso Financiero (4100).
 * Esto afecta directamente el estado de resultados.
 */
export function mapearMovimiento(concepto: string, monto: number): {
  categoria: string;
  cuentaContable: string;
  requiereCfdi: boolean;
  estado: 'Conciliado Auto' | 'Pendiente Comprobación' | 'Requiere Acción';
} {
  const upper = concepto.toUpperCase();
  const esCargo = monto < 0; // Pago → cargo bancario → gasto
  const esAbono = monto > 0; // Depósito → abono bancario → ingreso

  // CORRECCIÓN #8: Intereses con signo
  // Cualquier cargo con "INTERES" → Gasto Financiero (5100)
  // Solo abonos con "INTERESES EXENTO" / "RENDIMIENTO" → Ingreso Financiero (4100)
  if (esCargo && (upper.includes('INTERES') || upper.includes('INTERESES'))) {
    return {
      categoria: 'Gasto Financiero (Intereses)',
      cuentaContable: '5100',
      requiereCfdi: false,
      estado: 'Conciliado Auto',
    };
  }
  if (esAbono && (upper.includes('INTERESES EXENTO') || upper.includes('RENDIMIENTO'))) {
    return {
      categoria: 'Ingresos Financieros',
      cuentaContable: '4100',
      requiereCfdi: false,
      estado: 'Conciliado Auto',
    };
  }

  for (const regla of REGLAS_INTELIGENTES) {
    // Saltar regla de INTERESES EXENTO genérica porque ya se manejó arriba
    if (regla.keywords.some(k => k === 'INTERESES EXENTO' || k === 'RENDIMIENTO')) continue;
    for (const keyword of regla.keywords) {
      if (upper.includes(keyword)) {
        return {
          categoria: regla.categoria,
          cuentaContable: regla.cuentaContable,
          requiereCfdi: regla.requiereCfdi,
          estado: regla.estado,
        };
      }
    }
  }
  return {
    categoria: 'Sin Clasificar',
    cuentaContable: '5000',
    requiereCfdi: true,
    estado: 'Requiere Acción',
  };
}

/**
 * PASO 2: Detecta pagos múltiples potenciales
 * Agrupa movimientos del mismo día + mismo beneficiario
 */
export function detectarPagosMultiples(movimientos: Array<{ id: string; fecha: Date; concepto: string; monto: number }>): Set<string> {
  const pagosMultiples = new Set<string>();
  const grupos = new Map<string, string[]>();

  for (const mov of movimientos) {
    // Extraer beneficiario del concepto (primeras 3 palabras significativas)
    const palabras = mov.concepto.split(' ').filter(p => p.length > 3).slice(0, 3).join(' ');
    const fechaKey = mov.fecha.toISOString().slice(0, 10);
    const key = `${fechaKey}|${palabras.toUpperCase()}`;

    if (!grupos.has(key)) grupos.set(key, []);
    grupos.get(key)!.push(mov.id);
  }

  // Marcar movimientos que pertenecen a grupos de 2+
  for (const [, ids] of grupos) {
    if (ids.length > 1) {
      ids.forEach(id => pagosMultiples.add(id));
    }
  }

  return pagosMultiples;
}

/**
 * PASO 3: Genera datos para el dashboard con semáforo
 */
export async function generarDashboardConciliacion(empresaId: string): Promise<{
  totalMovimientos: number;
  conciliadosAuto: number;
  pendientesComprobacion: number;
  requierenAccion: number;
  porcentajeConciliacion: number;
  pagosMultiplesDetectados: number;
  porCategoria: Array<{ categoria: string; count: number; monto: number; estado: string }>;
  semaforo: { verde: number; amarillo: number; rojo: number };
}> {
  const movimientos = await db.movimientoBanco.findMany({
    where: { cuenta: { empresaId } },
    select: { id: true, concepto: true, monto: true, fecha: true, categoria: true, cuenta: { select: { banco: true } } },
    orderBy: { fecha: 'desc' },
  });

  let conciliadosAuto = 0;
  let pendientesComprobacion = 0;
  let requierenAccion = 0;
  const porCategoriaMap = new Map<string, { count: number; monto: number; estado: string }>();

  // Detectar pagos múltiples
  const pagosMultiples = detectarPagosMultiples(movimientos);

  for (const mov of movimientos) {
    const mapeo = mapearMovimiento(mov.concepto, mov.monto);
    if (mapeo.estado === 'Conciliado Auto') conciliadosAuto++;
    else if (mapeo.estado === 'Pendiente Comprobación') pendientesComprobacion++;
    else requierenAccion++;

    const cat = mapeo.categoria;
    if (!porCategoriaMap.has(cat)) {
      porCategoriaMap.set(cat, { count: 0, monto: 0, estado: mapeo.estado });
    }
    const c = porCategoriaMap.get(cat)!;
    c.count++;
    c.monto += Math.abs(mov.monto);
  }

  const total = movimientos.length;
  const porcentaje = total > 0 ? ((conciliadosAuto + pendientesComprobacion) / total * 100) : 0;

  return {
    totalMovimientos: total,
    conciliadosAuto,
    pendientesComprobacion,
    requierenAccion,
    porcentajeConciliacion: Math.round(porcentaje * 100) / 100,
    pagosMultiplesDetectados: pagosMultiples.size,
    porCategoria: Array.from(porCategoriaMap.entries())
      .map(([categoria, stats]) => ({ categoria, ...stats }))
      .sort((a, b) => b.count - a.count),
    semaforo: {
      verde: conciliadosAuto,
      amarillo: pendientesComprobacion,
      rojo: requierenAccion,
    },
  };
}

/**
 * Ejecuta el proceso completo: mapear + detectar pagos múltiples + actualizar BD
 */
export async function ejecutarConciliadorInteligente(empresaId: string): Promise<{
  totalProcesados: number;
  conciliadosAuto: number;
  pendientesComprobacion: number;
  requierenAccion: number;
  pagosMultiples: number;
  porcentajeConciliacion: number;
}> {
  const movimientos = await db.movimientoBanco.findMany({
    where: { cuenta: { empresaId } },
    select: { id: true, concepto: true, monto: true, fecha: true },
    orderBy: { fecha: 'desc' },
  });

  const pagosMultiplesSet = detectarPagosMultiples(movimientos);
  let conciliadosAuto = 0;
  let pendientesComprobacion = 0;
  let requierenAccion = 0;

  for (const mov of movimientos) {
    const mapeo = mapearMovimiento(mov.concepto, mov.monto);

    await db.movimientoBanco.update({
      where: { id: mov.id },
      data: {
        categoria: mapeo.categoria,
        subcategoria: mapeo.estado,
        scoreConfianza: mapeo.estado === 'Conciliado Auto' ? 1.0 : mapeo.estado === 'Pendiente Comprobación' ? 0.5 : 0,
      },
    });

    if (mapeo.estado === 'Conciliado Auto') conciliadosAuto++;
    else if (mapeo.estado === 'Pendiente Comprobación') pendientesComprobacion++;
    else requierenAccion++;
  }

  await registrarAuditTrail({
    agente: 'conciliador-inteligente',
    herramienta: 'mapear_movimientos',
    input: { empresaId, totalMovimientos: movimientos.length },
    output: { conciliadosAuto, pendientesComprobacion, requierenAccion, pagosMultiples: pagosMultiplesSet.size },
    scoreConfianza: conciliadosAuto / Math.max(1, movimientos.length),
    verificado: requierenAccion < movimientos.length * 0.3,
    observaciones: `${conciliadosAuto} auto, ${pendientesComprobacion} pendientes, ${requierenAccion} requieren acción, ${pagosMultiplesSet.size} pagos múltiples`,
    empresaId,
  });

  return {
    totalProcesados: movimientos.length,
    conciliadosAuto,
    pendientesComprobacion,
    requierenAccion,
    pagosMultiples: pagosMultiplesSet.size,
    porcentajeConciliacion: Math.round(((conciliadosAuto + pendientesComprobacion) / Math.max(1, movimientos.length)) * 10000) / 100,
  };
}
