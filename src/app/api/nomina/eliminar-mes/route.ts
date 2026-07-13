import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * DELETE /api/nomina/eliminar-mes?mes=7&anio=2026&empresaId=xxx
 * Elimina TODOS los recibos de nómina de un mes específico.
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mes = parseInt(searchParams.get('mes') || '0');
    const anio = parseInt(searchParams.get('anio') || '0');
    const empresaId = searchParams.get('empresaId');

    if (!mes || !anio) {
      return NextResponse.json({ error: 'Falta mes o anio' }, { status: 400 });
    }

    const inicio = new Date(anio, mes - 1, 1);
    const fin = new Date(anio, mes, 0, 23, 59, 59);

    const where: any = { fecha: { gte: inicio, lte: fin } };
    if (empresaId) where.empresaId = empresaId;

    const resultado = await db.reciboNomina.deleteMany({ where });

    return NextResponse.json({
      success: true,
      eliminados: resultado.count,
      message: `✅ ${resultado.count} recibo(s) de nómina eliminado(s) de ${mes}/${anio}`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
