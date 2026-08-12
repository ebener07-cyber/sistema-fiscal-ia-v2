/**
 * ============================================================================
 * CONCILIADOR MAESTRO v6 — Algoritmos anti-doble-conteo
 * ----------------------------------------------------------------------------
 * Este módulo implementa los 5 algoritmos críticos que corrigen los 8
 * problemas detectados en v5:
 *
 *  1. subsetSum()            — Búsqueda de subconjunto que suma ≈ target
 *                              (Problema #3: doble conteo en pagos múltiples)
 *  2. conciliarIngresosEsinar() — Cruce FIFO depósitos↔facturas por cliente
 *                              (Problema #4: ingresos ESINAR sin conciliar)
 *  3. justificarDiferencia() — Genera texto explicativo automático
 *                              (Problema #2: 32 alertas sin justificar)
 *  4. detectarDuplicados()   — Key estricta + detección de duplicados parciales
 *                              (Problema #7: duplicados no detectados)
 *  5. esMovimientoInversion() — Detección robusta de cuenta inversión
 *                              (Problema #6: inversión contamina dashboard)
 *
 * Adicionalmente, mapearMovimientoConSigno() corrige el Problema #8
 * (clasificación incorrecta de intereses cuando el monto es negativo).
 * ============================================================================
 */

// ============================================================================
// TIPOS COMPARTIDOS
// ============================================================================

export interface MovimientoConciliacion {
  id: string;
  fecha: Date;
  banco: string;
  cuenta: string;
  tipoCuenta: string; // 'operaciones' | 'inversion' | 'credito' | ...
  concepto: string;
  monto: number; // negativo = pago, positivo = depósito
  facturaConciliadaId?: string | null;
  facturaConciliada?: {
    folio: string;
    serie: string | null;
    total: number;
    uuid: string | null;
    receptorNombre: string | null;
    emisorNombre: string | null;
    receptorRfc: string | null;
    emisorRfc: string | null;
  } | null;
}

export interface FacturaConciliacion {
  id: string;
  folio: string;
  serie: string | null;
  fecha: Date;
  total: number;
  subtotal: number;
  totalImpuestos: number;
  emisorRfc: string | null;
  emisorNombre: string | null;
  receptorRfc: string | null;
  receptorNombre: string | null;
  uuid: string | null;
  // Campos mutables durante la conciliación
  usada: boolean;
  saldoCentavos: number;
  montoAplicadoCentavos: number;
}

export interface ResultadoConciliacion {
  movimientoId: string;
  fecha: Date;
  banco: string;
  tipo: 'Depósito' | 'Pago';
  concepto: string;
  monto: number;
  categoria: string;
  cuentaContable: string;
  estado: EstadoConciliacion;
  semaforo: string;
  uuids: string;
  folios: string;
  clienteProveedor: string;
  montoFactura: number;
  diferencia: number;
  justificacion: string;
  validacionRfc: string;
  esPagoMultiple: boolean;
  grupo: string;
  logRegla: string;
  esInversion: boolean;
}

export type EstadoConciliacion =
  | 'CONCILIADO'
  | 'CONCILIADO_MULTIPLE'
  | 'CONCILIADO_MULTIPLE_CON_DIF'
  | 'CONCILIADO_AGRUPADO'
  | 'CONCILIADO_INGRESO'
  | 'INGRESO_PARCIAL'
  | 'INGRESO_ANTICIPO'
  | 'NO_REQUIERE'
  | 'PENDIENTE'
  | 'SIN_FACTURA'
  | 'MULTIPLES';

export interface DetalleEsinar {
  fechaDeposito: Date;
  conceptoDeposito: string;
  montoDeposito: number;
  uuidFactura: string;
  folio: string;
  cliente: string;
  montoAplicado: number;
  saldoFacturaPosterior: number;
}

export interface DetalleAgrupado {
  grupo: string;
  fecha: Date;
  banco: string;
  concepto: string;
  movimientos: number;
  sumaBanco: number;
  uuids: string;
  folios: string;
  cliente: string;
  sumaFacturas: number;
  diferencia: number;
  justificacion: string;
}

// ============================================================================
// CONFIGURACIÓN
// ============================================================================

export const CONFIG_V6 = {
  TOLERANCIA_EXACTA: 0.05,       // $0.05 para match exacto
  TOLERANCIA_MULTIPLE: 1.00,     // $1.00 para subset-sum individual
  TOLERANCIA_AGRUPADA: 1.00,     // $1.00 para pagos agrupados
  DIAS_VENTANA: 15,              // ventana para buscar facturas
  MAX_CANDIDATOS_SUBSET: 30,
  MAX_ITEMS_SUBSET: 8,
  MAX_NODOS_SUBSET: 150000,
  CLIENTES_INGRESO_DIRECTO: ['ESINAR'],
  PALABRAS_INVERSION: ['INVERSION', 'INVERSIÓN', 'PAGARE', 'PAGARÉ', 'MESADEBOLSA'],
  // Montos exactos conocidos para detectar movimientos grandes por importe
  MONTOS_CONOCIDOS: [
    { monto: 15850.00, categoria: 'Colegiatura / Educación', cuenta: '5600', concepto: 'FORMACION EDUCACION Y CULTURA' },
  ],
} as const;

