import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const ordenes = await db.ordenCompra.findMany({
    include: { proveedor: true },
    orderBy: { fecha: 'desc' },
  });
  return NextResponse.json({ ordenes });
}
