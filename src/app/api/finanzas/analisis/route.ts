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
    const prestamosTexto = searchParams.get('prestamos') || '';

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

    // 8.5. ANÁLISIS DE PRÉSTAMOS (si el usuario proporcionó texto)
    let analisisPrestamos: any = null;
    if (prestamosTexto && prestamosTexto.trim().length > 10) {
      // Extraer montos del texto (busca números con $ o sin símbolo)
      const montosEncontrados = prestamosTexto.match(/\$?\s?[\d,]+\.?\d*/g) || [];
      const montos = montosEncontrados
        .map(m => parseFloat(m.replace(/[$,\s]/g, '')))
        .filter(m => m > 1000); // Filtrar montos pequeños

      const totalDeuda = montos.reduce((s, m) => s + m, 0);

      // Detectar palabras clave de tipo de préstamo
      const lowerTexto = prestamosTexto.toLowerCase();
      const tieneFinanciera = lowerTexto.includes('financiera') || lowerTexto.includes('sofom') || lowerTexto.includes('coppel') || lowerTexto.includes('liverpural');
      const tieneBancario = lowerTexto.includes('banco') || lowerTexto.includes('banorte') || lowerTexto.includes('bbva') || lowerTexto.includes('santander');
      const tieneNomina = lowerTexto.includes('nómina') || lowerTexto.includes('nomina');
      const tieneHipoteca = lowerTexto.includes('hipoteca') || lowerTexto.includes('casa') || lowerTexto.includes('departamento');
      const tieneAuto = lowerTexto.includes('auto') || lowerTexto.includes('coche') || lowerTexto.includes('vehículo');
      const tieneTC = lowerTexto.includes('tarjeta') || lowerTexto.includes('crédito') || lowerTexto.includes('credito');

      // Calcular impacto en razones financieras
      const pasivosAdicionales = totalDeuda;
      const nuevosPasivosCirculantes = pasivosCirculantes + pasivosAdicionales;
      const nuevaRazonCorriente = activosCirculantes > 0 ? activosCirculantes / nuevosPasivosCirculantes : 0;
      const nuevoEndeudamiento = activosCirculantes > 0 ? nuevosPasivosCirculantes / activosCirculantes : 0;

      // Recalcular score con deuda
      let scoreConDeuda = score;
      if (totalDeuda > 0) {
        const ratioDeuda = totalDeuda / (totalEmitidoAnio || 1);
        if (ratioDeuda > 0.5) scoreConDeuda -= 15;
        else if (ratioDeuda > 0.3) scoreConDeuda -= 10;
        else if (ratioDeuda > 0.15) scoreConDeuda -= 5;

        if (nuevaRazonCorriente < 1) scoreConDeuda -= 10;
      }
      scoreConDeuda = Math.max(0, Math.min(100, scoreConDeuda));

      // Alertas de préstamos
      if (totalDeuda > 0) {
        alertas.push({
          nivel: totalDeuda > totalEmitidoAnio * 0.4 ? 'critico' : 'warning',
          titulo: `💰 Deuda total: ${formatMoney(totalDeuda)}`,
          descripcion: `Total de préstamos detectados: ${formatMoney(totalDeuda)}. Representa el ${((totalDeuda / (totalEmitidoAnio || 1)) * 100).toFixed(1)}% de tus ingresos anuales. Tipos detectados: ${[tieneFinanciera && 'Financiera', tieneBancario && 'Bancario', tieneNomina && 'Nómina', tieneHipoteca && 'Hipoteca', tieneAuto && 'Automotriz', tieneTC && 'Tarjeta de crédito'].filter(Boolean).join(', ') || 'No especificado'}.`,
          recomendacion: totalDeuda > totalEmitidoAnio * 0.4
            ? 'URGENTE: Tu deuda supera el 40% de ingresos. Considera consolidar deudas y negociar tasas. Estrategia "avalancha": paga primero la deuda con tasa más alta.'
            : 'Mantener pagos al corriente. Si hay excedentes, anticipar pagos a capital para reducir intereses.',
        });

        if (nuevaRazonCorriente < 1 && razonCorriente >= 1) {
          alertas.push({
            nivel: 'critico',
            titulo: '🚨 Con préstamos, razón corriente baja de 1',
            descripcion: `Al incluir deudas (${formatMoney(totalDeuda)}), tu razón corriente baja de ${razonCorriente.toFixed(2)} a ${nuevaRazonCorriente.toFixed(2)}. Los pasivos superan a los activos circulantes.`,
            recomendacion: 'Priorizar pago de deudas a corto plazo. Evitar nuevas deudas hasta recuperar razón > 1.5.',
          });
        }
      }

      // Sugerencias específicas de deudas
      if (totalDeuda > 0) {
        sugerencias.push({
          tipo: 'corto',
          titulo: '🎯 Estrategia avalancha de deudas',
          descripcion: `Con ${formatMoney(totalDeuda)} en deudas, ordena tus préstamos por tasa de interés (más alta primero). Paga el mínimo en todos y destina todo el excedente al de mayor tasa. Una vez liquidado, ese monto se suma al siguiente.`,
          impactoEstimado: `Ahorro estimado: 20-40% en intereses totales`,
        });

        if (tieneTC) {
          sugerencias.push({
            tipo: 'corto',
            titulo: '💳 Consolidar tarjetas de crédito',
            descripcion: 'Las tarjetas de crédito suelen tener tasas de 40-70%. Considera un crédito de nómina o liquidez (15-25%) para pagarlas y reducir intereses.',
            impactoEstimado: 'Reducir carga financiera 30-50%',
          });
        }

        if (tieneHipoteca) {
          sugerencias.push({
            tipo: 'largo',
            titulo: '🏠 Revisar hipoteca',
            descripcion: 'Si tienes hipoteca, evalúa refinanciar si las tasas han bajado. Los pagos hipotecarios no deben exceder 30% de tus ingresos.',
            impactoEstimado: 'Reducir pago mensual 10-20%',
          });
        }
      }

      // Calcular pago mensual estimado de deudas (asumiendo 10% tasa promedio a 36 meses)
      const pagoMensualEstimado = totalDeuda > 0 ? (totalDeuda * 0.032) : 0; // ~3.2% mensual

      analisisPrestamos = {
        textoOriginal: prestamosTexto,
        totalDeuda,
        montosDetectados: montos,
        pagoMensualEstimado,
        tiposDetectados: {
          financiera: tieneFinanciera,
          bancario: tieneBancario,
          nomina: tieneNomina,
          hipoteca: tieneHipoteca,
          automotriz: tieneAuto,
          tarjetaCredito: tieneTC,
        },
        impactoEnRazones: {
          razonCorrienteOriginal: razonCorriente,
          razonCorrienteConDeuda: nuevaRazonCorriente,
          endeudamientoOriginal: razonEndeudamiento,
          endeudamientoConDeuda: nuevoEndeudamiento,
        },
        scoreOriginal: score,
        scoreConDeuda: scoreConDeuda,
        calificacionConDeuda: scoreConDeuda >= 90 ? 'A+' : scoreConDeuda >= 80 ? 'A' : scoreConDeuda >= 70 ? 'B' : scoreConDeuda >= 60 ? 'C' : 'D',
        redaccion: generarRedaccionPrestamos(totalDeuda, montos, tieneFinanciera, tieneBancario, tieneNomina, tieneHipoteca, tieneAuto, tieneTC, totalEmitidoAnio, saldoActualEstimado, pagoMensualEstimado),
      };

      // Actualizar score con deuda
      score = scoreConDeuda;
      calificacion = score >= 90 ? 'A+ — Excelente' : score >= 80 ? 'A — Muy Bueno' : score >= 70 ? 'B — Bueno' : score >= 60 ? 'C — Aceptable' : 'D — Deficiente';
    }

    // 8.7 KPIs PROFESIONALES (estilo business-analyst de wshobson)
    // Cálculos avanzados de unit economics, CLV, cohort, forecasting
    const numClientes = await db.cliente.count({ where: { empresaId } });
    const numEmpleados = await db.empleado.count({ where: { empresaId, status: 'activo' } });
    const ticketPromedio = facturasEmitidas.length > 0 ? totalEmitidoAnio / facturasEmitidas.length : 0;
    const revenuePerEmployee = numEmpleados > 0 ? totalEmitidoAnio / numEmpleados : 0;
    const costoPorEmpleado = numEmpleados > 0 ? (totalRecibidoAnio + totalNominaAnio) / numEmpleados : 0;
    const margenContribucion = totalEmitidoAnio - totalRecibidoAnio;
    const puntoEquilibrio = totalNominaAnio + (totalRecibidoAnio * 0.7); // Costos fijos + variables estimados
    const revenueSobrePuntoEquilibrio = puntoEquilibrio > 0 ? (totalEmitidoAnio / puntoEquilibrio) * 100 : 0;
    const burnRateMensual = totalNominaMes + (totalRecibidoAnio / 12 * 0.5); // Nómina + gastos fijos mensuales
    const runwayMeses = burnRateMensual > 0 ? saldoActualEstimado / burnRateMensual : 0;
    const ltvEstimado = numClientes > 0 ? (totalEmitidoAnio / numClientes) * 2.5 : 0; // Asumiendo retención de 2.5 años
    const cacEstimado = totalRecibidoAnio * 0.05; // 5% de gastos en marketing/ventas (estimado)
    const ratioLtvCac = cacEstimado > 0 ? ltvEstimado / cacEstimado : 0;

    // Forecasting simple (regresión lineal con los meses que tienen datos)
    const mesesConDatos = flujoMensual.filter(f => f.ingresos > 0 || f.egresos > 0);
    let proyeccionFinAnio = 0;
    if (mesesConDatos.length >= 2) {
      const avgMensual = totalEmitidoAnio / mesesConDatos.length;
      const mesesRestantes = 12 - mesesConDatos.length;
      proyeccionFinAnio = totalEmitidoAnio + (avgMensual * mesesRestantes);
    }

    // Cohort analysis simple (facturación promedio por cliente top 5)
    const topClientes = await db.factura.groupBy({
      by: ['receptorRfc'],
      where: {
        empresaId,
        direccion: 'emitida',
        tipoComprobante: 'I',
        fecha: { gte: inicioAnio, lte: finAnio },
      },
      _sum: { total: true },
      _count: true,
      orderBy: { _sum: { total: 'desc' } },
      take: 5,
    });

    const kpis = {
      // Unit Economics
      ticketPromedio,
      revenuePerEmployee,
      costoPorEmpleado,
      margenContribucion,
      margenContribucionPorcentaje: totalEmitidoAnio > 0 ? (margenContribucion / totalEmitidoAnio) * 100 : 0,

      // Punto de equilibrio
      puntoEquilibrio,
      revenueSobrePuntoEquilibrio,
      distanciaEquilibrio: revenueSobrePuntoEquilibrio - 100,

      // Burn rate y runway
      burnRateMensual,
      runwayMeses,

      // CLV / CAC
      ltvEstimado,
      cacEstimado,
      ratioLtvCac,

      // Forecasting
      proyeccionFinAnio,
      crecimientoEstimado: totalEmitidoAnio > 0 ? ((proyeccionFinAnio - totalEmitidoAnio) / totalEmitidoAnio) * 100 : 0,

      // Métricas operativas
      numClientes,
      numEmpleados,
      facturasPorCliente: numClientes > 0 ? facturasEmitidas.length / numClientes : 0,
      revenuePorCliente: numClientes > 0 ? totalEmitidoAnio / numClientes : 0,

      // Top 5 clientes (cohort)
      topClientes: topClientes.map(c => ({
        rfc: c.receptorRfc,
        totalFacturado: c._sum.total || 0,
        numFacturas: c._count,
        ticketPromedio: c._count > 0 ? (c._sum.total || 0) / c._count : 0,
      })),
    };

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

      // KPIs profesionales (business-analyst)
      kpis,

      // Análisis de préstamos (si se proporcionó)
      analisisPrestamos,
    });
  } catch (e: any) {
    console.error('Error en /api/finanzas/analisis:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(n || 0);
}

function generarRedaccionPrestamos(
  totalDeuda: number,
  montos: number[],
  tieneFinanciera: boolean,
  tieneBancario: boolean,
  tieneNomina: boolean,
  tieneHipoteca: boolean,
  tieneAuto: boolean,
  tieneTC: boolean,
  ingresosAnuales: number,
  saldoBancos: number,
  pagoMensualEstimado: number
): string {
  if (totalDeuda === 0) return 'No se detectaron montos de préstamos en el texto proporcionado.';

  const tipos: string[] = [];
  if (tieneFinanciera) tipos.push('préstamo de financiera/SOFOM');
  if (tieneBancario) tipos.push('crédito bancario');
  if (tieneNomina) tipos.push('crédito de nómina');
  if (tieneHipoteca) tipos.push('hipoteca');
  if (tieneAuto) tipos.push('crédito automotriz');
  if (tieneTC) tipos.push('tarjeta(s) de crédito');

  const numDeudas = montos.length;
  const ratioDeudaIngresos = ingresosAnuales > 0 ? (totalDeuda / ingresosAnuales) * 100 : 0;
  const mesesParaLiquidar = pagoMensualEstimado > 0 ? totalDeuda / pagoMensualEstimado : 0;

  let redaccion = `📊 ANÁLISIS DE DEUDAS Y PRÉSTAMOS\n\n`;
  redaccion += `El usuario reporta ${numDeudas} deuda(s) por un total de ${formatMoney(totalDeuda)}.\n`;
  redaccion += `Tipos detectados: ${tipos.join(', ') || 'no especificado'}.\n\n`;

  redaccion += `IMPACTO FINANCIERO:\n`;
  redaccion += `- La deuda representa el ${ratioDeudaIngresos.toFixed(1)}% de los ingresos anuales (${formatMoney(ingresosAnuales)}).\n`;
  redaccion += `- Pago mensual estimado: ${formatMoney(pagoMensualEstimado)} (tasa promedio 10% a 36 meses).\n`;
  redaccion += `- Tiempo estimado para liquidar: ${mesesParaLiquidar.toFixed(0)} meses.\n`;
  redaccion += `- Saldo actual en bancos: ${formatMoney(saldoBancos)}.\n\n`;

  if (ratioDeudaIngresos > 50) {
    redaccion += `⚠️ EVALUACIÓN: NIVEL DE ENDEUDAMIENTO CRÍTICO\n`;
    redaccion += `Las deudas superan el 50% de los ingresos anuales. Se recomienda acción inmediata: consolidar deudas con tasa más alta, negociar quita o reestructura con bancos/financieras, y evitar nuevo endeudamiento. Priorizar la estrategia "avalancha": liquidar primero la deuda con tasa de interés más elevada.\n\n`;
  } else if (ratioDeudaIngresos > 30) {
    redaccion += `⚠️ EVALUACIÓN: NIVEL DE ENDEUDAMIENTO ELEVADO\n`;
    redaccion += `Las deudas representan entre 30% y 50% de los ingresos. Se recomienda acelerar pagos a capital, reducir gastos no esenciales, y destinar al menos 20% del flujo libre al pago anticipado de deudas. Evitar nuevas compras a crédito.\n\n`;
  } else if (ratioDeudaIngresos > 15) {
    redaccion += `✅ EVALUACIÓN: NIVEL DE ENDEUDAMIENTO MANEJABLE\n`;
    redaccion += `Las deudas representan entre 15% y 30% de los ingresos. Mantener pagos al corriente y considerar anticipar pagos a capital cuando haya excedentes para reducir intereses.\n\n`;
  } else {
    redaccion += `✅ EVALUACIÓN: NIVEL DE ENDEUDAMIENTO BAJO\n`;
    redaccion += `Las deudas representan menos del 15% de los ingresos. La carga financiera es manejable. Se puede considerar inversión de excedentes en lugar de anticipar pagos si las tasas de los préstamos son menores al rendimiento esperado de inversiones.\n\n`;
  }

  if (tieneTC) {
    redaccion += `💳 RECOMENDACIÓN ESPECÍFICA — TARJETAS DE CRÉDITO:\n`;
    redaccion += `Las tarjetas de crédito en México tienen tasas promedio de 40-70% anual. Si tienes saldo en tarjetas, prioritiza liquidarlas. Considera un crédito de nómina (15-25%) para consolidar y reducir intereses drásticamente.\n\n`;
  }

  if (tieneFinanciera) {
    redaccion += `🏦 RECOMENDACIÓN ESPECÍFICA — FINANCIERA/SOFOM:\n`;
    redaccion += `Las SOFOM suelen tener tasas de 30-60%. Verifica si puedes refinanciar con un banco tradicional a menor tasa. Si tienes pagos puntuales, negocia tasa preferencial.\n\n`;
  }

  redaccion += `📋 ESTRATEGIA RECOMENDADA:\n`;
  redaccion += `1. Listar todas las deudas con: saldo, tasa, pago mensual, plazo restante.\n`;
  redaccion += `2. Ordenar de mayor a menor tasa de interés.\n`;
  redaccion += `3. Pagar el mínimo en todas menos la de mayor tasa.\n`;
  redaccion += `4. Destinar TODO el excedente disponible a la de mayor tasa.\n`;
  redaccion += `5. Al liquidarla, sumar ese pago a la siguiente deuda.\n`;
  redaccion += `6. Repetir hasta quedar sin deudas (excepto hipoteca si la tasa es < 10%).\n`;

  return redaccion;
}
