import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/crm?empresaId=xxx
 * Filtra oportunidades por empresa (vía cliente.empresaId)
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId');

    const oportunidades = await db.oportunidad.findMany({
      where: empresaId ? { cliente: { empresaId } } : undefined,
      include: { cliente: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ oportunidades });
  } catch (error: any) {
    console.error('Error en src/app/api/crm/route.ts:', error.message);
    return NextResponse.json({ oportunidades: [] });
  }
}