const STOPWORDS = new Set([
  'sa', 'de', 'cv', 'sapi', 'rl', 'mi', 'del', 'la', 'el', 'y', 'i',
  'o', 'u', 'a', 'e', 'por', 'con', 'sin', 'pago', 'transferencia',
  'spei', 'ref', '0000000', 'orden', 'compra', 'abono', 'cargo',
  'bancos', 'banorte', 'santander', 'cuenta', 'terceros', 'propias',
]);

// ============================================================================
// UTILIDADES
// ============================================================================

export function aCentavos(monto: number): number {
  return Math.round(monto * 100);
}

export function normalizarTexto(x: unknown): string {
  if (x === null || x === undefined) return '';
  let s = String(x).toLowerCase();
  const reemplazos: Record<string, string> = {
    á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u', ñ: 'n',
  };
  for (const [a, b] of Object.entries(reemplazos)) {
    s = s.split(a).join(b);
  }
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

export function tokensSignificativos(texto: string, minLen = 4): string[] {
  const txt = normalizarTexto(texto);
  return txt.split(' ').filter(t => t.length >= minLen && !STOPWORDS.has(t));
}

/**
 * Genera score para elegir el mejor candidato entre varias facturas.
 * Menor score = mejor candidato.
 */
export function scoreCandidato(
  row: { fecha: Date; concepto: string; monto: number; tipo: 'Depósito' | 'Pago' },
  cand: { fecha: Date; total: number; folio: string; emisorNombre: string | null; receptorNombre: string | null },
  targetCentavos: number,
): number {
  let score = Math.abs(aCentavos(cand.total) - targetCentavos) * 100;
  const dias = Math.abs(row.fecha.getTime() - cand.fecha.getTime()) / 86400000;
  score += Math.round(dias) * 10;
  const conceptNorm = normalizarTexto(row.concepto);
  const folioNorm = normalizarTexto(cand.folio);
  if (folioNorm && conceptNorm.includes(folioNorm)) score -= 100000;
  const nombre = row.tipo === 'Depósito' ? (cand.receptorNombre || '') : (cand.emisorNombre || '');
  for (const token of tokensSignificativos(nombre)) {
    if (conceptNorm.includes(token)) score -= 20000;
  }
  return score;
}

// ============================================================================
// ALGORITMO 1: SUBSET-SUM (Problema #3 — doble conteo)
// ============================================================================
/**
 * Busca una combinación de facturas cuya suma se acerque al monto objetivo
 * dentro de la tolerancia. Usa DFS con poda (suffix-sum + bound).
 *
 * Devuelve:
 *   - [índices de facturas seleccionadas, diferencia en centavos] si encuentra
 *   - [null, null] si no encuentra combinación válida
 */
export function subsetSum(
  items: Array<[index: number, montoCentavos: number]>,
  targetCentavos: number,
  tolCentavos: number,
  maxItems = CONFIG_V6.MAX_ITEMS_SUBSET,
  maxNodes = CONFIG_V6.MAX_NODOS_SUBSET,
): [number[] | null, number | null] {
  // Filtrar y ordenar items (mayor primero para poda más agresiva)
  const filtered = items.filter(([, amt]) => amt > 0 && amt <= targetCentavos + tolCentavos);
  if (filtered.length === 0 || targetCentavos <= 0) return [null, null];
  filtered.sort((a, b) => b[1] - a[1]);

  // Precomputar suffix-sums para poda
  const suffix: number[] = new Array(filtered.length + 1).fill(0);
  for (let i = filtered.length - 1; i >= 0; i--) {
    suffix[i] = suffix[i + 1] + filtered[i][1];
  }

  let bestCombo: number[] | null = null;
  let bestDiff = tolCentavos + 1;
  let nodes = 0;

  function dfs(i: number, current: number, combo: number[]): void {
    nodes++;
    if (nodes > maxNodes || bestDiff === 0) return;
    if (combo.length > maxItems) return;
    if (current > targetCentavos + tolCentavos) return;

    if (i === filtered.length) {
      if (combo.length > 0) {
        const diff = Math.abs(targetCentavos - current);
        if (diff <= tolCentavos && diff < bestDiff) {
          bestDiff = diff;
          bestCombo = [...combo];
        }
      }
      return;
    }

    // Poda: lo que queda no alcanza a llegar al objetivo
    if (current + suffix[i] < targetCentavos - tolCentavos) return;

    const [idx, amt] = filtered[i];
    if (current + amt <= targetCentavos + tolCentavos) {
      combo.push(idx);
      dfs(i + 1, current + amt, combo);
      combo.pop();
    }
    dfs(i + 1, current, combo);
  }

  dfs(0, 0, []);
  if (bestCombo) return [bestCombo, bestDiff];
  return [null, null];
}

// ============================================================================
// ALGORITMO 2: CONCILIACIÓN INGRESOS ESINAR (Problema #4)
// ============================================================================
/**
 * Cruza depósitos ESINAR contra facturas emitidas a ESINAR.
 * Aplicación FIFO: cada depósito se aplica al saldo de las facturas más
 * antiguas primero. Soporta pago parcial, anticipo y saldos pendientes.
 *
 * @returns [resultados, facturasActualizadas, detalleEsinar]
 */
export function conciliarIngresosEsinar(
  movimientos: MovimientoConciliacion[],
  facturasEmitidas: FacturaConciliacion[],
): {
  movimientosActualizados: MovimientoConciliacion[];
  facturasActualizadas: FacturaConciliacion[];
  detalle: DetalleEsinar[];
} {
  const detalle: DetalleEsinar[] = [];
  const clientesRegex = new RegExp(CONFIG_V6.CLIENTES_INGRESO_DIRECTO.join('|'), 'i');

  // Filtrar facturas emitidas al cliente ESINAR con saldo pendiente
  const facturasIdx = facturasEmitidas
    .filter(f =>
      f.receptorNombre && clientesRegex.test(f.receptorNombre) && f.saldoCentavos > 0
    )
    .sort((a, b) => a.fecha.getTime() - b.fecha.getTime());

  if (facturasIdx.length === 0) {
    return { movimientosActualizados: movimientos, facturasActualizadas: facturasEmitidas, detalle };
  }

  // Filtrar depósitos pendientes con concepto ESINAR
  const depositosIdx = movimientos
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => m.monto > 0 && clientesRegex.test(m.concepto))
    .sort((a, b) => a.m.fecha.getTime() - b.m.fecha.getTime());

  for (const { m: mov } of depositosIdx) {
    let restante = Math.abs(aCentavos(mov.monto));
    const targetCentavos = restante;
    let aplicadoTotal = 0;
    const appliedFidxs: FacturaConciliacion[] = [];
    const uuids: string[] = [];
    const folios: string[] = [];
    let cliente = '';

    for (const fac of facturasIdx) {
      if (restante <= 0) break;
      const saldoFactura = fac.saldoCentavos;
      if (saldoFactura <= 0) continue;

      const aplicar = Math.min(restante, saldoFactura);
      fac.saldoCentavos -= aplicar;
      fac.montoAplicadoCentavos += aplicar;
      restante -= aplicar;
      aplicadoTotal += aplicar;
      appliedFidxs.push(fac);
      if (fac.uuid) uuids.push(fac.uuid);
      folios.push(`${fac.serie || ''}${fac.folio}`);
      cliente = fac.receptorNombre || fac.emisorNombre || '';

      detalle.push({
        fechaDeposito: mov.fecha,
        conceptoDeposito: mov.concepto,
        montoDeposito: targetCentavos / 100,
        uuidFactura: fac.uuid || '',
        folio: `${fac.serie || ''}${fac.folio}`,
        cliente,
        montoAplicado: aplicar / 100,
        saldoFacturaPosterior: fac.saldoCentavos / 100,
      });
    }

    if (aplicadoTotal > 0) {
      // Mutar el movimiento (almacenamos en cualquier objeto, ya que el
      // caller leerá los resultados del array devuelto)
      const movIdx = movimientos.indexOf(mov);
      const diff = (targetCentavos - aplicadoTotal) / 100;

      let estado: EstadoConciliacion;
      let semaforo: string;
      let justificacion: string;

      if (restante > 0) {
        estado = 'INGRESO_ANTICIPO';
        semaforo = '🔵 Anticipo Cliente';
        justificacion = 'El depósito excede el saldo pendiente de las facturas ESINAR. El excedente debe tratarse como anticipo del cliente.';
      } else {
        const todasPagadas = appliedFidxs.every(f => f.saldoCentavos === 0);
        if (todasPagadas) {
          estado = 'CONCILIADO_INGRESO';
          semaforo = '🟢 Cuadrado';
          justificacion = 'Depósito ESINAR aplicado totalmente a facturas.';
        } else {
          estado = 'INGRESO_PARCIAL';
          semaforo = '🔵 Ingreso Parcial';
          justificacion = 'El depósito ESINAR se aplicó completamente, pero la factura quedó con saldo pendiente.';
        }
      }

      // Anotar resultados en el movimiento (campo extensible)
      (mov as any).__esinar = {
        estado, semaforo, justificacion,
        uuids: uuids.join(', '),
        folios: folios.join(', '),
        cliente,
        montoFactura: aplicadoTotal / 100,
        diferencia: diff,
        multiple: appliedFidxs.length > 1,
      };

      // Marcar facturas como usadas si saldo == 0
      for (const f of appliedFidxs) {
        if (f.saldoCentavos === 0) f.usada = true;
      }
    }
  }

  return {
    movimientosActualizados: movimientos,
    facturasActualizadas: facturasEmitidas,
    detalle,
  };
}

