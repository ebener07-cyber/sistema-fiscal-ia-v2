import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  try {

  const [cuentas, movimientos] = await Promise.all([
    db.cuentaBancaria.findMany({ include: { _count: { select: { movimientos: true } } } }),
    db.movimientoBanco.findMany({ include: { cuenta: true }, orderBy: { fecha: 'desc' }, take: 20 }),
  ]);
  return NextResponse.json({ cuentas, movimientos });
  } catch (error: any) {
    console.error('Error en src/app/api/bancos/route.ts:', error.message);
    return NextResponse.json({ cuentas: [], movimientos: [] });
  }
}
