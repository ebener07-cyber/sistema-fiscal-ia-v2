import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * DELETE /api/facturas/eliminar-mes?mes=7&anio=2026&direccion=recibida&empresaId=xxx
 * Elimina TODAS las facturas de un mes específico.
 * Solo elimina facturas (no nómina — nómina se elimina desde /api/nomina/eliminar-mes)
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const mes = parseInt(searchParams.get('mes') || '0');
    const anio = parseInt(searchParams.get('anio') || '0');
    const direccion = searchParams.get('direccion'); // emitida | recibida
    const empresaId = searchParams.get('empresaId');

    if (!mes || !anio) {
      return NextResponse.json({ error: 'Falta mes o anio' }, { status: 400 });
    }

    const inicio = new Date(anio, mes - 1, 1);
    const fin = new Date(anio, mes, 0, 23, 59, 59);

    const where: any = {
      fecha: { gte: inicio, lte: fin },
      tipoComprobante: { not: 'N' }, // No tocar nómina
    };
    if (direccion) where.direccion = direccion;
    if (empresaId) where.empresaId = empresaId;

    const resultado = await db.factura.deleteMany({ where });

    return NextResponse.json({
      success: true,
      eliminadas: resultado.count,
      message: `✅ ${resultado.count} factura(s) eliminada(s) de ${mes}/${anio}`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
