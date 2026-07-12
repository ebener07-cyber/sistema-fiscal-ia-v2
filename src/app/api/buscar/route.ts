import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/buscar?q=texto
 * Busca en tareas, notas y recordatorios simultáneamente.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get('q')?.trim();

  if (!q || q.length < 2) {
    return NextResponse.json({ tareas: [], notas: [], recordatorios: [] });
  }

  const [tareas, notas, recordatorios] = await Promise.all([
    db.tarea.findMany({
      where: {
        OR: [
          { titulo: { contains: q } },
          { descripcion: { contains: q } },
          { categoria: { contains: q } },
        ],
      },
      orderBy: [{ prioridad: 'desc' }, { createdAt: 'desc' }],
      take: 20,
    }),
    db.nota.findMany({
      where: {
        archivada: false,
        OR: [{ titulo: { contains: q } }, { contenido: { contains: q } }],
      },
      orderBy: [{ fijada: 'desc' }, { createdAt: 'desc' }],
      take: 20,
    }),
    db.recordatorio.findMany({
      where: {
        OR: [{ titulo: { contains: q } }, { descripcion: { contains: q } }],
      },
      orderBy: { fechaHora: 'asc' },
      take: 20,
    }),
  ]);

  return NextResponse.json({
    query: q,
    total: tareas.length + notas.length + recordatorios.length,
    tareas,
    notas,
    recordatorios,
  });
}
