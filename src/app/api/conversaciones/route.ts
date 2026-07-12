import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

/** GET /api/conversaciones — últimas 50 */
export async function GET() {
  const conversaciones = await db.conversacion.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  // Devolver en orden cronológico (asc) para mostrar en chat
  return NextResponse.json({ conversaciones: conversaciones.reverse() });
}

/** DELETE /api/conversaciones — borrar todo */
export async function DELETE() {
  await db.conversacion.deleteMany({});
  return NextResponse.json({ ok: true });
}
