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
    if (body.titulo) data.titulo = String(body.titulo).slice(0, 200);
    if (body.contenido !== undefined) data.contenido = body.contenido;
    if (body.color) data.color = body.color;
    if (body.fijada !== undefined) data.fijada = Boolean(body.fijada);
    if (body.archivada !== undefined) data.archivada = Boolean(body.archivada);
    const actualizada = await db.nota.update({ where: { id }, data });
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
    await db.nota.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
