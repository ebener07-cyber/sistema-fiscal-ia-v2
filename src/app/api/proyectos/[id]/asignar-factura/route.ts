import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/proyectos/[id]/asignar-factura
 * Body: { facturaIds: string[] }
 * Asigna una o varias facturas existentes a este proyecto.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { facturaIds } = await req.json();

    if (!Array.isArray(facturaIds) || facturaIds.length === 0) {
      return NextResponse.json(
        { error: 'Se requiere un array de facturaIds' },
        { status: 400 }
      );
    }

    // Verificar que el proyecto existe
    const proyecto = await db.proyecto.findUnique({ where: { id } });
    if (!proyecto) {
      return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
    }

    // Asignar las facturas al proyecto
    const result = await db.factura.updateMany({
      where: { id: { in: facturaIds } },
      data: { proyectoId: id },
    });

    return NextResponse.json({
      ok: true,
      asignadas: result.count,
      message: `${result.count} factura(s) asignada(s) al proyecto "${proyecto.nombre}"`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/proyectos/[id]/asignar-factura?facturaId=xxx
 * Desvincula una factura del proyecto.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const facturaId = searchParams.get('facturaId');

    if (!facturaId) {
      return NextResponse.json({ error: 'Se requiere facturaId' }, { status: 400 });
    }

    await db.factura.update({
      where: { id: facturaId, proyectoId: id },
      data: { proyectoId: null },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
