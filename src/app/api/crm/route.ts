import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const oportunidades = await db.oportunidad.findMany({
    include: { cliente: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ oportunidades });
}
