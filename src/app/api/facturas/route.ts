import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/facturas?direccion=emitida&empresaId=xxx&mes=7&anio=2026&limit=50
 *
 * Filtros:
 *   direccion: emitida | recibida
 *   empresaId: ID de empresa
 *   mes: 1-12 (filtra por mes)
 *   anio: año (ej: 2026)
 *   limit: máximo resultados
 *   tipo: I (ingreso), E (nota de crédito), T, P — opcional
 *
 * IMPORTANTE: Excluye nómina (tipo N) — va al módulo de Nómina
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const direccion = searchParams.get('direccion');
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50'), 500);
  const mes = searchParams.get('mes');
  const anio = searchParams.get('anio');
  const tipo = searchParams.get('tipo'); // I, E, T, P

  const where: any = {};
  if (direccion) where.direccion = direccion;
  if (searchParams.get('empresaId')) where.empresaId = searchParams.get('empresaId');
  // Excluir nómina (tipo N) del SAT
  where.tipoComprobante = tipo ? tipo : { not: 'N' };

  // Filtro por mes y año
  if (mes && anio) {
    const inicioMes = new Date(parseInt(anio), parseInt(mes) - 1, 1);
    const finMes = new Date(parseInt(anio), parseInt(mes), 0, 23, 59, 59);
    where.fecha = { gte: inicioMes, lte: finMes };
  } else if (anio) {
    const inicioAnio = new Date(parseInt(anio), 0, 1);
    const finAnio = new Date(parseInt(anio), 11, 31, 23, 59, 59);
    where.fecha = { gte: inicioAnio, lte: finAnio };
  }

  const facturas = await db.factura.findMany({
    where,
    orderBy: { fecha: 'desc' },
    take: limit,
    include: { cliente: true, proveedor: true },
  });

  const total = facturas.reduce((s, f) => s + f.total, 0);
  const iva = facturas.reduce((s, f) => s + f.totalImpuestos, 0);
  const subtotal = facturas.reduce((s, f) => s + f.subtotal, 0);

  // Resumen por mes del año
  const anioActual = anio ? parseInt(anio) : new Date().getFullYear();
  const inicioAnioActual = new Date(anioActual, 0, 1);
  const finAnioActual = new Date(anioActual, 11, 31, 23, 59, 59);

  const todasDelAnio = await db.factura.findMany({
    where: {
      ...(direccion ? { direccion } : {}),
      ...(searchParams.get('empresaId') ? { empresaId: searchParams.get('empresaId') as string } : {}),
      tipoComprobante: { not: 'N' }, // Excluir nómina
      fecha: { gte: inicioAnioActual, lte: finAnioActual },
    },
    select: { fecha: true, total: true, totalImpuestos: true, direccion: true, tipoComprobante: true },
  });

  const resumenMensual: Array<{
    mes: number;
    emitidas: number;
    recibidas: number;
    notasCreditoEmitidas: number;
    notasCreditoRecibidas: number;
    totalEmitido: number;
    totalRecibido: number;
    totalNotasCreditoE: number;
    totalNotasCreditoR: number;
  }> = [];

  for (let m = 1; m <= 12; m++) {
    const delMes = todasDelAnio.filter(f => new Date(f.fecha).getMonth() + 1 === m);
    resumenMensual.push({
      mes: m,
      emitidas: delMes.filter(f => f.direccion === 'emitida' && f.tipoComprobante === 'I').length,
      recibidas: delMes.filter(f => f.direccion === 'recibida' && f.tipoComprobante === 'I').length,
      notasCreditoEmitidas: delMes.filter(f => f.direccion === 'emitida' && f.tipoComprobante === 'E').length,
      notasCreditoRecibidas: delMes.filter(f => f.direccion === 'recibida' && f.tipoComprobante === 'E').length,
      totalEmitido: delMes.filter(f => f.direccion === 'emitida' && f.tipoComprobante === 'I').reduce((s, f) => s + f.total, 0),
      totalRecibido: delMes.filter(f => f.direccion === 'recibida' && f.tipoComprobante === 'I').reduce((s, f) => s + f.total, 0),
      totalNotasCreditoE: delMes.filter(f => f.direccion === 'emitida' && f.tipoComprobante === 'E').reduce((s, f) => s + f.total, 0),
      totalNotasCreditoR: delMes.filter(f => f.direccion === 'recibida' && f.tipoComprobante === 'E').reduce((s, f) => s + f.total, 0),
    });
  }

  return NextResponse.json({
    facturas,
    total,
    iva,
    subtotal,
    count: facturas.length,
    resumenMensual,
    periodo: mes ? { mes: parseInt(mes), anio: anioActual } : { anio: anioActual },
  });
}
