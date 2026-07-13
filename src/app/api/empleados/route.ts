import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {

  const empleados = await db.empleado.findMany({
    include: { _count: { select: { recibosNomina: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json({ empleados });
  } catch (error: any) {
    console.error('Error en src/app/api/empleados/route.ts:', error.message);
    return NextResponse.json({ empleados: [] });
  }
}
