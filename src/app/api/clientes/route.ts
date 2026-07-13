import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId');

    const clientes = await db.cliente.findMany({
      where: empresaId ? { empresaId } : undefined,
      include: { _count: { select: { facturas: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ clientes });
  } catch (error: any) {
    console.error('Error en src/app/api/clientes/route.ts:', error.message);
    return NextResponse.json({ clientes: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nombre, rfc, email, telefono, direccion, empresaId } = body;

    if (!nombre || !empresaId) {
      return NextResponse.json(
        { error: 'Nombre y empresaId son obligatorios' },
        { status: 400 }
      );
    }

    const cliente = await db.cliente.create({
      data: {
        nombre: String(nombre).slice(0, 200),
        rfc: rfc ? String(rfc).toUpperCase() : null,
        email: email || null,
        telefono: telefono || null,
        direccion: direccion || null,
        empresaId: String(empresaId),
      },
    });
    return NextResponse.json(cliente, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
