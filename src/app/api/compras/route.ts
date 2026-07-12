import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const empresaId = searchParams.get('empresaId');
  const ordenes = await db.ordenCompra.findMany({
    where: empresaId ? { empresaId } : undefined,
    include: { proveedor: true },
    orderBy: { fecha: 'desc' },
  });
  return NextResponse.json({ ordenes });
}
