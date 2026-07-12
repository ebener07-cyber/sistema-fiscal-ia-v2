import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const clientes = await db.cliente.findMany({
    include: { _count: { select: { facturas: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ clientes });
}
