import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const proveedores = await db.proveedor.findMany({
    include: { _count: { select: { facturas: true, ordenesCompra: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ proveedores });
}
