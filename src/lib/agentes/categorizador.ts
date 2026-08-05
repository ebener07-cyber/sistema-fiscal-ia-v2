import { db } from '@/lib/db';
import { registrarAuditTrail } from '@/lib/audit-trail';

/**
 * AGENTE CLASIFICADOR — Categoriza movimientos bancarios automáticamente
 *
 * Toma movimientos bancarios sin categoría y les asigna:
 * - categoria: categoría contable (10 categorías estándar)
 * - subcategoria: detalle más específico
 * - scoreConfianza: 0.0 a 1.0
 *
 * Estrategia:
 * 1. PRIMERO intenta clasificación determinista por keywords (rápido, gratis, 100% preciso)
 * 2. Si no hay match, usa LLM (GLM-4.6) con el concepto del movimiento
 * 3. Registra todo en audit trail
 *
 * Categorías estándar (10):
 * 1. Nomina — pagos a empleados, IMSS, ISR retenido
 * 2. Proveedores — pagos a proveedores (RFC conocido)
 * 3. Comisiones — comisiones bancarias, IVA comisiones, membresías
 * 4. Transferencias — transferencias entre cuentas propias
 * 5. Renta — renta de oficina, local, servicios inmobiliarios
 * 6. Servicios — electricidad, agua, teléfono, internet
 * 7. Impuestos — pagos provisionales, anuales, IVA, ISR
 * 8. Inversion — pago de capital, intereses de crédito, seguros
 * 9. Prestamos — préstamos a terceros, devoluciones de préstamo
 * 10. Otros — no clasificado
 */

// ===== REGLAS DETERMINISTAS (primera pasada) =====
// Cada regla tiene: keywords (en MAYÚSCULAS), categoría, subcategoría
const REGLAS_CLASIFICACION: Array<{
  keywords: string[];
  categoria: string;
  subcategoria?: string;
}> = [
  // Nómina
  { keywords: ['NÓMINA', 'NOMINA', 'PAGO NÓMINA', 'PAGO NOMINA', 'PERCEPCIÓN', 'PERCEPCION', 'RECIBO NÓMINA'], categoria: 'Nomina', subcategoria: 'Pago de nómina' },
  { keywords: ['IMSS', 'SEGURRO SOCIAL'], categoria: 'Nomina', subcategoria: 'IMSS' },
  { keywords: ['ISR RETENIDO', 'RETENCIÓN ISR', 'RETENCION ISR'], categoria: 'Nomina', subcategoria: 'ISR retenido' },
  { keywords: ['INFONAVIT'], categoria: 'Nomina', subcategoria: 'INFONAVIT' },
  { keywords: ['PENSION', 'PENSIÓN', 'JUBILACIÓN', 'JUBILACION'], categoria: 'Nomina', subcategoria: 'Pensión' },
  { keywords: ['FINIQUITO', 'AGUINALDO', 'PRIMA VACACIONAL', 'PTU'], categoria: 'Nomina', subcategoria: 'Finiquito/aguinaldo' },

  // Comisiones bancarias
  { keywords: ['COMISION', 'COMISIÓN', 'COM. DISPERSION', 'COM. ADMIN', 'ADMINISTRACION RENTA MEMBRESIA', 'RENTA MEMBRESIA', 'I V A POR COMISION', 'IVA COM', 'IVA 00054'], categoria: 'Comisiones', subcategoria: 'Comisión bancaria' },

  // Transferencias entre cuentas propias
  { keywords: ['TRASPASO', 'TRANSFERENCIA ENTRE CUENTAS', 'TRANSFERENCIA PROPIAS', 'TRASPASO ENTRE CUENTAS'], categoria: 'Transferencias', subcategoria: 'Entre cuentas propias' },

  // Renta
  { keywords: ['RENTA', 'RENTA OFICINA', 'RENTA LOCAL', 'INMOBILIARIA', 'ARRENDAMIENTO'], categoria: 'Renta', subcategoria: 'Renta de inmueble' },

  // Servicios
  { keywords: ['CFE', 'ELECTRICIDAD', 'LUZ', 'ENERGÍA', 'ENERGIA'], categoria: 'Servicios', subcategoria: 'Electricidad' },
  { keywords: ['AGUA', 'SACMEX'], categoria: 'Servicios', subcategoria: 'Agua' },
  { keywords: ['TELÉFONO', 'TELEFONO', 'TELCEL', 'AT&T', 'MOVISTAR', 'IZZI'], categoria: 'Servicios', subcategoria: 'Teléfono' },
  { keywords: ['INTERNET', 'WIFI', 'BANDA ANCHA', 'MODEM'], categoria: 'Servicios', subcategoria: 'Internet' },

  // Impuestos
  { keywords: ['PAGO PROVISIONAL', 'P/P', 'PP ISR', 'PP IVA', 'DECLARACIÓN', 'DECLARACION', 'IMPUESTO FEDERAL', 'IMPTO FED', 'CGO IMPTO FED'], categoria: 'Impuestos', subcategoria: 'Pago provisional' },
  { keywords: ['IVA', 'PAGO IVA'], categoria: 'Impuestos', subcategoria: 'IVA' },
  { keywords: ['ISR ANUAL', 'DECLARACIÓN ANUAL'], categoria: 'Impuestos', subcategoria: 'ISR anual' },

  // Inversión / Crédito
  { keywords: ['CARGO CAPITAL', 'PAGO DE CAPITAL', 'PAGO CAPITAL', 'CAPITAL DE CREDITO', 'CRE_'], categoria: 'Inversion', subcategoria: 'Pago de capital crédito' },
  { keywords: ['CARGO POR INTERESES', 'INTERESES DE CREDITO', 'CGO INTERESES'], categoria: 'Inversion', subcategoria: 'Intereses de crédito' },
  { keywords: ['PRIMA SEGURO', 'SEGURO PYME', 'SEGURO AUTOCOMPARA'], categoria: 'Inversion', subcategoria: 'Seguro' },

  // Préstamos
  { keywords: ['PRESTAMO', 'PRÉSTAMO', 'DEVOLUCION DE PRESTAMO', 'DEVOLUCION PRESTAMO', 'PRESTAMO TEMPORAL'], categoria: 'Prestamos', subcategoria: 'Préstamo' },
  { keywords: ['APORT LINEA CAPTURA', 'LINEA DE CAPTURA'], categoria: 'Impuestos', subcategoria: 'Línea de captura' },
];

