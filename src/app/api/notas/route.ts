import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const notas = await db.nota.findMany({
    where: { archivada: false },
    orderBy: [{ fijada: 'desc' }, { createdAt: 'desc' }],
    take: 100,
  });
  return NextResponse.json({ notas });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const nota = await db.nota.create({
      data: {
        titulo: String(body.titulo).slice(0, 200),
        contenido: String(body.contenido),
        color: body.color ?? 'amarillo',
        origen: 'manual',
      },
    });
    return NextResponse.json(nota, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
