import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {

  const clientes = await db.cliente.findMany({
    include: { _count: { select: { facturas: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ clientes });
  } catch (error: any) {
    console.error('Error en src/app/api/clientes/route.ts:', error.message);
    return NextResponse.json({ clientes: [] });
  }
}
