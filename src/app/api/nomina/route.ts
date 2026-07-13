import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/nomina?empresaId=xxx&mes=7&anio=2026
 *
 * Devuelve recibos de nómina con filtros opcionales.
 * Si se especifica mes y año, filtra por ese periodo.
 * Siempre devuelve resumenMensual del año.
 */
export async function GET(req: NextRequest) {
  try {

  const { searchParams } = new URL(req.url);
  const empresaId = searchParams.get('empresaId');
  const mes = searchParams.get('mes');
  const anio = searchParams.get('anio');

  const where: any = {};
  if (empresaId) where.empresaId = empresaId;

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

  const recibos = await db.reciboNomina.findMany({
    where,
    include: { empleado: true },
    orderBy: { fecha: 'desc' },
  });

  const totalPercepciones = recibos.reduce((s, r) => s + r.totalPercepciones, 0);
  const totalDeducciones = recibos.reduce((s, r) => s + r.totalDeducciones, 0);
  const totalNeto = recibos.reduce((s, r) => s + r.neto, 0);
  const totalISR = recibos.reduce((s, r) => s + r.isr, 0);
  const totalIMSS = recibos.reduce((s, r) => s + r.imss, 0);

  // Resumen mensual del año
  const anioActual = anio ? parseInt(anio) : new Date().getFullYear();
  const inicioAnio = new Date(anioActual, 0, 1);
  const finAnio = new Date(anioActual, 11, 31, 23, 59, 59);

  const todosDelAnio = await db.reciboNomina.findMany({
    where: {
      ...(empresaId ? { empresaId } : {}),
      fecha: { gte: inicioAnio, lte: finAnio },
    },
    select: { fecha: true, neto: true, totalPercepciones: true, totalDeducciones: true, isr: true, imss: true },
  });

  const resumenMensual = [];
  for (let m = 1; m <= 12; m++) {
    const delMes = todosDelAnio.filter(r => new Date(r.fecha).getMonth() + 1 === m);
    resumenMensual.push({
      mes: m,
      count: delMes.length,
      totalPercepciones: delMes.reduce((s, r) => s + r.totalPercepciones, 0),
      totalDeducciones: delMes.reduce((s, r) => s + r.totalDeducciones, 0),
      totalNeto: delMes.reduce((s, r) => s + r.neto, 0),
      totalISR: delMes.reduce((s, r) => s + r.isr, 0),
      totalIMSS: delMes.reduce((s, r) => s + r.imss, 0),
    });
  }

  return NextResponse.json({
    recibos,
    count: recibos.length,
    totalPercepciones,
    totalDeducciones,
    totalNeto,
    totalISR,
    totalIMSS,
    resumenMensual,
  });
  } catch (error: any) {
    console.error('Error en src/app/api/nomina/route.ts:', error.message);
    return NextResponse.json({ recibos: [], count: 0, totalPercepciones: 0, totalDeducciones: 0, totalNeto: 0, totalISR: 0, totalIMSS: 0, resumenMensual: [] });
  }
}
