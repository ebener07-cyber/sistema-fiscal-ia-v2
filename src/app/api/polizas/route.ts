import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {

  const polizas = await db.poliza.findMany({ orderBy: { fecha: 'desc' }, take: 50 });
  return NextResponse.json({ polizas });
  } catch (error: any) {
    console.error('Error en src/app/api/polizas/route.ts:', error.message);
    return NextResponse.json({ polizas: [] });
  }
}
