import { NextRequest, NextResponse } from 'next/server';
import { ejecutarConciliadorInteligente, generarDashboardConciliacion } from '@/lib/agentes/conciliador-inteligente';

/**
 * POST /api/agentes/conciliador-inteligente
 * Body: { empresaId: string }
 * Ejecuta el motor de mapeo + detección de pagos múltiples + actualiza BD
 *
 * GET /api/agentes/conciliador-inteligente?empresaId=xxx
 * Devuelve el dashboard con semáforo (verde/amarillo/rojo)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { empresaId } = body as { empresaId: string };
    if (!empresaId) return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });

    const resultado = await ejecutarConciliadorInteligente(empresaId);
    return NextResponse.json({
      success: true,
      message: `✅ ${resultado.totalProcesados} movimientos procesados | 🟢 ${resultado.conciliadosAuto} auto | 🟡 ${resultado.pendientesComprobacion} pendientes | 🔴 ${resultado.requierenAccion} requieren acción | 🔀 ${resultado.pagosMultiples} pagos múltiples`,
      ...resultado,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId');
    if (!empresaId) return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });

    const dashboard = await generarDashboardConciliacion(empresaId);
    return NextResponse.json(dashboard);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
