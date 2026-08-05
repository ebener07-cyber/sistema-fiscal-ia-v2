import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * GET /api/bancos?empresaId=xxx&mes=7&anio=2026&cuentaId=xxx&page=1&pageSize=50
 *
 * Devuelve:
 *   - cuentas: lista de cuentas bancarias con saldo y count de movimientos
 *   - movimientos: movimientos del mes/año seleccionado (o todos si no hay filtro)
 *   - resumen: totales de ingresos, egresos y saldo del periodo
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId') || undefined;
    const mes = searchParams.get('mes');
    const anio = searchParams.get('anio');
    const cuentaIdFiltro = searchParams.get('cuentaId');
    const all = searchParams.get('all') === 'true';
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1'));
    const pageSize = Math.min(Math.max(1, parseInt(searchParams.get('pageSize') ?? '100')), 1000);

    // ===== Cuentas =====
    const cuentas = await db.cuentaBancaria.findMany({
      where: empresaId ? { empresaId } : undefined,
      include: { _count: { select: { movimientos: true } } },
      orderBy: { createdAt: 'asc' },
    });

    // ===== Movimientos con filtro opcional de mes/año =====
    const whereMov: any = {};
    if (empresaId) whereMov.cuenta = { empresaId };
    if (cuentaIdFiltro) whereMov.cuentaId = cuentaIdFiltro;

    if (mes && anio && parseInt(mes) > 0) {
      const inicioMes = new Date(parseInt(anio), parseInt(mes) - 1, 1);
      const finMes = new Date(parseInt(anio), parseInt(mes), 0, 23, 59, 59);
      whereMov.fecha = { gte: inicioMes, lte: finMes };
    } else if (anio) {
      const inicioAnio = new Date(parseInt(anio), 0, 1);
      const finAnio = new Date(parseInt(anio), 11, 31, 23, 59, 59);
      whereMov.fecha = { gte: inicioAnio, lte: finAnio };
    }

    const findOptions: any = {
      where: whereMov,
      include: { cuenta: { select: { banco: true, cuenta: true, tipo: true } } },
      orderBy: { fecha: 'desc' as const },
    };
    if (!all) {
      findOptions.skip = (page - 1) * pageSize;
      findOptions.take = pageSize;
    }

    const [movimientos, totalMovimientos] = await Promise.all([
      db.movimientoBanco.findMany(findOptions),
      db.movimientoBanco.count({ where: whereMov }),
    ]);

    // ===== Resumen del periodo =====
    const totalIngresos = movimientos
      .filter(m => m.monto > 0)
      .reduce((s, m) => s + m.monto, 0);
    const totalEgresos = movimientos
      .filter(m => m.monto < 0)
      .reduce((s, m) => s + Math.abs(m.monto), 0);

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
        countMovimientos: movimientos.length,
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
      data: {
        banco: String(banco),
        cuenta: String(cuenta),
        saldo: parseFloat(saldo) || 0,
        tipo: tipo || 'operaciones',
        empresaId: empresaId || '',
      },
    });

    return NextResponse.json(cuentaBancaria, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/**
 * DELETE /api/bancos?id={cuentaId}
 *
 * Elimina una cuenta bancaria y TODOS sus movimientos asociados en cascada,
 * usando una transacción Prisma para garantizar consistencia.
 *
 * Devuelve: { success: true, message: 'Cuenta eliminada con N movimientos' }
 */
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Falta el parámetro id de la cuenta bancaria' },
        { status: 400 }
      );
    }

    // Verificar que la cuenta exista antes de intentar borrar
    const cuenta = await db.cuentaBancaria.findUnique({
      where: { id },
      select: { id: true, banco: true, cuenta: true, _count: { select: { movimientos: true } } },
    });

    if (!cuenta) {
      return NextResponse.json(
        { error: 'La cuenta bancaria no existe' },
        { status: 404 }
      );
    }

    const totalMovimientos = cuenta._count.movimientos;

    // Transacción: borrar movimientos primero (por FK) y luego la cuenta
    await db.$transaction([
      db.movimientoBanco.deleteMany({ where: { cuentaId: id } }),
      db.cuentaBancaria.delete({ where: { id } }),
    ]);

    return NextResponse.json({
      success: true,
      message: `Cuenta eliminada con ${totalMovimientos} movimientos`,
      data: {
        id,
        banco: cuenta.banco,
        cuenta: cuenta.cuenta,
        movimientosEliminados: totalMovimientos,
      },
    });
  } catch (error: any) {
    console.error('Error en DELETE /api/bancos:', error.message);
    return NextResponse.json(
      { error: error.message || 'Error al eliminar la cuenta bancaria' },
      { status: 500 }
    );
  }
}
