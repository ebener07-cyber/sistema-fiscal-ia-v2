import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// POST /api/bancos/conciliar
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { movimientoId, facturaId, tipoDocumento = "factura", observaciones = "" } = body;

    if (!movimientoId) {
      return NextResponse.json({ error: "movimientoId requerido" }, { status: 400 });
    }

    const movimiento = await db.movimientoBanco.findUnique({
      where: { id: movimientoId },
      include: { cuenta: true },
    });
    if (!movimiento) {
      return NextResponse.json({ error: "Movimiento no encontrado" }, { status: 404 });
    }

    let montoConciliado = Math.abs(movimiento.monto);
    let diferencia = 0;

    if (facturaId) {
      const factura = await db.factura.findUnique({ where: { id: facturaId } });
      if (!factura) {
        return NextResponse.json({ error: "Factura no encontrada" }, { status: 404 });
      }
      diferencia = Math.abs(Math.abs(movimiento.monto) - factura.total);
    }

    let estado = "conciliado";
    if (diferencia > 1) estado = "discrepancia";

    const conciliacion = await db.conciliacionBancaria.upsert({
      where: { movimientoId },
      create: {
        movimientoId, facturaId: facturaId || null, tipoDocumento,
        montoConciliado, diferencia, observaciones, estado,
      },
      update: {
        facturaId: facturaId || null, tipoDocumento,
        montoConciliado, diferencia, observaciones, estado,
        conciliadoEn: new Date(),
      },
    });

    await db.movimientoBanco.update({
      where: { id: movimientoId },
      data: { estado: estado === "conciliado" ? "conciliado" : "revision" },
    });

    return NextResponse.json({
      success: true, conciliacion,
      mensaje: estado === "conciliado"
        ? "Conciliación exitosa"
        : `Conciliación con discrepancia de $${diferencia.toFixed(2)}`,
    });
  } catch (error: any) {
    console.error("Error conciliar:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/bancos/conciliar?movimientoId=xxx
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const movimientoId = searchParams.get("movimientoId");
    if (!movimientoId) {
      return NextResponse.json({ error: "movimientoId requerido" }, { status: 400 });
    }
    await db.conciliacionBancaria.deleteMany({ where: { movimientoId } });
    await db.movimientoBanco.update({
      where: { id: movimientoId },
      data: { estado: "pendiente" },
    });
    return NextResponse.json({ success: true, mensaje: "Desconciliación exitosa" });
  } catch (error: any) {
    console.error("Error desconciliar:", error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
