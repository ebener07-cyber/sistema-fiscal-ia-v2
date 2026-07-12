import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const polizas = await db.poliza.findMany({ orderBy: { fecha: 'desc' }, take: 50 });
  return NextResponse.json({ polizas });
}
