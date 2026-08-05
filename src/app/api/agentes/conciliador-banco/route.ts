import { NextRequest, NextResponse } from 'next/server';
import { conciliarMovimientosConFacturas, obtenerEstadisticasConciliacion } from '@/lib/agentes/conciliador-banco';

/**
 * AGENTE CONCILIADOR BANCO-FACTURAS — Endpoint
 *
 * POST /api/agentes/conciliador-banco
 * Body: {
 *   empresaId: string,
 *   opciones?: { limite?: number, forzarReconciliar?: boolean }
 * }
 * Concilia movimientos bancarios con facturas (emitidas/recibidas).
 *
 * GET /api/agentes/conciliador-banco?empresaId=xxx
 * Devuelve estadísticas de conciliación.
 *
 * Reglas:
 * - Movimiento positivo (depósito) → busca factura EMITIDA con mismo monto
 * - Movimiento negativo (pago) → busca factura RECIBIDA con mismo monto
 * - Tolerancia monto: ±2%
 * - Tolerancia fecha: ±3 días (penaliza score si >3)
 * - Match por RFC en concepto si no hay match por monto
 * - Múltiples matches → pendiente_revision (HITL)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { empresaId, opciones } = body as {
      empresaId: string;
      opciones?: { limite?: number; forzarReconciliar?: boolean };
    };

    if (!empresaId) return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });

    const resultado = await conciliarMovimientosConFacturas(empresaId, opciones);
    return NextResponse.json({
      success: true,
      ...resultado,
    });
  } catch (e: any) {
    console.error('Error en conciliador-banco:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId');
    if (!empresaId) return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });

    const stats = await obtenerEstadisticasConciliacion(empresaId);
    return NextResponse.json(stats);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
