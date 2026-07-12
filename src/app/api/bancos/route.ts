import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const empresaId = searchParams.get('empresaId');
  const [cuentas, movimientos] = await Promise.all([
    db.cuentaBancaria.findMany({ where: empresaId ? { empresaId } : undefined, include: { _count: { select: { movimientos: true } } } }),
    db.movimientoBanco.findMany({ where: empresaId ? { cuenta: { empresaId } } : undefined, include: { cuenta: true }, orderBy: { fecha: 'desc' }, take: 20 }),
  ]);
  return NextResponse.json({ cuentas, movimientos });
}