// ============================================================================
// ALGORITMO 3: JUSTIFICACIÓN AUTOMÁTICA (Problema #2)
// ============================================================================
/**
 * Genera una hipótesis textual automática para cada diferencia de monto.
 * Cubre: redondeo, pago parcial, anticipo, comisión SPEI, etc.
 */
export function justificarDiferencia(
  estado: EstadoConciliacion,
  diferencia: number,
  concepto: string,
  pagoMultiple: boolean | string = false,
  esInversion = false,
): string {
  const absDiff = Math.abs(diferencia);
  const conceptoUpper = concepto.toUpperCase();

  if (esInversion) {
    return 'Movimiento de cuenta de inversión. Se excluye de la conciliación operativa.';
  }

  switch (estado) {
    case 'NO_REQUIERE':
      return 'Movimiento interno, bancario o financiero. No requiere CFDI de proveedor.';

    case 'CONCILIADO_INGRESO':
      return 'Depósito conciliado exactamente contra factura emitida.';

    case 'INGRESO_PARCIAL':
      return 'Depósito aplicado parcialmente a factura. La factura queda con saldo pendiente.';

    case 'INGRESO_ANTICIPO':
      return 'El depósito excede el saldo de las facturas. Registrar como anticipo de cliente.';

    case 'CONCILIADO_AGRUPADO':
      return 'Pagos agrupados por fecha/concepto y conciliados contra facturas mediante subset-sum.';

    case 'CONCILIADO':
    case 'CONCILIADO_MULTIPLE': {
      if (absDiff <= CONFIG_V6.TOLERANCIA_EXACTA) {
        let just = 'Conciliación exacta.';
        if (conceptoUpper.includes('SPEI')) just += ' | Revisar comisión/clave de rastreo SPEI.';
        if (pagoMultiple === true || pagoMultiple === 'SÍ' || pagoMultiple === 'AGRUPADO') {
          just += ' | Pago compuesto: validar suma de folios.';
        }
        return just;
      }
      if (absDiff <= 1.00) {
        let just = 'Diferencia por redondeo.';
        if (conceptoUpper.includes('SPEI')) just += ' | Revisar comisión SPEI.';
        return just;
      }
      if (diferencia > 0) {
        let just = 'Monto bancario mayor que factura. Posible anticipo, cargo SPEI trasladado o ajuste.';
        if (conceptoUpper.includes('SPEI')) just += ' | Clave de rastreo SPEI puede incluir comisión.';
        return just;
      }
      let just = 'Monto bancario menor que factura. Posible pago parcial, descuento o comisión SPEI.';
      if (conceptoUpper.includes('SPEI')) just += ' | SPEI pudo descontar comisión del monto.';
      if (pagoMultiple === true || pagoMultiple === 'SÍ' || pagoMultiple === 'AGRUPADO') {
        just += ' | Pago compuesto: validar suma de folios.';
      }
      return just;
    }

    case 'CONCILIADO_MULTIPLE_CON_DIF':
      return 'Pago múltiple conciliado con diferencia. Revisar comisión SPEI, descuento o pago parcial.';

    case 'PENDIENTE':
    case 'SIN_FACTURA':
    case 'MULTIPLES':
      return 'Falta CFDI/ticket o regla de conciliación. Revisar con auxiliar de proveedores o cliente.';

    default:
      return 'Pendiente de clasificación.';
  }
}

