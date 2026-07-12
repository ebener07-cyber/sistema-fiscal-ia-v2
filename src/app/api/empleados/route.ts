import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const empleados = await db.empleado.findMany({
    include: { _count: { select: { recibosNomina: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ empleados });
}
