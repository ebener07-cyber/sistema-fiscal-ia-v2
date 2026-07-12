import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const empresaId = searchParams.get('empresaId');
  const productos = await db.producto.findMany({
    where: empresaId ? { empresaId } : undefined,
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ productos });
}
