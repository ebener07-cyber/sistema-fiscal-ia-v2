import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const empresaId = searchParams.get('empresaId');
  const empleados = await db.empleado.findMany({
    where: empresaId ? { empresaId } : undefined,
    include: { _count: { select: { recibosNomina: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ empleados });
}
