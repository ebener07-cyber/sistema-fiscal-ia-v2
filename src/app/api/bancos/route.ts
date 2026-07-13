import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId');
    const [cuentas, movimientos] = await Promise.all([
      db.cuentaBancaria.findMany({
        where: empresaId ? { empresaId } : undefined,
        include: { _count: { select: { movimientos: true } } },
      }),
      db.movimientoBanco.findMany({
        where: empresaId ? { cuenta: { empresaId } } : undefined,
        include: { cuenta: true },
        orderBy: { fecha: 'desc' },
        take: 20,
      }),
    ]);
    return NextResponse.json({ cuentas, movimientos });
  } catch (error: any) {
    console.error('Error en /api/bancos:', error.message);
    return NextResponse.json({ cuentas: [], movimientos: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { banco, cuenta, saldo, tipo, empresaId } = body;

    if (!banco || !cuenta) {
      return NextResponse.json({ error: 'Banco y cuenta son obligatorios' }, { status: 400 });
    }

    const cuentaBancaria = await db.cuentaBancaria.create({
      data: {
        banco: String(banco),
        cuenta: String(cuenta),
        saldo: parseFloat(saldo) || 0,
        tipo: tipo || 'operaciones',
        empresaId: empresaId || '',
      },
    });

    return NextResponse.json(cuentaBancaria, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
