import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
  const ahora = new Date();
  const recordatorios = await db.recordatorio.findMany({
    where: { fechaHora: { gte: ahora }, estado: 'pendiente' },
    orderBy: { fechaHora: 'asc' },
    take: 50,
  });
  return NextResponse.json({ recordatorios });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const rec = await db.recordatorio.create({
      data: {
        titulo: String(body.titulo).slice(0, 200),
        descripcion: body.descripcion ?? null,
        fechaHora: new Date(body.fechaHora),
        recurrencia: body.recurrencia ?? 'unica',
        origen: 'manual',
      },
    });
    return NextResponse.json(rec, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
