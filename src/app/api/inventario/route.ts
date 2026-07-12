import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const productos = await db.producto.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ productos });
}
