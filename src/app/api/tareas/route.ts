import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/** GET /api/tareas?estado=pendiente */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const estado = searchParams.get('estado');
  const where = estado && estado !== 'todas' ? { estado } : { estado: { not: 'cancelada' } };
  const tareas = await db.tarea.findMany({
    where,
    orderBy: [{ prioridad: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  return NextResponse.json({ tareas });
}

/** POST /api/tareas — crear manualmente */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const tarea = await db.tarea.create({
      data: {
        titulo: String(body.titulo).slice(0, 200),
        descripcion: body.descripcion ?? null,
        prioridad: body.prioridad ?? 'media',
        categoria: body.categoria ?? null,
        fechaLimite: body.fechaLimite ? new Date(body.fechaLimite) : null,
        origen: 'manual',
      },
    });
    return NextResponse.json(tarea, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
