import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/finanzas/analisis?empresaId=xxx&anio=2026
 *
 * Análisis financiero experto basado en:
 *   - Estados de cuenta bancarios (movimientos)
 *   - Facturas emitidas y recibidas
 *   - Nómina
 *   - Proyectos y conciliación
 *
 * Genera un reporte de salud financiera con:
 *   - Liquidez (saldo en bancos)
 *   - Flujo de caja mensual (ingresos vs egresos)
 *   - Razones financieras (corriente, rápida, endeudamiento)
 *   - Calificación crediticia simulada
 *   - Alertas críticas (saldo negativo, pagos pendientes, etc.)
 *   - Sugerencias expertas de mejora
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));
    const empresaId = searchParams.get('empresaId') || undefined;

    if (!empresaId) {
      return NextResponse.json({ error: 'Falta empresaId' }, { status: 400 });
    }

    const inicioAnio = new Date(anio, 0, 1);
    const finAnio = new Date(anio, 11, 31, 23, 59, 59);

    // ===== Obtener todos los datos en paralelo =====
    const [cuentas, movimientos, facturas, nominas, proyectos] = await Promise.all([
      // Cuentas bancarias
      db.cuentaBancaria.findMany({
        where: { empresaId },
        include: { _count: { select: { movimientos: true } } },
      }),

      // Movimientos bancarios del año
      db.movimientoBanco.findMany({
        where: {
          cuenta: { empresaId },
          fecha: { gte: inicioAnio, lte: finAnio },
        },
        include: { cuenta: { select: { banco: true, cuenta: true } } },
        orderBy: { fecha: 'asc' },
      }),

      // Facturas del año
      db.factura.findMany({
        where: {
          empresaId,
          fecha: { gte: inicioAnio, lte: finAnio },
          estado: { not: 'cancelada' },
          tipoComprobante: { in: ['I', 'E'] },
        },
      }),

      // Nómina del año
      db.reciboNomina.findMany({
        where: { empresaId, fecha: { gte: inicioAnio, lte: finAnio } },
      }),

      // Proyectos
      db.proyecto.findMany({
        where: { empresaId },
        include: { _count: { select: { facturas: true } } },
      }),
    ]);

    const empresa = await db.empresa.findUnique({ where: { id: empresaId } });

    // ===== CÁLCULOS FINANCIEROS =====

    // 1. LIQUIDEZ — saldo total en bancos (saldo inicial + movimientos)
    const saldoTotalBancos = cuentas.reduce((s, c) => s + c.saldo, 0);
    const saldoCalculadoAnio = movimientos.reduce((s, m) => s + m.monto, 0);
    const saldoActualEstimado = saldoTotalBancos + saldoCalculadoAnio;

    // 2. FLUJO DE CAJA MENSUAL
    const flujoMensual: Array<{
      mes: number;
      mesNombre: string;
      ingresos: number;
      egresos: number;
      flujoNeto: number;
      saldoAcumulado: number;
    }> = [];
    let saldoAcumulado = 0;

    for (let m = 0; m < 12; m++) {
      const movsMes = movimientos.filter(mov => new Date(mov.fecha).getMonth() === m);
      const ingresos = movsMes.filter(m => m.monto > 0).reduce((s, m) => s + m.monto, 0);
      const egresos = movsMes.filter(m => m.monto < 0).reduce((s, m) => s + Math.abs(m.monto), 0);
      const flujoNeto = ingresos - egresos;
      saldoAcumulado += flujoNeto;
      flujoMensual.push({
        mes: m + 1,
        mesNombre: MESES[m],
        ingresos,
        egresos,
        flujoNeto,
        saldoAcumulado,
      });
    }

    // 3. FACTURACIÓN
    const facturasEmitidas = facturas.filter(f => f.direccion === 'emitida' && f.tipoComprobante === 'I');
    const facturasRecibidas = facturas.filter(f => f.direccion === 'recibida' && f.tipoComprobante === 'I');
    const notasCreditoE = facturas.filter(f => f.direccion === 'emitida' && f.tipoComprobante === 'E');
    const notasCreditoR = facturas.filter(f => f.direccion === 'recibida' && f.tipoComprobante === 'E');

    const totalEmitidoAnio = facturasEmitidas.reduce((s, f) => s + f.total, 0);
    const totalRecibidoAnio = facturasRecibidas.reduce((s, f) => s + f.total, 0);
    const totalNotasCreditoE = notasCreditoE.reduce((s, f) => s + f.total, 0);
    const totalNotasCreditoR = notasCreditoR.reduce((s, f) => s + f.total, 0);

    const ivaTrasladado = facturasEmitidas.reduce((s, f) => s + f.totalImpuestos, 0);
    const ivaAcreditable = facturasRecibidas.reduce((s, f) => s + f.totalImpuestos, 0);
    const ivaPorPagar = ivaTrasladado - ivaAcreditable;

    // 4. NÓMINA
    const totalNominaAnio = nominas.reduce((s, n) => s + n.totalPercepciones, 0);
    const totalNominaNeto = nominas.reduce((s, n) => s + n.neto, 0);
    const totalNominaISR = nominas.reduce((s, n) => s + n.isr, 0);
    const totalNominaIMSS = nominas.reduce((s, n) => s + n.imss, 0);

    // 5. RAZONES FINANCIERAS (estimadas con base en datos disponibles)
    const utilidadBrutaAnual = totalEmitidoAnio - totalRecibidoAnio - totalNotasCreditoE + totalNotasCreditoR;
    const utilidadOperativa = utilidadBrutaAnual - totalNominaAnio;
    const margenUtilidad = totalEmitidoAnio > 0 ? (utilidadOperativa / totalEmitidoAnio) * 100 : 0;

    // Razón corriente = activos circulantes / pasivos circulantes (aproximado)
    const activosCirculantes = saldoActualEstimado + (totalEmitidoAnio * 0.3); // 30% pendiente de cobro
    const pasivosCirculantes = ivaPorPagar + (totalRecibidoAnio * 0.4); // 40% pendiente de pago
    const razonCorriente = pasivosCirculantes > 0 ? activosCirculantes / pasivosCirculantes : 0;
    const razonRapida = pasivosCirculantes > 0 ? saldoActualEstimado / pasivosCirculantes : 0;
    const razonEndeudamiento = activosCirculantes > 0 ? pasivosCirculantes / activosCirculantes : 0;

    // 6. CALIFICACIÓN FINANCIERA (0-100)
    let score = 50; // Base
    if (saldoActualEstimado > 0) score += 10;
    if (saldoActualEstimado > totalNominaAnio / 12 * 3) score += 10; // 3 meses de nómina
    if (razonCorriente > 1.5) score += 10;
    if (razonCorriente > 2.5) score += 5;
    if (margenUtilidad > 15) score += 10;
    if (margenUtilidad > 25) score += 5;
    if (flujoMensual.filter(f => f.flujoNeto < 0).length < 3) score += 10; // Menos de 3 meses negativos
    if (ivaPorPagar > 0 && saldoActualEstimado > ivaPorPagar) score += 5;
    if (saldoActualEstimado < 0) score -= 30;
    if (razonCorriente < 1) score -= 20;
    if (margenUtilidad < 5) score -= 10;
    score = Math.max(0, Math.min(100, score));

    let calificacion = 'D — Crítico';
    if (score >= 90) calificacion = 'A+ — Excelente';
    else if (score >= 80) calificacion = 'A — Muy Bueno';
    else if (score >= 70) calificacion = 'B — Bueno';
    else if (score >= 60) calificacion = 'C — Aceptable';
    else if (score >= 50) calificacion = 'D — Deficiente';

    // 7. ALERTAS CRÍTICAS
    const alertas: Array<{ nivel: 'critico' | 'warning' | 'info'; titulo: string; descripcion: string; recomendacion: string }> = [];

    if (saldoActualEstimado < 0) {
      alertas.push({
        nivel: 'critico',
        titulo: '🚨 Saldo bancario negativo',
        descripcion: `El saldo estimado en bancos es ${formatMoney(saldoActualEstimado)}. La empresa no tiene liquidez.`,
        recomendacion: 'URGENTE: Negociar crédito puente con banco, cobrar facturas pendientes, reestructurar pagos.',
      });
    }

    const mesesNegativos = flujoMensual.filter(f => f.flujoNeto < 0);
    if (mesesNegativos.length > 0) {
      alertas.push({
        nivel: mesesNegativos.length > 3 ? 'critico' : 'warning',
        titulo: `⚠️ ${mesesNegativos.length} mes(es) con flujo negativo`,
        descripcion: `Meses en rojo: ${mesesNegativos.map(m => m.mesNombre).join(', ')}. Total déficit: ${formatMoney(Math.abs(mesesNegativos.reduce((s, m) => s + m.flujoNeto, 0)))}.`,
        recomendacion: 'Identificar gastos no esenciales en esos meses y posponer inversiones. Considerar línea de crédito revolvente.',
      });
    }

    if (razonCorriente < 1) {
      alertas.push({
        nivel: 'critico',
        titulo: '🚨 Razón corriente menor a 1',
        descripcion: `Razón corriente: ${razonCorriente.toFixed(2)}. Los pasivos circulantes superan a los activos circulantes.`,
        recomendacion: 'Renegociar plazos con proveedores, acelerar cobranza, evitar nuevas deudas a corto plazo.',
      });
    } else if (razonCorriente < 1.5) {
      alertas.push({
        nivel: 'warning',
        titulo: '⚠️ Razón corriente baja',
        descripcion: `Razón corriente: ${razonCorriente.toFixed(2)}. Se recomienda mantenerla arriba de 1.5.`,
        recomendacion: 'Mejorar política de cobranza y reducir inventarios ociosos.',
      });
    }

    if (ivaPorPagar > saldoActualEstimado) {
      alertas.push({
        nivel: 'warning',
        titulo: '⚠️ IVA por pagar mayor al saldo bancario',
        descripcion: `IVA por pagar: ${formatMoney(ivaPorPagar)}, Saldo: ${formatMoney(saldoActualEstimado)}. No tienes suficiente para el pago mensual.`,
        recomendacion: 'Reservar el IVA cobrado en cuenta separada. NO usar el IVA para gastos operativos.',
      });
    }

    if (margenUtilidad < 10) {
      alertas.push({
        nivel: 'warning',
        titulo: '⚠️ Margen de utilidad bajo',
        descripcion: `Margen operativa: ${margenUtilidad.toFixed(1)}%. Se recomienda arriba del 15%.`,
        recomendacion: 'Revisar estructura de costos. Subir precios o reducir gastos operativos.',
      });
    }

    const totalNominaMes = totalNominaAnio / 12;
    if (saldoActualEstimado < totalNominaMes * 2) {
      alertas.push({
        nivel: 'critico',
        titulo: '🚨 Reserva para nómina insuficiente',
        descripcion: `Saldo en bancos: ${formatMoney(saldoActualEstimado)}, Nómina mensual: ${formatMoney(totalNominaMes)}. Tienes menos de 2 meses de nómina.`,
        recomendacion: 'Mantener siempre reserva de 3 meses de nómina. Considerar fondo de emergencia.',
      });
    }

    if (alertas.length === 0) {
      alertas.push({
        nivel: 'info',
        titulo: '✅ Salud financiera estable',
        descripcion: 'No se detectaron alertas críticas. La empresa presenta indicadores saludables.',
        recomendacion: 'Continuar con políticas actuales. Invertir excedentes en instrumentos de liquidez.',
      });
    }

    // 8. SUGERENCIAS EXPERTAS
    const sugerencias: Array<{ tipo: 'corto' | 'mediano' | 'largo'; titulo: string; descripcion: string; impactoEstimado: string }> = [];

    if (saldoActualEstimado > totalNominaMes * 6) {
      sugerencias.push({
        tipo: 'corto',
        titulo: '💰 Invertir excedentes',
        descripcion: `Tu saldo (${formatMoney(saldoActualEstimado)}) supera 6 meses de nómina. Considera invertir el excedente.`,
        impactoEstimado: 'Generar 5-8% rendimiento anual adicional',
      });
    }

    sugerencias.push({
      tipo: 'corto',
      titulo: '📊 Separar cuentas por impuestos',
      descripcion: 'Crea cuentas separadas para IVA, ISR y Nómina. Esto evita usar dinero de impuestos para operación.',
      impactoEstimado: 'Evitar problemas de liquidez para declaraciones mensuales',
    });

    if (totalEmitidoAnio > 0) {
      const porcentajeCobranza = (saldoCalculadoAnio > 0 ? (saldoCalculadoAnio / totalEmitidoAnio) * 100 : 0);
      if (porcentajeCobranza < 80) {
        sugerencias.push({
          tipo: 'mediano',
          titulo: '📞 Mejorar política de cobranza',
          descripcion: `Solo el ${porcentajeCobranza.toFixed(0)}% de lo facturado se ha reflejado en bancos. Implementa política de cobro a 30 días.`,
          impactoEstimado: 'Mejorar flujo de caja en 20-30%',
        });
      }
    }

    if (totalRecibidoAnio > totalEmitidoAnio * 0.6) {
      sugerencias.push({
        tipo: 'mediano',
        titulo: '✂️ Optimizar gastos',
        descripcion: `Tus gastos (${formatMoney(totalRecibidoAnio)}) representan más del 60% de tus ingresos. Renegocia con proveedores principales.`,
        impactoEstimado: 'Reducir costos 5-10%',
      });
    }

    if (proyectos.length > 0) {
      sugerencias.push({
        tipo: 'mediano',
        titulo: '📁 Análisis por proyecto',
        descripcion: `Tienes ${proyectos.length} proyecto(s) registrado(s). Identifica cuál es el más rentable y replícalo.`,
        impactoEstimado: 'Aumentar margen 15-25% en proyectos similares',
      });
    }

    if (margenUtilidad > 20 && razonCorriente > 2) {
      sugerencias.push({
        tipo: 'largo',
        titulo: '🚀 Crecimiento acelerado',
        descripcion: 'Tu salud financiera permite tomar riesgos. Considera invertir en expansión o nuevos mercados.',
        impactoEstimado: 'Crecimiento 30-50% en 12 meses',
      });
    }

    sugerencias.push({
      tipo: 'largo',
      titulo: '🏛️ Estrategia fiscal',
      descripcion: 'Revisar con contador: deducciones autorizadas, depreciaciones, PTU, reparto de utilidades, régimen óptimo.',
      impactoEstimado: 'Optimizar carga fiscal 8-15%',
    });

    // 9. RESUMEN EJECUTIVO
    const resumenEjecutivo = `
SALUD FINANCIERA: ${calificacion} (Score: ${score}/100)

LIQUIDEZ:
- Saldo en bancos: ${formatMoney(saldoActualEstimado)}
- Equivale a ${(saldoActualEstimado / totalNominaMes).toFixed(1)} meses de nómina

FACTURACIÓN ${anio}:
- Emitido: ${formatMoney(totalEmitidoAnio)}
- Recibido: ${formatMoney(totalRecibidoAnio)}
- Utilidad bruta: ${formatMoney(utilidadBrutaAnual)}
- Utilidad operativa (después de nómina): ${formatMoney(utilidadOperativa)}
- Margen: ${margenUtilidad.toFixed(1)}%

OBLIGACIONES FISCALES:
- IVA por pagar: ${formatMoney(ivaPorPagar)}
- Nómina total: ${formatMoney(totalNominaAnio)} (Neto: ${formatMoney(totalNominaNeto)})

ALERTAS: ${alertas.filter(a => a.nivel === 'critico').length} críticas, ${alertas.filter(a => a.nivel === 'warning').length} advertencias

${alertas.length > 1 ? 'Requiere atención inmediata.' : 'Estado saludable.'}
    `.trim();

    return NextResponse.json({
      empresa: {
        nombre: empresa?.nombre,
        rfc: empresa?.rfc,
      },
      anio,
      fechaAnalisis: new Date().toISOString(),
      calificacion,
      score,
      resumenEjecutivo,

      // Indicadores principales
      indicadores: {
        saldoBancos: saldoActualEstimado,
        saldoCuentasInicial: saldoTotalBancos,
        mesesReservaNomina: totalNominaMes > 0 ? saldoActualEstimado / totalNominaMes : 0,

        totalEmitido: totalEmitidoAnio,
        totalRecibido: totalRecibidoAnio,
        utilidadBruta: utilidadBrutaAnual,
        utilidadOperativa,
        margenUtilidad,

        ivaPorPagar,
        totalNomina: totalNominaAnio,
        totalNominaNeto,

        razonCorriente,
        razonRapida,
        razonEndeudamiento,
      },

      // Flujo de caja mensual
      flujoMensual,

      // Alertas
      alertas,

      // Sugerencias
      sugerencias,

      // Datos para gráficas
      cuentasBancarias: cuentas.map(c => ({
        banco: c.banco,
        cuenta: c.cuenta,
        saldo: c.saldo,
        movimientos: c._count?.movimientos || 0,
      })),

      proyectos: proyectos.map(p => ({
        nombre: p.nombre,
        estado: p.estado,
        facturas: p._count?.facturas || 0,
      })),
    });
  } catch (e: any) {
    console.error('Error en /api/finanzas/analisis:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0);
}