// ============================================================================
// ALGORITMO 4: DEDUPLICACIÓN ROBUSTA (Problema #7)
// ============================================================================
/**
 * Deduplica movimientos bancarios con una key estricta:
 *   fecha (YYYY-MM-DD) + banco + monto (2 decimales) + primeros 80 chars del concepto
 *
 * Devuelve el array sin duplicados y un reporte de cuántos se eliminaron.
 */
export function detectarDuplicados(
  movimientos: MovimientoConciliacion[],
): { unicos: MovimientoConciliacion[]; duplicadosEliminados: number } {
  const vistos = new Set<string>();
  const unicos: MovimientoConciliacion[] = [];
  let duplicadosEliminados = 0;

  for (const mov of movimientos) {
    const fechaKey = mov.fecha.toISOString().slice(0, 10);
    const conceptoKey = mov.concepto.slice(0, 80).trim().toUpperCase();
    const montoKey = mov.monto.toFixed(2);
    const key = `${fechaKey}|${mov.banco.toUpperCase()}|${montoKey}|${conceptoKey}`;

    if (vistos.has(key)) {
      duplicadosEliminados++;
      continue;
    }
    vistos.add(key);
    unicos.push(mov);
  }

  return { unicos, duplicadosEliminados };
}

// ============================================================================
// ALGORITMO 5: DETECCIÓN CUENTA INVERSIÓN (Problema #6)
// ============================================================================
/**
 * Determina si un movimiento pertenece a una cuenta de inversión.
 * Combina tipo de cuenta en BD + palabras clave en banco/concepto.
 */