interface ResultadoClasificacion {
  categoria: string;
  subcategoria?: string;
  scoreConfianza: number;
  metodo: 'determinista' | 'llm' | 'desconocido';
  razon?: string;
}

/**
 * PASADA 1: Clasificación determinista por keywords
 * Recorre todas las reglas y devuelve la primera coincidencia
 */
function clasificarDeterminista(concepto: string, monto: number): ResultadoClasificacion | null {
  const conceptoUpper = concepto.toUpperCase();

  for (const regla of REGLAS_CLASIFICACION) {
    for (const keyword of regla.keywords) {
      if (conceptoUpper.includes(keyword)) {
        return {
          categoria: regla.categoria,
          subcategoria: regla.subcategoria,
          scoreConfianza: 1.0,
          metodo: 'determinista',
          razon: `Match keyword: "${keyword}"`,
        };
      }
    }
  }

  return null;
}

/**
 * PASADA 2: Clasificación con LLM (solo si la determinista falla)
 * Usa GLM-4.6 con un prompt corto y few-shot examples
 */
async function clasificarConLLM(concepto: string, monto: number): Promise<ResultadoClasificacion> {
  const { getZAI } = await import('@/lib/zai');
  const zai = await getZAI();

  const prompt = `Eres un clasificador contable para un sistema bancario mexicano.
Tu tarea es asignar UNA categoría a un movimiento bancario.

Categorías disponibles (solo estas 10):
1. Nomina — pagos a empleados, IMSS, ISR retenido, INFONAVIT, finiquito, aguinaldo
2. Proveedores — pagos a proveedores con RFC conocido
3. Comisiones — comisiones bancarias, membresías, IVA sobre comisiones
4. Transferencias — transferencias entre cuentas propias
5. Renta — renta de oficina, local, inmobiliario
6. Servicios — electricidad (CFE), agua, teléfono, internet
7. Impuestos — pagos provisionales, declaraciones, IVA, ISR
8. Inversion — pago de capital, intereses de crédito, seguros
9. Prestamos — préstamos a terceros, devoluciones de préstamo
10. Otros — no clasificado

EJEMPLOS:
- "PAGO TRANSFERENCIA SPEI ENVIADO A AZTECA TANIA GUADALUPE" → {"categoria":"Prestamos","subcategoria":"Préstamo a tercero"}
- "ABONO TRANSFERENCIA SPEI RECIBIDO DE BANORTE ELECTRONICMA" → {"categoria":"Transferencias","subcategoria":"Entre cuentas propias"}
- "CARGO CAPITAL DE CREDITO CRE_05012206338" → {"categoria":"Inversion","subcategoria":"Pago de capital"}
- "ADMINISTRACION RENTA MEMBRESIA" → {"categoria":"Comisiones","subcategoria":"Membresía bancaria"}

Responde SOLO con JSON: {"categoria":"...","subcategoria":"...","confianza":0.0-1.0}

Concepto: "${concepto.slice(0, 200)}"
Monto: ${monto.toFixed(2)}`;

  try {
    const respuesta = await zai.chat.completions.create({
      model: 'glm-4.6',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 150,
    });
    const texto = respuesta.choices[0].message.content || '';
    const jsonMatch = texto.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { categoria: 'Otros', scoreConfianza: 0.3, metodo: 'llm', razon: 'No se pudo parsear respuesta LLM' };
    }
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      categoria: parsed.categoria || 'Otros',
      subcategoria: parsed.subcategoria,
      scoreConfianza: typeof parsed.confianza === 'number' ? parsed.confianza : 0.6,
      metodo: 'llm',
      razon: 'Clasificado por GLM-4.6',
    };
  } catch (e: any) {
    console.error('Error en LLM clasificador:', e.message);
    return { categoria: 'Otros', scoreConfianza: 0.2, metodo: 'llm', razon: `Error: ${e.message}` };
  }
}

