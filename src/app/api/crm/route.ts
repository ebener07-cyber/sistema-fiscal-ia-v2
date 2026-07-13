import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {

  const oportunidades = await db.oportunidad.findMany({
    include: { cliente: true },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ oportunidades });
  } catch (error: any) {
    console.error('Error en src/app/api/crm/route.ts:', error.message);
    return NextResponse.json({ oportunidades: [] });
  }
}
