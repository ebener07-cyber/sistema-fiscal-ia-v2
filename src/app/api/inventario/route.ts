import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {

  const productos = await db.producto.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ productos });
  } catch (error: any) {
    console.error('Error en src/app/api/inventario/route.ts:', error.message);
    return NextResponse.json({ productos: [] });
  }
}
