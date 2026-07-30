import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

function parsePositiveInt(value: string | null, fallback: number, max?: number) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return max ? Math.min(parsed, max) : parsed;
}

function parseOptionalInt(value: string | null) {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * GET /api/bancos?empresaId=xxx&mes=7&anio=2026&cuentaId=xxx&page=1&pageSize=50
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId') || undefined;
    const mes = parseOptionalInt(searchParams.get('mes'));
    const anio = parseOptionalInt(searchParams.get('anio'));
    const cuentaIdFiltro = searchParams.get('cuentaId');
    const page = parsePositiveInt(searchParams.get('page'), 1);
    const pageSize = parsePositiveInt(searchParams.get('pageSize'), 100, 500);

    if (mes !== null && (mes < 1 || mes > 12)) {
      return NextResponse.json({ error: 'El mes debe estar entre 1 y 12' }, { status: 400 });
    }
    if (mes !== null && anio === null) {
      return NextResponse.json({ error: 'Para filtrar por mes también debes enviar anio' }, { status: 400 });
    }
    if (anio !== null && (anio < 2020 || anio > new Date().getFullYear() + 1)) {
      return NextResponse.json({ error: 'El anio está fuera del rango permitido' }, { status: 400 });
    }

    // Cuentas
    const cuentas = await db.cuentaBancaria.findMany({
      where: empresaId ? { empresaId } : undefined,
      include: { _count: { select: { movimientos: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // Filtro movimientos
    const whereMov: any = {};
    if (empresaId) whereMov.cuenta = { empresaId };
    if (cuentaIdFiltro) whereMov.cuentaId = cuentaIdFiltro;

    if (mes && anio) {
      const inicioMes = new Date(anio, mes - 1, 1);
      const finMes = new Date(anio, mes, 0, 23, 59, 59);
      whereMov.fecha = { gte: inicioMes, lte: finMes };
    } else if (anio) {
      const inicioAnio = new Date(anio, 0, 1);
      const finAnio = new Date(anio, 11, 31, 23, 59, 59);
      whereMov.fecha = { gte: inicioAnio, lte: finAnio };
    }

    const whereIngresos = { ...whereMov, monto: { gt: 0 } };
    const whereEgresos  = { ...whereMov, monto: { lt: 0 } };

    const [movimientos, totalMovimientos, ingresosAgg, egresosAgg] = await Promise.all([
      db.movimientoBanco.findMany({
        where: whereMov,
        include: { cuenta: { select: { banco: true, cuenta: true } } },
        orderBy: { fecha: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.movimientoBanco.count({ where: whereMov }),
      db.movimientoBanco.aggregate({ where: whereIngresos, _sum: { monto: true } }),
      db.movimientoBanco.aggregate({ where: whereEgresos,  _sum: { monto: true } }),
    ]);

    const totalIngresos = ingresosAgg._sum.monto || 0;
    const totalEgresos  = Math.abs(egresosAgg._sum.monto || 0);

    return NextResponse.json({
      cuentas,
      movimientos,
      totalMovimientos,
      pagination: {
        page,
        pageSize,
        totalPages: Math.ceil(totalMovimientos / pageSize),
        hasNext: page * pageSize < totalMovimientos,
        hasPrev: page > 1,
      },
      resumen: {
        totalIngresos,
        totalEgresos,
        flujoNeto: totalIngresos - totalEgresos,
        countMovimientos: totalMovimientos,
      },
    });
  } catch (error: any) {
    console.error('Error en /api/bancos:', error.message);
    return NextResponse.json({
      cuentas: [],
      movimientos: [],
      totalMovimientos: 0,
      pagination: { page: 1, pageSize: 100, totalPages: 0, hasNext: false, hasPrev: false },
      resumen: { totalIngresos: 0, totalEgresos: 0, flujoNeto: 0, countMovimientos: 0 },
    });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { banco, cuenta, saldo, tipo, empresaId } = body;
    if (!banco || !cuenta) {
      return NextResponse.json({ error: 'Banco y cuenta son obligatorios' }, { status: 400 });
    }
    const cuentaBancaria = await db.cuentaBancaria.create({
      data: { banco, cuenta, saldo: saldo ?? 0, tipo: tipo || 'operaciones', empresaId },
    });
    return NextResponse.json(cuentaBancaria, { status: 201 });
  } catch (error: any) {
    console.error('Error POST /api/bancos:', error.message);
    return NextResponse.json({ error: 'Error al crear cuenta bancaria' }, { status: 500 });
  }
}
