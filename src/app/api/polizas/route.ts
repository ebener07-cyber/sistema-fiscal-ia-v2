import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/polizas?empresaId=xxx
 *
 * Nota: El modelo Poliza no tiene empresaId directo en el schema actual.
 * Para una versión futura, agregar campo empresaId a Poliza.
 * Por ahora devuelve todas las pólizas (pendiente de migración).
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId');

    // TODO: cuando se agregue empresaId al modelo Poliza, descomentar:
    // const polizas = await db.poliza.findMany({
    //   where: empresaId ? { empresaId } : undefined,
    //   orderBy: { fecha: 'desc' },
    //   take: 50,
    // });

    const polizas = await db.poliza.findMany({
      orderBy: { fecha: 'desc' },
      take: 50,
    });

    return NextResponse.json({ polizas, empresaId: empresaId || null });
  } catch (error: any) {
    console.error('Error en src/app/api/polizas/route.ts:', error.message);
    return NextResponse.json({ polizas: [] });
  }
}
