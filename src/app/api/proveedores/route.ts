import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {

  const proveedores = await db.proveedor.findMany({
    include: { _count: { select: { facturas: true, ordenesCompra: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ proveedores });
  } catch (error: any) {
    console.error('Error en src/app/api/proveedores/route.ts:', error.message);
    return NextResponse.json({ proveedores: [] });
  }
}
