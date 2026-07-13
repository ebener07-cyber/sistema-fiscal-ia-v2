import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/** GET /api/empresas — lista todas las empresas */
export async function GET() {
  try {
    const empresas = await db.empresa.findMany({
      include: {
        _count: {
          select: { clientes: true, proveedores: true, facturas: true, empleados: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ empresas });
  } catch (error: any) {
    console.error('Error en /api/empresas GET:', error.message);
    return NextResponse.json({ empresas: [] });
  }
}

/** POST /api/empresas — alta de empresa */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nombre, rfc, regimenFiscal, email, telefono, direccion } = body;

    if (!nombre || !rfc) {
      return NextResponse.json({ error: 'Nombre y RFC son obligatorios' }, { status: 400 });
    }

    const existente = await db.empresa.findUnique({ where: { rfc: rfc.toUpperCase() } });
    if (existente) {
      return NextResponse.json({ error: `Ya existe una empresa con RFC ${rfc}` }, { status: 409 });
    }

    const empresa = await db.empresa.create({
      data: {
        nombre: String(nombre).slice(0, 200),
        rfc: String(rfc).toUpperCase().trim(),
        regimenFiscal: regimenFiscal || null,
        email: email || null,
        telefono: telefono || null,
        direccion: direccion || null,
        status: 'activo',
      },
    });

    return NextResponse.json(empresa, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
