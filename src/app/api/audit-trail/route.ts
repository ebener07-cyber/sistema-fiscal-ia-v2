import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/audit-trail?empresaId=xxx&agente=rag-fiscal&verificado=false&limit=50
 *
 * Devuelve entradas del audit trail filtradas.
 * Permite trazabilidad de las herramientas ejecutadas por los agentes IA.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId');
    const agente = searchParams.get('agente');
    const verificado = searchParams.get('verificado');
    const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);

    const where: any = {};
    if (empresaId) where.empresaId = empresaId;
    if (agente) where.agente = agente;
    if (verificado === 'true') where.verificado = true;
    if (verificado === 'false') where.verificado = false;

    const entradas = await db.auditTrail.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    // Estadísticas rápidas
    const total = await db.auditTrail.count({ where });
    const verificados = await db.auditTrail.count({ where: { ...where, verificado: true } });
    const pendientes = total - verificados;
    const promedioConfianza = total > 0
      ? await db.auditTrail.aggregate({ where, _avg: { scoreConfianza: true } })
      : null;

    return NextResponse.json({
      entradas,
      estadisticas: {
        total,
        verificados,
        pendientes,
        promedioConfianza: promedioConfianza?._avg?.scoreConfianza ?? 0,
      },
    });
  } catch (error: any) {
    console.error('Error en /api/audit-trail:', error.message);
    return NextResponse.json({
      entradas: [],
      estadisticas: { total: 0, verificados: 0, pendientes: 0, promedioConfianza: 0 },
      error: error.message,
    });
  }
}
