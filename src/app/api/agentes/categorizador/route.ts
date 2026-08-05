import { NextRequest, NextResponse } from 'next/server';
import { clasificarMovimientosEmpresa, clasificarMovimiento, obtenerEstadisticasClasificacion } from '@/lib/agentes/categorizador';

/**
 * AGENTE CATEGORIZADOR — Endpoint
 *
 * POST /api/agentes/categorizador
 * Body: {
 *   empresaId: string,
 *   opciones?: { limite?: number, forzarReclasificar?: boolean }
 * }
 * Clasifica movimientos bancarios sin categoría (en lotes).
 *
 * POST /api/agentes/categorizador?single=true
 * Body: { concepto: string, monto: number }
 * Clasifica un solo movimiento (sin guardar en BD).
 *
 * GET /api/agentes/categorizador?empresaId=xxx
 * Devuelve estadísticas de clasificación.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const isSingle = url.searchParams.get('single') === 'true';
    const body = await req.json();

    // Modo single: clasificar un movimiento sin guardar
    if (isSingle) {
      const { concepto, monto } = body as { concepto: string; monto: number };
      if (!concepto) return NextResponse.json({ error: 'concepto requerido' }, { status: 400 });

      const resultado = await clasificarMovimiento(concepto, monto || 0);
      return NextResponse.json(resultado);
    }

    // Modo lote: clasificar todos los movimientos sin categoría
    const { empresaId, opciones } = body as {
      empresaId: string;
      opciones?: { limite?: number; forzarReclasificar?: boolean };
    };

    if (!empresaId) return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });

    const resultado = await clasificarMovimientosEmpresa(empresaId, opciones);
    return NextResponse.json({
      success: true,
      ...resultado,
    });
  } catch (e: any) {
    console.error('Error en categorizador:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId');
    if (!empresaId) return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });

    const stats = await obtenerEstadisticasClasificacion(empresaId);
    return NextResponse.json(stats);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