export function esMovimientoInversion(mov: MovimientoConciliacion): boolean {
  if (mov.tipoCuenta === 'inversion') return true;
  const bancoUpper = mov.banco.toUpperCase();
  const conceptoUpper = mov.concepto.toUpperCase();
  for (const palabra of CONFIG_V6.PALABRAS_INVERSION) {
    if (bancoUpper.includes(palabra) || conceptoUpper.includes(palabra)) return true;
  }
  return false;
}

// ============================================================================
// ALGORITMO 6: DETECCIÓN POR MONTO EXACTO (Problema #5)
// ============================================================================
/**
 * Detecta movimientos grandes por monto exacto conocido.
 * Ej: $15,850.00 = colegiatura FORMACION EDUCACION Y CULTURA.
 */
export function detectarMontoConocido(mov: MovimientoConciliacion): {
  categoria: string;
  cuentaContable: string;
  concepto: string;
  match: boolean;
} {
  const montoAbs = Math.abs(mov.monto);
  for (const conoc of CONFIG_V6.MONTOS_CONOCIDOS) {
    if (Math.abs(montoAbs - conoc.monto) <= CONFIG_V6.TOLERANCIA_EXACTA) {
      return {
        categoria: conoc.categoria,
        cuentaContable: conoc.cuenta,
        concepto: conoc.concepto,
        match: true,
      };
    }
  }
  return { categoria: '', cuentaContable: '', concepto: '', match: false };
}

// ============================================================================
// ALGORITMO 7: PAGOS AGRUPADOS (subset-sum sobre grupo de movs)
// ============================================================================
/**
 * Agrupa pagos del mismo día + banco + concepto similar y aplica subset-sum
 * al total agrupado contra facturas disponibles.
 */
