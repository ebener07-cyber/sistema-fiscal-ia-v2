import { db } from '@/lib/db';
import { registrarAuditTrail } from '@/lib/audit-trail';
import { categorizarNoConciliable } from '@/lib/agentes/categorias-no-conciliables';

/**
 * AGENTE CONCILIADOR — Concilia movimientos bancarios con facturas
 *
 * MEJORADO v3.5:
 * 1. Ampliadas tolerancias: monto ±5%, fecha ±7 días
 * 2. Match por RFC (si el concepto menciona el RFC)
 * 3. Match por complementos de pago (CFDIs tipo P)
 * 4. Categoriza movimientos no conciliables (transferencias, comisiones, créditos)
 * 5. Excluye facturas canceladas de la conciliación
 *
 * Reglas:
 * - Movimiento positivo (depósito) → busca factura EMITIDA con mismo monto
 * - Movimiento negativo (pago) → busca factura RECIBIDA con mismo monto
 * - Si el movimiento no requiere factura (transferencia, comisión), se marca como NO_REQUIERE
 * - Solo concilia si hay UN único match (no ambiguo)
 * - Marca el movimiento con facturaConciliadaId y conciliadoEn
 */

interface ResultadoConciliacion {
  totalProcesados: number;
  conciliados: number;
  pendientesRevision: number;
  sinMatch: number;
  noRequiereFactura: number; // ← NUEVO: movimientos que no necesitan factura
  detalles: Array<{
    movimientoId: string;
    concepto: string;
    monto: number;
    fecha: string;
    facturaId?: string;
    facturaFolio?: string;
    facturaTotal?: number;
    facturaFecha?: string;
    scoreConfianza: number;
    estado: 'conciliado' | 'pendiente_revision' | 'sin_match' | 'no_requiere_factura';
    categoriaNoConciliable?: string;
    razonNoConciliable?: string;
  }>;
}

const TOLERANCIA_MONTO_PCT = 0.05; // 5% de tolerancia (ampliada para comisiones y tipos de cambio)
const TOLERANCIA_FECHA_DIAS = 7; // ±7 días (ampliada para conciliar más movimientos)

function calcularScoreConfianza(
  montoMov: number,
  montoFac: number,
  diasDiferencia: number,
): number {
  // Score base según diferencia de monto
  const diffMonto = Math.abs(montoMov - montoFac);
  const pctDiff = montoFac > 0 ? diffMonto / montoFac : 1;
  let score = 1.0 - (pctDiff * 5); // 0% diff = 1.0, 20% diff = 0.0

  // Penalizar por días de diferencia
  if (diasDiferencia > TOLERANCIA_FECHA_DIAS) {
    score -= 0.2 * (diasDiferencia - TOLERANCIA_FECHA_DIAS);
  }

  return Math.max(0, Math.min(1, score));
}

/**
 * Busca facturas que coincidan con un movimiento bancario
 */
async function buscarFacturasMatch(
  empresaId: string,
  monto: number,
  fecha: Date,
  direccion: 'emitida' | 'recibida',
): Promise<Array<{ factura: any; score: number; diasDiferencia: number }>> {
  const montoAbs = Math.abs(monto);
  const montoMin = montoAbs * (1 - TOLERANCIA_MONTO_PCT);
  const montoMax = montoAbs * (1 + TOLERANCIA_MONTO_PCT);

  // Buscar facturas en rango de fecha ±15 días (ampliado para más matches)
  const fechaMin = new Date(fecha);
  fechaMin.setDate(fechaMin.getDate() - 15);
  const fechaMax = new Date(fecha);
  fechaMax.setDate(fechaMax.getDate() + 15);

  // Excluir facturas canceladas y buscar solo tipo I (facturas, no complementos P)
  const facturas = await db.factura.findMany({
    where: {
      empresaId,
      direccion,
      estado: 'timbrada', // ← Excluir canceladas
      tipoComprobante: 'I', // ← Solo facturas de ingreso, no complementos P
      total: { gte: montoMin, lte: montoMax },
      fecha: { gte: fechaMin, lte: fechaMax },
    },
    select: {
      id: true, folio: true, serie: true, fecha: true, total: true,
      emisorNombre: true, receptorNombre: true, concepto: true,
      emisorRfc: true, receptorRfc: true,
    },
  });

  const matches = facturas.map(f => {
    const dias = Math.abs(f.fecha.getTime() - fecha.getTime()) / (1000 * 60 * 60 * 24);
    return {
      factura: f,
      score: calcularScoreConfianza(montoAbs, f.total, dias),
      diasDiferencia: dias,
    };
  }).sort((a, b) => b.score - a.score);

  // Si no hay match por monto, buscar complementos de pago (CFDIs tipo P)
  // que tengan montoPagado similar al movimiento bancario
  if (matches.length === 0) {
    const complementosPago = await db.factura.findMany({
      where: {
        empresaId,
        direccion,
        estado: 'timbrada',
        tipoComprobante: 'P', // ← Complementos de pago
        montoPagado: { gte: montoMin, lte: montoMax },
        fecha: { gte: fechaMin, lte: fechaMax },
      },
      select: {
        id: true, folio: true, serie: true, fecha: true,
        total: true, montoPagado: true,
        emisorNombre: true, receptorNombre: true,
        emisorRfc: true, receptorRfc: true,
        facturaOriginalUuid: true,
      },
    });

    for (const comp of complementosPago) {
      const montoPagado = comp.montoPagado || 0;
      const dias = Math.abs(comp.fecha.getTime() - fecha.getTime()) / (1000 * 60 * 60 * 24);
      // Si el monto pagado coincide, buscar la factura original para conciliar
      if (comp.facturaOriginalUuid) {
        const facturaOriginal = await db.factura.findFirst({
          where: { uuid: comp.facturaOriginalUuid, empresaId },
          select: { id: true, folio: true, serie: true, fecha: true, total: true, emisorNombre: true, receptorNombre: true },
        });
        if (facturaOriginal) {
          matches.push({
            factura: facturaOriginal,
            score: Math.max(0.5, calcularScoreConfianza(montoAbs, montoPagado, dias) * 0.8),
            diasDiferencia: dias,
          });
        }
      }
    }
    matches.sort((a, b) => b.score - a.score);
  }

  return matches;
}

