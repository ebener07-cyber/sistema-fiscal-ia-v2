import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/proyectos/[id] — Detalle de un proyecto con todas sus facturas */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const proyecto = await db.proyecto.findUnique({
      where: { id },
      include: {
        cliente: true,
        facturas: {
          include: {
            cliente: { select: { nombre: true, rfc: true } },
            proveedor: { select: { nombre: true, rfc: true } },
          },
          orderBy: { fecha: 'desc' },
        },
      },
    });

    if (!proyecto) {
      return NextResponse.json({ error: 'Proyecto no encontrado' }, { status: 404 });
    }

    return NextResponse.json(proyecto);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** PATCH /api/proyectos/[id] — Actualizar proyecto */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();

    const proyecto = await db.proyecto.update({
      where: { id },
      data: {
        nombre: body.nombre,
        codigo: body.codigo,
        descripcion: body.descripcion,
        clienteId: body.clienteId || null,
        estado: body.estado,
        presupuesto: body.presupuesto !== undefined ? parseFloat(body.presupuesto) : undefined,
        fechaInicio: body.fechaInicio ? new Date(body.fechaInicio) : undefined,
        fechaFin: body.fechaFin ? new Date(body.fechaFin) : undefined,
      },
    });

    return NextResponse.json(proyecto);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** DELETE /api/proyectos/[id] — Eliminar proyecto (desvincula facturas) */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Desvincular facturas (poner proyectoId a null) antes de eliminar
    await db.factura.updateMany({
      where: { proyectoId: id },
      data: { proyectoId: null },
    });

    await db.proyecto.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
