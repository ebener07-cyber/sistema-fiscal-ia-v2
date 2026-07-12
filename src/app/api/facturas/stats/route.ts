import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const mes = parseInt(searchParams.get('mes') ?? String(new Date().getMonth() + 1));
  const anio = parseInt(searchParams.get('anio') ?? String(new Date().getFullYear()));

  const inicio = new Date(anio, mes - 1, 1);
  const fin = new Date(anio, mes, 0, 23, 59, 59);

  const [emitidas, recibidas] = await Promise.all([
    db.factura.findMany({
      where: { direccion: 'emitida', fecha: { gte: inicio, lte: fin } },
    }),
    db.factura.findMany({
      where: { direccion: 'recibida', fecha: { gte: inicio, lte: fin } },
    }),
  ]);

  const totalEmitido = emitidas.reduce((s, f) => s + f.monto, 0);
  const ivaEmitido = emitidas.reduce((s, f) => s + f.totalImpuestos, 0);
  const totalRecibido = recibidas.reduce((s, f) => s + f.monto, 0);
  const ivaRecibido = recibidas.reduce((s, f) => s + f.totalImpuestos, 0);
  const ivaPorPagar = ivaEmitido - ivaRecibido;
  const utilidadBruta = totalEmitido - totalRecibido;

  const porCliente = new Map<string, { nombre: string; rfc: string; total: number; count: number }>();
  for (const f of emitidas) {
    const key = f.receptorRfc || 'sin_rfc';
    const existing = porCliente.get(key);
    if (existing) {
      existing.total += f.monto;
      existing.count += 1;
    } else {
      porCliente.set(key, {
        nombre: f.receptorNombre || 'Sin nombre',
        rfc: f.receptorRfc || 'SIN RFC',
        total: f.monto,
        count: 1,
      });
    }
  }
  const topClientes = Array.from(porCliente.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  return NextResponse.json({
    periodo: { mes, anio, inicio: inicio.toISOString(), fin: fin.toISOString() },
    emitidas: {
      count: emitidas.length,
      total: totalEmitido,
      iva: ivaEmitido,
      promedio: emitidas.length > 0 ? totalEmitido / emitidas.length : 0,
    },
    recibidas: {
      count: recibidas.length,
      total: totalRecibido,
      iva: ivaRecibido,
      promedio: recibidas.length > 0 ? totalRecibido / recibidas.length : 0,
    },
    ivaPorPagar,
    utilidadBruta,
    topClientes,
  });
}