/**
 * Clasifica un solo movimiento
 */
export async function clasificarMovimiento(concepto: string, monto: number): Promise<ResultadoClasificacion> {
  // PASADA 1: Determinista
  const resultadoDet = clasificarDeterminista(concepto, monto);
  if (resultadoDet) return resultadoDet;

  // PASADA 2: LLM (solo si la determinista falla)
  return await clasificarConLLM(concepto, monto);
}

/**
 * Clasifica múltiples movimientos de una empresa
 * Solo procesa los que no tienen categoría asignada
 */
export async function clasificarMovimientosEmpresa(
  empresaId: string,
  opciones?: { limite?: number; forzarReclasificar?: boolean }
): Promise<{
  totalProcesados: number;
  clasificadosDeterminista: number;
  clasificadosLLM: number;
  errores: number;
  detalles: Array<{ movimientoId: string; concepto: string; categoria: string; subcategoria?: string; scoreConfianza: number; metodo: string }>;
}> {
  const limite = opciones?.limite || 100;

  // Buscar movimientos sin categoría (o forzar reclasificación)
  const where: any = { cuenta: { empresaId } };
  if (!opciones?.forzarReclasificar) {
    where.OR = [
      { categoria: null },
      { categoria: '' },
    ];
  }

  const movimientos = await db.movimientoBanco.findMany({
    where,
    take: limite,
    orderBy: { fecha: 'desc' },
    select: { id: true, concepto: true, monto: true },
  });

  let clasificadosDeterminista = 0;
  let clasificadosLLM = 0;
  let errores = 0;
  const detalles: any[] = [];

  for (const mov of movimientos) {
    try {
      const resultado = await clasificarMovimiento(mov.concepto, mov.monto);

      await db.movimientoBanco.update({
        where: { id: mov.id },
        data: {
          categoria: resultado.categoria,
          subcategoria: resultado.subcategoria || null,
          scoreConfianza: resultado.scoreConfianza,
        },
      });

      detalles.push({
        movimientoId: mov.id,
        concepto: mov.concepto.slice(0, 80),
        categoria: resultado.categoria,
        subcategoria: resultado.subcategoria,
        scoreConfianza: resultado.scoreConfianza,
        metodo: resultado.metodo,
      });

      if (resultado.metodo === 'determinista') clasificadosDeterminista++;
      else if (resultado.metodo === 'llm') clasificadosLLM++;

      // Registrar audit trail
      await registrarAuditTrail({
        agente: 'categorizador',
        herramienta: 'clasificar_movimiento',
        input: { concepto: mov.concepto, monto: mov.monto },
        output: resultado,
        scoreConfianza: resultado.scoreConfianza,
        verificado: resultado.scoreConfianza >= 0.7,
        observaciones: resultado.razon,
        empresaId,
      });
    } catch (e: any) {
      errores++;
      console.error(`Error clasificando movimiento ${mov.id}:`, e.message);
    }
  }

  return {
    totalProcesados: movimientos.length,
    clasificadosDeterminista,
    clasificadosLLM,
    errores,
    detalles,
  };
}

/**
 * Obtiene estadísticas de clasificación para el dashboard
 */
export async function obtenerEstadisticasClasificacion(empresaId: string) {
  const movimientos = await db.movimientoBanco.findMany({
    where: { cuenta: { empresaId } },
    select: { categoria: true, monto: true },
  });

  const total = movimientos.length;
  const clasificados = movimientos.filter(m => m.categoria && m.categoria !== '').length;
  const porCategoria: Record<string, { count: number; total: number }> = {};

  for (const mov of movimientos) {
    const cat = mov.categoria || 'Sin clasificar';
    if (!porCategoria[cat]) porCategoria[cat] = { count: 0, total: 0 };
    porCategoria[cat].count++;
    porCategoria[cat].total += Math.abs(mov.monto);
  }

  return {
    total,
    clasificados,
    sinClasificar: total - clasificados,
    tasaClasificacion: total > 0 ? clasificados / total : 0,
    porCategoria: Object.entries(porCategoria)
      .map(([categoria, stats]) => ({ categoria, ...stats }))
      .sort((a, b) => b.count - a.count),
  };
}
