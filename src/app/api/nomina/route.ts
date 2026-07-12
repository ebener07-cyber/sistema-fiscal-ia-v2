import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const empresaId = searchParams.get('empresaId');
  const recibos = await db.reciboNomina.findMany({
    where: empresaId ? { empresaId } : undefined,
    include: { empleado: true },
    orderBy: { fecha: 'desc' },
  });
  return NextResponse.json({ recibos });
}
