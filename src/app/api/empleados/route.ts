import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId');

    const empleados = await db.empleado.findMany({
      where: empresaId ? { empresaId } : undefined,
      include: { _count: { select: { recibosNomina: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ empleados });
  } catch (error: any) {
    console.error('Error en src/app/api/empleados/route.ts:', error.message);
    return NextResponse.json({ empleados: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nombre, rfc, curp, puesto, salarioMensual, status, empresaId } = body;

    if (!nombre || !empresaId) {
      return NextResponse.json(
        { error: 'Nombre y empresaId son obligatorios' },
        { status: 400 }
      );
    }

    const empleado = await db.empleado.create({
      data: {
        nombre: String(nombre).slice(0, 200),
        rfc: rfc ? String(rfc).toUpperCase() : null,
        curp: curp ? String(curp).toUpperCase() : null,
        puesto: puesto || null,
        salarioMensual: parseFloat(salarioMensual) || 0,
        status: status || 'activo',
        empresaId: String(empresaId),
      },
    });
    return NextResponse.json(empleado, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
