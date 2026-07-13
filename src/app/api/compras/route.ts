import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {

  const ordenes = await db.ordenCompra.findMany({
    include: { proveedor: true },
    orderBy: { fecha: 'desc' },
  });
  return NextResponse.json({ ordenes });
  } catch (error: any) {
    console.error('Error en src/app/api/compras/route.ts:', error.message);
    return NextResponse.json({ ordenes: [] });
  }
}