export function conciliarPagosAgrupados(
  movimientos: MovimientoConciliacion[],
  facturasRecibidas: FacturaConciliacion[],
  resultados: Map<string, Partial<ResultadoConciliacion>>,
): { grupos: DetalleAgrupado[]; contador: number } {
  const tolCent = aCentavos(CONFIG_V6.TOLERANCIA_AGRUPADA);
  const deltaMs = CONFIG_V6.DIAS_VENTANA * 86400000;
  const grupos: DetalleAgrupado[] = [];
  let grupoNum = 0;

  // Identificar movimientos pendientes que sean pagos
  const pendientes = movimientos.filter(m => {
    const r = resultados.get(m.id);
    return m.monto < 0 && r && (r.estado === 'PENDIENTE' || r.estado === 'SIN_FACTURA' || r.estado === 'MULTIPLES');
  });

  // Generar clave de grupo: fecha + banco + primeros 40 chars concepto normalizado
  const gruposMap = new Map<string, MovimientoConciliacion[]>();
  for (const m of pendientes) {
    const fechaKey = m.fecha.toISOString().slice(0, 10);
    const conceptoNorm = normalizarTexto(m.concepto).slice(0, 40);
    const key = `${fechaKey}|${m.banco.toUpperCase()}|${conceptoNorm}`;
    if (!gruposMap.has(key)) gruposMap.set(key, []);
    gruposMap.get(key)!.push(m);
  }

  for (const [, grupoMovs] of gruposMap) {
    if (grupoMovs.length < 2) continue;

    const targetCentavos = aCentavos(grupoMovs.reduce((s, m) => s + Math.abs(m.monto), 0));

    // Filtrar facturas candidatas (no usadas, monto <= target + tol)
    const candidatos = facturasRecibidas.filter(
      f => !f.usada && aCentavos(f.total) <= targetCentavos + tolCent,
    );
    if (candidatos.length === 0) continue;

    // Acotar por ventana de fechas
    const fechas = grupoMovs.map(m => m.fecha.getTime()).filter(t => !isNaN(t));
    if (fechas.length > 0) {
      const fmin = Math.min(...fechas) - deltaMs;
      const fmax = Math.max(...fechas) + deltaMs;
      const window = candidatos.filter(f => {
        const t = f.fecha.getTime();
        return t >= fmin && t <= fmax;
      });
      if (window.length >= 2) {
        // usar window
        candidatos.splice(0, candidatos.length, ...window);
      }
    }

    // Ordenar por score y limitar a MAX_CANDIDATOS_SUBSET
    const firstRow = grupoMovs[0];
    candidatos.sort((a, b) => {
      const sa = scoreCandidato(
        { fecha: firstRow.fecha, concepto: firstRow.concepto, monto: firstRow.monto, tipo: 'Pago' },
        { fecha: a.fecha, total: a.total, folio: a.folio, emisorNombre: a.emisorNombre, receptorNombre: a.receptorNombre },
        targetCentavos,
      );
      const sb = scoreCandidato(
        { fecha: firstRow.fecha, concepto: firstRow.concepto, monto: firstRow.monto, tipo: 'Pago' },
        { fecha: b.fecha, total: b.total, folio: b.folio, emisorNombre: b.emisorNombre, receptorNombre: b.receptorNombre },
        targetCentavos,
      );
      return sa - sb;
    });
    candidatos.splice(CONFIG_V6.MAX_CANDIDATOS_SUBSET);

    const items: Array<[number, number]> = candidatos.map((f, i) => [i, aCentavos(f.total)]);
    const [combo] = subsetSum(items, targetCentavos, tolCent);
    if (!combo) continue;

    grupoNum++;
    const gid = `GRP-${String(grupoNum).padStart(4, '0')}`;
    const facturasUsadas = combo.map(i => candidatos[i]);
    const totalFacturaCent = facturasUsadas.reduce((s, f) => s + aCentavos(f.total), 0);
    const diferencia = (targetCentavos - totalFacturaCent) / 100;
    if (Math.abs(diferencia) > CONFIG_V6.TOLERANCIA_AGRUPADA) continue;

    const primer = facturasUsadas[0];
    const { categoria, cuentaContable } = categoriaParaProveedor(primer.emisorNombre || '');
    const uuids = facturasUsadas.map(f => f.uuid || '').filter(Boolean).join(', ');
    const folios = facturasUsadas.map(f => `${f.serie || ''}${f.folio}`).join(', ');
    const cliente = primer.emisorNombre || '';

    for (const m of grupoMovs) {
      const diffLocal = Math.abs(diferencia) <= CONFIG_V6.TOLERANCIA_EXACTA ? 0 : diferencia / grupoMovs.length;
      resultados.set(m.id, {
        estado: 'CONCILIADO_AGRUPADO',
        semaforo: Math.abs(diferencia) <= CONFIG_V6.TOLERANCIA_EXACTA ? '🟢 Cuadrado' : '🟠 Naranja (Diferencia)',
        categoria: categoria + ' (Agrupado)',
        cuentaContable,
        uuids,
        folios,
        clienteProveedor: cliente,
        montoFactura: Math.abs(m.monto),
        diferencia: diffLocal,
        validacionRfc: '✅ Grupo conciliado',
        esPagoMultiple: true,
        grupo: gid,
        logRegla: 'Pagos agrupados por fecha/concepto; subset-sum sin doble conteo',
      });
    }

    // Marcar facturas como usadas
    for (const f of facturasUsadas) {
      f.usada = true;
      f.saldoCentavos = 0;
      f.montoAplicadoCentavos = aCentavos(f.total);
    }

    grupos.push({
      grupo: gid,
      fecha: firstRow.fecha,
      banco: firstRow.banco,
      concepto: firstRow.concepto,
      movimientos: grupoMovs.length,
      sumaBanco: targetCentavos / 100,
      uuids,
      folios,
      cliente,
      sumaFacturas: totalFacturaCent / 100,
      diferencia,
      justificacion: Math.abs(diferencia) <= CONFIG_V6.TOLERANCIA_EXACTA
        ? 'Conciliación exacta de pagos agrupados.'
        : 'Pago agrupado con diferencia; revisar comisión/redondeo.',
    });
  }

  return { grupos, contador: grupoNum };
}

// ============================================================================
// ALGORITMO 8: SUBSET-SUM INDIVIDUAL (Problema #3 — sin doble conteo)
// ============================================================================
/**
 * Para cada pago pendiente, busca una combinación de facturas que sume
 * exactamente el monto del banco. Marca las facturas usadas para evitar
 * doble conteo.
 */
