import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ cuentaId: string }> }
) {
  try {
    const { cuentaId } = await params;
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get("empresaId") || undefined;
    const anio = parseInt(searchParams.get("anio") || new Date().getFullYear().toString());

    const cuenta = await db.cuentaBancaria.findFirst({
      where: { id: cuentaId, ...(empresaId ? { empresaId } : {}) },
    });
    if (!cuenta) {
      return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
    }

    const movimientos = await db.movimientoBanco.findMany({
      where: {
        cuentaId,
        fecha: {
          gte: new Date(`${anio}-01-01`),
          lte: new Date(`${anio}-12-31T23:59:59.999Z`),
        },
      },
      orderBy: { fecha: "asc" },
      include: {
        conciliacion: {
          include: {
            factura: {
              select: {
                id: true, folio: true, total: true, uuid: true,
                receptorNombre: true, emisorNombre: true, direccion: true,
              },
            },
          },
        },
      },
    });

    const mesesNombres = [
      "Enero","Febrero","Marzo","Abril","Mayo","Junio",
      "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre",
    ];

    const porMes = Array.from({ length: 12 }, (_, i) => ({
      mesIndex: i, mes: mesesNombres[i],
      movimientos: [] as typeof movimientos,
      totalIngresos: 0, totalEgresos: 0,
      saldoInicial: 0, saldoFinal: 0,
      conciliados: 0, pendientes: 0,
    }));

    // Saldo inicial = saldo actual + movimientos previos al año (restando)
    const movimientosPrevios = await db.movimientoBanco.findMany({
      where: { cuentaId, fecha: { lt: new Date(`${anio}-01-01`) } },
    });
    const saldoInicialAnio = movimientosPrevios.reduce((acc, m) => {
      return acc + (m.tipo === "ingreso" ? m.monto : m.tipo === "egreso" ? -m.monto : 0);
    }, cuenta.saldo);

    let saldoCorriente = saldoInicialAnio;

    for (const mov of movimientos) {
      const mesIdx = new Date(mov.fecha).getMonth();
      porMes[mesIdx].movimientos.push(mov);
      if (mov.tipo === "ingreso") {
        porMes[mesIdx].totalIngresos += mov.monto;
        saldoCorriente += mov.monto;
      } else if (mov.tipo === "egreso") {
        porMes[mesIdx].totalEgresos += mov.monto;
        saldoCorriente -= mov.monto;
      }
      if (mov.conciliacion) {
        porMes[mesIdx].conciliados += 1;
      } else {
        porMes[mesIdx].pendientes += 1;
      }
    }

    let runningSaldo = saldoInicialAnio;
    for (let i = 0; i < 12; i++) {
      porMes[i].saldoInicial = runningSaldo;
      runningSaldo += porMes[i].totalIngresos - porMes[i].totalEgresos;
      porMes[i].saldoFinal = runningSaldo;
    }

    const resumenAnual = {
      anio, saldoInicial: saldoInicialAnio, saldoFinal: runningSaldo,
      totalIngresos: porMes.reduce((a, m) => a + m.totalIngresos, 0),
      totalEgresos: porMes.reduce((a, m) => a + m.totalEgresos, 0),
      totalMovimientos: movimientos.length,
      totalConciliados: movimientos.filter(m => m.conciliacion).length,
      totalPendientes: movimientos.filter(m => !m.conciliacion).length,
    };

    return NextResponse.json({
      cuenta: {
        id: cuenta.id, banco: cuenta.banco, cuenta: cuenta.cuenta,
        tipo: cuenta.tipo, saldoActual: cuenta.saldo,
      },
      resumenAnual,
      meses: porMes.filter(m => m.movimientos.length > 0 || m.mesIndex <= new Date().getMonth()),
    });
  } catch (error: any) {
    console.error("Error estados-cuenta:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
