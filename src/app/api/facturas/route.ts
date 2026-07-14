import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/facturas?direccion=emitida&empresaId=xxx&mes=7&anio=2026&page=1&pageSize=50
 *
 * Filtros:
 *   direccion: emitida | recibida
 *   empresaId: ID de empresa
 *   mes: 1-12 (filtra por mes)
 *   anio: año (ej: 2026) — SIEMPRE se usa para calcular el resumen mensual
 *   tipo: I (ingreso), E (nota de crédito), T, P — opcional
 *   page: número de página (default 1)
 *   pageSize: resultados por página (default 50, máximo 500)
 *   all: si es "true", devuelve TODOS sin paginar (para exports)
 *
 * IMPORTANTE: Excluye nómina (tipo N) — va al módulo de Nómina
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const direccion = searchParams.get('direccion');
    const mes = searchParams.get('mes');
    const anio = searchParams.get('anio');
    const tipo = searchParams.get('tipo'); // I, E, T, P
    const empresaId = searchParams.get('empresaId');

    // Paginación
    const all = searchParams.get('all') === 'true';
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const pageSize = Math.min(Math.max(1, parseInt(searchParams.get('pageSize') ?? '50')), 500);

    const where: any = {};
    if (direccion) where.direccion = direccion;
    if (empresaId) where.empresaId = empresaId;
    // Excluir nómina (tipo N) del módulo de facturas
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

    // Si all=true, traer TODO (para exports Excel)
    const findOptions: any = {
      where,
      orderBy: { fecha: 'desc' },
      include: { cliente: true, proveedor: true },
    };
    if (!all) {
      findOptions.skip = (page - 1) * pageSize;
      findOptions.take = pageSize;
    }

    // Ejecutar consulta paginada + count total en paralelo
    const [facturas, totalCount] = await Promise.all([
      db.factura.findMany(findOptions),
      db.factura.count({ where }),
    ]);

    const total = facturas.reduce((s, f) => s + f.total, 0);
    const iva = facturas.reduce((s, f) => s + f.totalImpuestos, 0);
    const subtotal = facturas.reduce((s, f) => s + f.subtotal, 0);

    // Resumen por mes del año (siempre se calcula, sin paginación)
    const anioActual = anio ? parseInt(anio) : new Date().getFullYear();
    const inicioAnioActual = new Date(anioActual, 0, 1);
    const finAnioActual = new Date(anioActual, 11, 31, 23, 59, 59);

    const whereAnio: any = {
      ...(direccion ? { direccion } : {}),
      ...(empresaId ? { empresaId } : {}),
      tipoComprobante: tipo ? tipo : { not: 'N' },
      fecha: { gte: inicioAnioActual, lte: finAnioActual },
    };

    const todasDelAnio = await db.factura.findMany({
      where: whereAnio,
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
      totalCount, // ← total de facturas que coinciden con el filtro (sin paginar)
      pagination: {
        page,
        pageSize,
        totalPages: Math.ceil(totalCount / pageSize),
        hasNext: page * pageSize < totalCount,
        hasPrev: page > 1,
      },
      resumenMensual,
      periodo: mes ? { mes: parseInt(mes), anio: anioActual } : { anio: anioActual },
    });
  } catch (error: any) {
    console.error('Error en /api/facturas:', error.message);
    return NextResponse.json({
      facturas: [],
      total: 0,
      iva: 0,
      subtotal: 0,
      count: 0,
      totalCount: 0,
      pagination: { page: 1, pageSize: 50, totalPages: 0, hasNext: false, hasPrev: false },
      resumenMensual: [],
      error: error.message,
    });
  }
}