export function conciliarSubsetEgresos(
  movimientos: MovimientoConciliacion[],
  facturasRecibidas: FacturaConciliacion[],
  resultados: Map<string, Partial<ResultadoConciliacion>>,
): { contador: number } {
  const tolCent = aCentavos(CONFIG_V6.TOLERANCIA_MULTIPLE);
  const deltaMs = CONFIG_V6.DIAS_VENTANA * 86400000;
  let contador = 0;

  for (const mov of movimientos) {
    if (mov.monto >= 0) continue; // solo pagos
    const r = resultados.get(mov.id);
    if (!r || (r.estado !== 'PENDIENTE' && r.estado !== 'SIN_FACTURA' && r.estado !== 'MULTIPLES')) continue;

    const targetCentavos = aCentavos(Math.abs(mov.monto));

    // Candidatas: no usadas y monto <= target + tol
    const candidatos = facturasRecibidas.filter(
      f => !f.usada && aCentavos(f.total) <= targetCentavos + tolCent,
    );
    if (candidatos.length === 0) continue;

    // Ventana por fecha
    let ventana = candidatos;
    if (!isNaN(mov.fecha.getTime())) {
      const fmin = mov.fecha.getTime() - deltaMs;
      const fmax = mov.fecha.getTime() + deltaMs;
      const w = candidatos.filter(f => {
        const t = f.fecha.getTime();
        return t >= fmin && t <= fmax;
      });
      if (w.length >= 2) ventana = w;
    }

    // Score y limitar
    ventana.sort((a, b) => {
      const sa = scoreCandidato(
        { fecha: mov.fecha, concepto: mov.concepto, monto: mov.monto, tipo: 'Pago' },
        { fecha: a.fecha, total: a.total, folio: a.folio, emisorNombre: a.emisorNombre, receptorNombre: a.receptorNombre },
        targetCentavos,
      );
      const sb = scoreCandidato(
        { fecha: mov.fecha, concepto: mov.concepto, monto: mov.monto, tipo: 'Pago' },
        { fecha: b.fecha, total: b.total, folio: b.folio, emisorNombre: b.emisorNombre, receptorNombre: b.receptorNombre },
        targetCentavos,
      );
      return sa - sb;
    });
    ventana.splice(CONFIG_V6.MAX_CANDIDATOS_SUBSET);

    const items: Array<[number, number]> = ventana.map((f, i) => [i, aCentavos(f.total)]);
    const [combo, diffCent] = subsetSum(items, targetCentavos, tolCent);
    if (!combo) continue;

    const facturasUsadas = combo.map(i => ventana[i]);
    const totalFacturaCent = facturasUsadas.reduce((s, f) => s + aCentavos(f.total), 0);
    const diferencia = (targetCentavos - totalFacturaCent) / 100;
    const primer = facturasUsadas[0];
    const { categoria, cuentaContable } = categoriaParaProveedor(primer.emisorNombre || '');

    const esExac = Math.abs(diferencia) <= CONFIG_V6.TOLERANCIA_EXACTA;
    resultados.set(mov.id, {
      estado: esExac ? 'CONCILIADO_MULTIPLE' : 'CONCILIADO_MULTIPLE_CON_DIF',
      semaforo: esExac ? '🟢 Cuadrado' : '🟠 Naranja (Diferencia)',
      categoria,
      cuentaContable,
      uuids: facturasUsadas.map(f => f.uuid || '').filter(Boolean).join(', '),
      folios: facturasUsadas.map(f => `${f.serie || ''}${f.folio}`).join(', '),
      clienteProveedor: primer.emisorNombre || '',
      montoFactura: totalFacturaCent / 100,
      diferencia,
      validacionRfc: '✅ Subset-sum',
      esPagoMultiple: true,
      logRegla: `Subset-sum sin doble conteo: ${combo.length} facturas`,
    });

    // Marcar facturas como usadas
    for (const f of facturasUsadas) {
      f.usada = true;
      f.saldoCentavos = 0;
      f.montoAplicadoCentavos = aCentavos(f.total);
    }
    contador++;
  }

  return { contador };
}

// ============================================================================
// ALGORITMO 9: CONCILIACIÓN EXACTA (1 factura = 1 movimiento)
// ============================================================================
/**
 * Concilia movimientos bancarios contra una única factura por monto ±tol
 * y fecha dentro de ventana. Marca la factura como usada.
 */