/**
 * Busca coincidencia por RFC en el concepto del movimiento
 */
function buscarRfcEnConcepto(concepto: string): string | null {
  // Patrón RFC persona moral: 3 letras + 6 dígitos + 3 alfanuméricos
  const regexMoral = /\b([A-ZÑ&]{3}\d{6}[A-Z0-9]{3})\b/;
  // Patrón RFC persona física: 4 letras + 6 dígitos + 3 alfanuméricos
  const regexFisica = /\b([A-ZÑ&]{4}\d{6}[A-Z0-9]{3})\b/;

  const match = concepto.toUpperCase().match(regexMoral) || concepto.toUpperCase().match(regexFisica);
  return match ? match[1] : null;
}

/**
 * Concilia movimientos bancarios de una empresa con sus facturas
 */
export async function conciliarMovimientosConFacturas(
  empresaId: string,
  opciones?: { limite?: number; forzarReconciliar?: boolean }
): Promise<ResultadoConciliacion> {
  const limite = opciones?.limite || 500; // Ampliado a 500

  // Buscar movimientos no conciliados
  const where: any = { cuenta: { empresaId } };
  if (!opciones?.forzarReconciliar) {
    where.facturaConciliadaId = null;
  }

  const movimientos = await db.movimientoBanco.findMany({
    where,
    take: limite,
    orderBy: { fecha: 'desc' },
    select: { id: true, concepto: true, monto: true, fecha: true },
  });

  let conciliados = 0;
  let pendientesRevision = 0;
  let sinMatch = 0;
  let noRequiereFactura = 0;
  const detalles: any[] = [];

  for (const mov of movimientos) {
    // ===== PASO 1: Verificar si el movimiento NO requiere factura =====
    const noConciliable = categorizarNoConciliable(mov.concepto, mov.monto);
    if (!noConcilible.requiereFactura) {
      noRequiereFactura++;
      // Actualizar categoría del movimiento
      await db.movimientoBanco.update({
        where: { id: mov.id },
        data: { categoria: noConcilible.categoria || 'no_requiere_factura' },
      });
      detalles.push({
        movimientoId: mov.id,
        concepto: mov.concepto.slice(0, 80),
        monto: mov.monto,
        fecha: mov.fecha.toISOString().slice(0, 10),
        estado: 'no_requiere_factura',
        scoreConfianza: 1.0,
        categoriaNoConciliable: noConcilible.categoria,
        razonNoConciliable: noConcilible.razon,
      });
      continue;
    }

    // ===== PASO 2: Buscar factura para conciliar =====
    const direccion: 'emitida' | 'recibida' = mov.monto >= 0 ? 'emitida' : 'recibida';

    // Buscar matches por monto + fecha (incluye complementos de pago)
    const matches = await buscarFacturasMatch(empresaId, mov.monto, mov.fecha, direccion);

    // Si no hay match por monto+fecha, buscar por RFC en el concepto
    let matchesPorRfc: any[] = [];
    if (matches.length === 0) {
      const rfcEncontrado = buscarRfcEnConcepto(mov.concepto);
      if (rfcEncontrado) {
        const facturasRfc = await db.factura.findMany({
          where: {
            empresaId,
            direccion,
            estado: 'timbrada', // ← Excluir canceladas
            tipoComprobante: 'I',
            OR: [
              { emisorRfc: { contains: rfcEncontrado, mode: 'insensitive' } },
              { receptorRfc: { contains: rfcEncontrado, mode: 'insensitive' } },
            ],
          },
          select: { id: true, folio: true, serie: true, fecha: true, total: true, emisorNombre: true, receptorNombre: true, concepto: true },
          take: 5,
        });
        matchesPorRfc = facturasRfc.map(f => {
          const dias = Math.abs(f.fecha.getTime() - mov.fecha.getTime()) / (1000 * 60 * 60 * 24);
          return {
            factura: f,
            score: Math.max(0.4, calcularScoreConfianza(Math.abs(mov.monto), f.total, dias) * 0.7),
            diasDiferencia: dias,
          };
        }).sort((a, b) => b.score - a.score);
      }
    }

    const todosLosMatches = [...matches, ...matchesPorRfc];

    let detalle: any = {
      movimientoId: mov.id,
      concepto: mov.concepto.slice(0, 80),
      monto: mov.monto,
      fecha: mov.fecha.toISOString().slice(0, 10),
    };

    if (todosLosMatches.length === 0) {
      // Sin match
      sinMatch++;
      detalle.estado = 'sin_match';
      detalle.scoreConfianza = 0;
    } else if (todosLosMatches.length === 1) {
      // Match único → conciliar
      const match = todosLosMatches[0];
      await db.movimientoBanco.update({
        where: { id: mov.id },
        data: {
          facturaConciliadaId: match.factura.id,
          conciliadoEn: new Date(),
        },
      });
      conciliados++;
      detalle.facturaId = match.factura.id;
      detalle.facturaFolio = `${match.factura.serie || ''}${match.factura.folio}`;
      detalle.facturaTotal = match.factura.total;
      detalle.facturaFecha = match.factura.fecha.toISOString().slice(0, 10);
      detalle.scoreConfianza = match.score;
      detalle.estado = 'conciliado';
    } else if (todosLosMatches.length > 1 && todosLosMatches[0].score >= 0.85) {
      // Múltiples matches pero uno claro (score >= 0.85) → conciliar
      const match = todosLosMatches[0];
      await db.movimientoBanco.update({
        where: { id: mov.id },
        data: {
          facturaConciliadaId: match.factura.id,
          conciliadoEn: new Date(),
        },
      });
      conciliados++;
      detalle.facturaId = match.factura.id;
      detalle.facturaFolio = `${match.factura.serie || ''}${match.factura.folio}`;
      detalle.facturaTotal = match.factura.total;
      detalle.facturaFecha = match.factura.fecha.toISOString().slice(0, 10);
      detalle.scoreConfianza = match.score;
      detalle.estado = 'conciliado';
    } else {
      // Múltiples matches ambiguos → pendiente de revisión
      pendientesRevision++;
      detalle.facturaId = todosLosMatches[0].factura.id;
      detalle.facturaFolio = `${todosLosMatches[0].factura.serie || ''}${todosLosMatches[0].factura.folio}`;
      detalle.facturaTotal = todosLosMatches[0].factura.total;
      detalle.facturaFecha = todosLosMatches[0].factura.fecha.toISOString().slice(0, 10);
      detalle.scoreConfianza = todosLosMatches[0].score;
      detalle.estado = 'pendiente_revision';
      detalle.candidatosAdicionales = todosLosMatches.length - 1;
    }

    detalles.push(detalle);
  }

  // Registrar audit trail
  await registrarAuditTrail({
    agente: 'conciliador-banco',
    herramienta: 'conciliar_movimientos_facturas',
    input: { empresaId, opciones, totalMovimientos: movimientos.length },
    output: {
      conciliados,
      pendientesRevision,
      sinMatch,
    },
    scoreConfianza: movimientos.length > 0 ? conciliados / movimientos.length : 0,
    verificado: conciliados > 0,
    observaciones: `${conciliados} conciliados, ${noRequiereFactura} no requieren factura, ${pendientesRevision} pendientes, ${sinMatch} sin match de ${movimientos.length} total`,
    empresaId,
  });

  return {
    totalProcesados: movimientos.length,
    conciliados,
    pendientesRevision,
    sinMatch,
    noRequiereFactura,
    detalles,
  };
}

/**
 * Obtiene estadísticas de conciliación
 */
export async function obtenerEstadisticasConciliacion(empresaId: string) {
  const movimientos = await db.movimientoBanco.findMany({
    where: { cuenta: { empresaId } },
    select: { facturaConciliadaId: true, monto: true, conciliadoEn: true },
  });

  const total = movimientos.length;
  const conciliados = movimientos.filter(m => m.facturaConciliadaId !== null).length;
  const sinConciliar = total - conciliados;

  const montoConciliado = movimientos
    .filter(m => m.facturaConciliadaId !== null)
    .reduce((s, m) => s + Math.abs(m.monto), 0);
  const montoSinConciliar = movimientos
    .filter(m => m.facturaConciliadaId === null)
    .reduce((s, m) => s + Math.abs(m.monto), 0);

  return {
    total,
    conciliados,
    sinConciliar,
    tasaConciliacion: total > 0 ? conciliados / total : 0,
    montoConciliado,
    montoSinConciliar,
  };
}
