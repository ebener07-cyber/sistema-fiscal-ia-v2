import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const empresaId = searchParams.get('empresaId');
  const clientes = await db.cliente.findMany({
    where: empresaId ? { empresaId } : undefined,
    include: { _count: { select: { facturas: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ clientes });
}