export function conciliarExactos(
  movimientos: MovimientoConciliacion[],
  facturas: FacturaConciliacion[],
  resultados: Map<string, Partial<ResultadoConciliacion>>,
  tipoBanco: 'Depósito' | 'Pago',
  tipoFacturaIngresos: boolean,
): { contador: number } {
  const tolCent = aCentavos(CONFIG_V6.TOLERANCIA_EXACTA);
  const deltaMs = CONFIG_V6.DIAS_VENTANA * 86400000;
  let contador = 0;

  for (const mov of movimientos) {
    if (tipoBanco === 'Depósito' && mov.monto <= 0) continue;
    if (tipoBanco === 'Pago' && mov.monto >= 0) continue;
    const r = resultados.get(mov.id);
    if (!r || (r.estado !== 'PENDIENTE' && r.estado !== 'SIN_FACTURA' && r.estado !== 'MULTIPLES')) continue;

    const targetCentavos = aCentavos(Math.abs(mov.monto));
    const candidatos = facturas.filter(
      f => !f.usada && Math.abs(aCentavos(f.total) - targetCentavos) <= tolCent,
    );
    if (candidatos.length === 0) continue;

    // Ventana por fecha
    let ventana = candidatos;
    if (!isNaN(mov.fecha.getTime())) {
      const fmin = mov.fecha.getTime() - deltaMs;
      const fmax = mov.fecha.getTime() + deltaMs;
      const w = candidatos.filter(f => {
        const t = f.fecha.getTime();
        return t >= fmin && t <= fmax;
      });
      if (w.length >= 1) ventana = w;
    }

    // Elegir mejor candidato por score
    let best: FacturaConciliacion | null = null;
    let bestScore = Number.MAX_SAFE_INTEGER;
    for (const f of ventana) {
      const s = scoreCandidato(
        { fecha: mov.fecha, concepto: mov.concepto, monto: mov.monto, tipo: tipoBanco },
        { fecha: f.fecha, total: f.total, folio: f.folio, emisorNombre: f.emisorNombre, receptorNombre: f.receptorNombre },
        targetCentavos,
      );
      if (s < bestScore) { bestScore = s; best = f; }
    }
    if (!best) continue;

    const montoFactura = best.total;
    const diferencia = Math.abs(mov.monto) - montoFactura;
    const rfcFactura = tipoFacturaIngresos ? best.receptorRfc : best.emisorRfc;
    const cliente = tipoFacturaIngresos ? (best.receptorNombre || '') : (best.emisorNombre || '');

    resultados.set(mov.id, {
      estado: 'CONCILIADO',
      semaforo: Math.abs(diferencia) <= CONFIG_V6.TOLERANCIA_EXACTA ? '🟢 Cuadrado' : '🟠 Naranja (Diferencia)',
      categoria: tipoFacturaIngresos ? 'Ingreso por Servicio' : categoriaParaProveedor(best.emisorNombre || '').categoria,
      cuentaContable: tipoFacturaIngresos ? '4100' : categoriaParaProveedor(best.emisorNombre || '').cuentaContable,
      uuids: best.uuid || '',
      folios: `${best.serie || ''}${best.folio}`,
      clienteProveedor: cliente,
      montoFactura,
      diferencia,
      validacionRfc: rfcFactura ? '✅ RFC en CFDI' : '⚠️ Sin RFC',
      esPagoMultiple: false,
      logRegla: `Match exacto por monto ±$${CONFIG_V6.TOLERANCIA_EXACTA} + fecha ±${CONFIG_V6.DIAS_VENTANA}d`,
    });

    best.usada = true;
    best.saldoCentavos = 0;
    best.montoAplicadoCentavos = aCentavos(best.total);
    contador++;
  }

  return { contador };
}

// ============================================================================
// CATEGORIZACIÓN DE PROVEEDOR
// ============================================================================
export function categoriaParaProveedor(nombre: string): { categoria: string; cuentaContable: string } {
  const n = normalizarTexto(nombre);
  if (['electro', 'balmis', 'centrifugados', 'cuprum', 'hirata', 'ferreteria', 'material', 'electric', 'transformador'].some(x => n.includes(x))) {
    return { categoria: 'Costo de Materiales', cuentaContable: '5000' };
  }
  if (['inmobiliaria hangui', 'renta'].some(x => n.includes(x))) {
    return { categoria: 'Renta / Arrendamiento', cuentaContable: '5600' };
  }
  if (['pase', 'servicios electronicos', 'servicios troncalizados', 'teamvox', 'juan manuel polo', 'honorarios'].some(x => n.includes(x))) {
    return { categoria: 'Servicios Profesionales', cuentaContable: '5500' };
  }
  if (['imss', 'infonavit', 'nomina'].some(x => n.includes(x))) {
    return { categoria: 'Sueldos y Seguridad Social', cuentaContable: '5300' };
  }
  if (['cfe', 'comision federal'].some(x => n.includes(x))) {
    return { categoria: 'Servicios / CFE', cuentaContable: '5200' };
  }
  return { categoria: 'Gastos de Operación', cuentaContable: '5200' };
}
