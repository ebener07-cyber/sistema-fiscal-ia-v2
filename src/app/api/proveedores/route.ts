import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const empresaId = searchParams.get('empresaId');
  const proveedores = await db.proveedor.findMany({
    where: empresaId ? { empresaId } : undefined,
    include: { _count: { select: { facturas: true, ordenesCompra: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ proveedores });
}
