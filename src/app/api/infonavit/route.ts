import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/infonavit?mes=7&anio=2026
 * Calcula aportaciones INFONAVIT del mes.
 *
 * POST /api/infonavit
 * Body: { salarioMensual, diasTrabajados }
 */

export const runtime = 'nodejs';

// UMA 2026
const UMA_DIARIA_2026 = 108.57;
// Tope INFONAVIT: 25 UMA diarias
const TOPE_UMA_INFONAVIT = 25;

interface AportacionINFONAVIT {
  concepto: string;
  base: number;
  tasa: number;
  monto: number;
  responsable: string; // patronal u obrera
}

function calcularINFONAVIT(salarioDiario: number, diasTrabajados: number = 30) {
  const SBC = salarioDiario;
  const topeSBC = TOPE_UMA_INFONAVIT * UMA_DIARIA_2026;
  const sbcAjustado = Math.min(SBC, topeSBC);
  const baseMensual = sbcAjustado * diasTrabajados;

  const aportaciones: AportacionINFONAVIT[] = [];

  // ===== APORTE PATRONAL 5% =====
  // El patrón aporta el 5% sobre el SBC al fondo de vivienda
  aportaciones.push({
    concepto: 'Aporte Patronal 5% (Fondo de Vivienda)',
    base: baseMensual,
    tasa: 0.05,
    monto: baseMensual * 0.05,
    responsable: 'patronal',
  });

  // ===== AMORTIZACIÓN DE CRÉDITO (si aplica) =====
  // Si el empleado tiene crédito INFONAVIT, se retiene de su salario
  // Por defecto asumimos 0; se configura individualmente
  aportaciones.push({
    concepto: 'Amortización de crédito (retención obrera)',
    base: baseMensual,
    tasa: 0, // configurable por empleado
    monto: 0,
    responsable: 'obrera',
  });

  // ===== APORTACIÓN AL FONDO NACIONAL DE VIVIENDA =====
  // 5% patronal sobre SBC (mismo concepto, desglose administrativo)
  aportaciones.push({
    concepto: 'Aporte Patronal INFONAVIT (total)',
    base: baseMensual,
    tasa: 0.05,
    monto: baseMensual * 0.05,
    responsable: 'patronal',
  });

  const totalPatronal = aportaciones
    .filter(a => a.responsable === 'patronal')
    .reduce((s, a) => s + a.monto, 0);
  const totalObrero = aportaciones
    .filter(a => a.responsable === 'obrera')
    .reduce((s, a) => s + a.monto, 0);

  return {
    salarioDiario: SBC,
    sbc: sbcAjustado,
    diasTrabajados,
    topeSBC: topeSBC,
    aportaciones,
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

  const empleados = await db.empleado.findMany({
    where: { status: 'activo' },
  });

  const detalleEmpleados = empleados.map(e => {
    const salarioDiario = e.salarioMensual / 30;
    const calc = calcularINFONAVIT(salarioDiario, 30);
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
    uma: { diaria: UMA_DIARIA_2026 },
    topeSBC: TOPE_UMA_INFONAVIT * UMA_DIARIA_2026,
    empleados: detalleEmpleados,
    totalEmpleados: empleados.length,
    totalAportacionPatronal: totalPatronal,
    totalRetencionObrera: totalObrero,
    total: totalPatronal + totalObrero,
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { salarioMensual, diasTrabajados = 30 } = body;
    const salarioDiario = parseFloat(salarioMensual) / 30;
    const calc = calcularINFONAVIT(salarioDiario, diasTrabajados);
    return NextResponse.json({
      salarioMensual: parseFloat(salarioMensual),
      ...calc,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
