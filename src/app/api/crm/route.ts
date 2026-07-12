import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const empresaId = searchParams.get('empresaId');
  const oportunidades = await db.oportunidad.findMany({
    where: empresaId ? { cliente: { empresaId } } : undefined,
    include: { cliente: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ oportunidades });
}
