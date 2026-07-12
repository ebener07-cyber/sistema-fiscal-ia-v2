import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/imss?mes=7&anio=2026
 * Calcula cuotas IMSS obrero-patronales del mes.
 *
 * POST /api/imss
 * Body: { salarioMensual, diasTrabajados }
 * Calcula cuotas para un empleado individual.
 */

export const runtime = 'nodejs';

// UMA (Unidad de Medida y Actualización) 2026 - valor diario
const UMA_DIARIA_2026 = 108.57;
const UMA_MENSUAL_2026 = 3297.48;

interface CuotaIMSS {
  concepto: string;
  base: number;
  tasaPatronal: number;
  tasaObrero: number;
  cuotaPatronal: number;
  cuotaObrero: number;
  total: number;
}

function calcularCuotasIMSS(salarioDiario: number, diasTrabajados: number = 30) {
  // Salario base de cotización (SBC) = salario diario (sin integrar)
  // Para fines prácticos asumimos SBC = salarioDiario
  const SBC = salarioDiario;
  const topeSBC = 25 * UMA_DIARIA_2026; // Tope máx 25 UMA

  const sbcAjustado = Math.min(SBC, topeSBC);
  const baseMensual = sbcAjustado * diasTrabajados;
  const baseMensualUMA = UMA_DIARIA_2026 * diasTrabajados;

  const cuotas: CuotaIMSS[] = [];

  // ===== ENFERMEDADES Y MATERNIDAD (RAMO 1) =====
  // Cuota patronal: 20.40% sobre el SBC (3 días a cargo patrón + 1.10%)
  // Para fines prácticos simplificado:
  cuotas.push({
    concepto: 'Enfermedades y Maternidad (Patronal fija)',
    base: sbcAjustado * 3, // 3 días a cargo del patrón
    tasaPatronal: 0.204,
    tasaObrero: 0,
    cuotaPatronal: sbcAjustado * 3 * 0.204,
    cuotaObrero: 0,
    total: sbcAjustado * 3 * 0.204,
  });

  // Enfermedades y Maternidad excedente (Patronal 1.10% + Obrero 0.40%)
  const baseExcedente = Math.max(0, baseMensual - baseMensualUMA * 3);
  cuotas.push({
    concepto: 'Enfermedades y Maternidad (Excedente 3 UMA)',
    base: baseExcedente,
    tasaPatronal: 0.011,
    tasaObrero: 0.004,
    cuotaPatronal: baseExcedente * 0.011,
    cuotaObrero: baseExcedente * 0.004,
    total: baseExcedente * 0.015,
  });

  // ===== RIESGOS DE TRABAJO (RAMO 2) =====
  // Tasa promedio 2.5% (varía según clase de riesgo I-V)
  cuotas.push({
    concepto: 'Riesgos de Trabajo (clase I-II)',
    base: baseMensual,
    tasaPatronal: 0.025,
    tasaObrero: 0,
    cuotaPatronal: baseMensual * 0.025,
    cuotaObrero: 0,
    total: baseMensual * 0.025,
  });

  // ===== INVALIDEZ Y VIDA (RAMO 3) =====
  // Patronal 1.75% sobre SBC, Obrero 0.625%
  cuotas.push({
    concepto: 'Invalidez y Vida',
    base: baseMensual,
    tasaPatronal: 0.0175,
    tasaObrero: 0.00625,
    cuotaPatronal: baseMensual * 0.0175,
    cuotaObrero: baseMensual * 0.00625,
    total: baseMensual * 0.02375,
  });

  // ===== RETIRO (RAMO 4) =====
  // Patronal 2% sobre SBC, Obrero 0%
  cuotas.push({
    concepto: 'Retiro, Cesantía y Vejez (Retiro)',
    base: baseMensual,
    tasaPatronal: 0.02,
    tasaObrero: 0,
    cuotaPatronal: baseMensual * 0.02,
    cuotaObrero: 0,
    total: baseMensual * 0.02,
  });

  // CESANTÍA Y VEJEZ (Ramo 4)
  // Patronal 3.150% y Obrero 1.125% sobre SBC hasta 25 UMA
  cuotas.push({
    concepto: 'Cesantía en Edad Avanzada y Vejez',
    base: sbcAjustado * diasTrabajados,
    tasaPatronal: 0.0315,
    tasaObrero: 0.01125,
    cuotaPatronal: sbcAjustado * diasTrabajados * 0.0315,
    cuotaObrero: sbcAjustado * diasTrabajados * 0.01125,
    total: sbcAjustado * diasTrabajados * 0.04275,
  });

  // ===== GUARDERÍAS Y PRESTACIONES SOCIALES =====
  // Patronal 1% sobre SBC
  cuotas.push({
    concepto: 'Guarderías y Prestaciones Sociales',
    base: baseMensual,
    tasaPatronal: 0.01,
    tasaObrero: 0,
    cuotaPatronal: baseMensual * 0.01,
    cuotaObrero: 0,
    total: baseMensual * 0.01,
  });

  const totalPatronal = cuotas.reduce((s, c) => s + c.cuotaPatronal, 0);
  const totalObrero = cuotas.reduce((s, c) => s + c.cuotaObrero, 0);

  return {
    salarioDiario: SBC,
    sbc: sbcAjustado,
    diasTrabajados,
    cuotas,
    totalPatronal,
    totalObrero,
    total: totalPatronal + totalObrero,
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const hoy = new Date();
  const mes = parseInt(searchParams.get('mes') ?? String(hoy.getMonth() + 1));
  const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));

  // Calcular IMSS para todos los empleados activos
  const empleados = await db.empleado.findMany({
    where: { status: 'activo' },
  });

  const detalleEmpleados = empleados.map(e => {
    const salarioDiario = e.salarioMensual / 30;
    const calc = calcularCuotasIMSS(salarioDiario, 30);
    return {
      empleadoId: e.id,
      nombre: e.nombre,
      rfc: e.rfc,
      salarioMensual: e.salarioMensual,
      ...calc,
    };
  });

  const totalPatronal = detalleEmpleados.reduce((s, e) => s + e.totalPatronal, 0);
  const totalObrero = detalleEmpleados.reduce((s, e) => s + e.totalObrero, 0);

  return NextResponse.json({
    periodo: { mes, anio },
    uma: { diaria: UMA_DIARIA_2026, mensual: UMA_MENSUAL_2026 },
    empleados: detalleEmpleados,
    totalEmpleados: empleados.length,
    totalCuotaPatronal: totalPatronal,
    totalCuotaObrero: totalObrero,
    totalAPagar: totalPatronal + totalObrero,
    // Costo total para la empresa = nómina + cuota patronal IMSS
    costoTotalEmpresarial: empleados.reduce((s, e) => s + e.salarioMensual, 0) + totalPatronal,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { salarioMensual, diasTrabajados = 30 } = body;
    const salarioDiario = parseFloat(salarioMensual) / 30;
    const calc = calcularCuotasIMSS(salarioDiario, diasTrabajados);
    return NextResponse.json({
      salarioMensual: parseFloat(salarioMensual),
      ...calc,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
