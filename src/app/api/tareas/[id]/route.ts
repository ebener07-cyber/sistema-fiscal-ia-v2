import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data: any = {};
    if (body.estado) {
      data.estado = body.estado;
      if (body.estado === 'completada') data.completadaEn = new Date();
    }
    if (body.prioridad) data.prioridad = body.prioridad;
    if (body.titulo) data.titulo = String(body.titulo).slice(0, 200);
    if (body.descripcion !== undefined) data.descripcion = body.descripcion;
    if (body.categoria !== undefined) data.categoria = body.categoria;
    if (body.fechaLimite !== undefined) {
      data.fechaLimite = body.fechaLimite ? new Date(body.fechaLimite) : null;
    }
    const actualizada = await db.tarea.update({ where: { id }, data });
    return NextResponse.json(actualizada);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await db.tarea.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
