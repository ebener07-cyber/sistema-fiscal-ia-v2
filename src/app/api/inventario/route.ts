import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId');
    const productos = await db.producto.findMany({
      where: empresaId ? { empresaId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ productos });
  } catch (error: any) {
    console.error('Error en /api/inventario:', error.message);
    return NextResponse.json({ productos: [] });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { codigo, nombre, categoria, existencia, minimo, precio, empresaId } = body;

    if (!codigo || !nombre) {
      return NextResponse.json({ error: 'Código y nombre son obligatorios' }, { status: 400 });
    }

    const producto = await db.producto.create({
      data: {
        codigo: String(codigo),
        nombre: String(nombre).slice(0, 200),
        categoria: categoria || null,
        existencia: parseInt(existencia) || 0,
        minimo: parseInt(minimo) || 0,
        precio: parseFloat(precio) || 0,
        empresaId: empresaId || '',
      },
    });

    return NextResponse.json(producto, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
