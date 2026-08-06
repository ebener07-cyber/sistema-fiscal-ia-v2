import { NextRequest, NextResponse } from 'next/server';
import { generarPolizasMes } from '@/lib/agentes/motor-contabilidad';

/**
 * POST /api/contabilidad/generar-automatico
 * Body: { empresaId, mes, anio }
 *
 * Genera automáticamente TODAS las pólizas contables del mes con partida doble:
 * - Facturas emitidas → póliza de ingreso (Cargo a Clientes, Abono a Ventas + IVA)
 * - Facturas recibidas → póliza de egreso (Cargo a Costos + IVA, Abono a Proveedores)
 * - Nómina → póliza de egreso (Cargo a Gastos nómina, Abono a Bancos + Pasivos)
 * - Movimientos bancarios sin factura → póliza de diario
 *
 * Borra pólizas existentes del mes antes de regenerar.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { empresaId, mes, anio } = body as {
      empresaId: string;
      mes: number;
      anio: number;
    };

    if (!empresaId) return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });
    if (!mes || !anio) return NextResponse.json({ error: 'mes y anio requeridos' }, { status: 400 });

    const resultado = await generarPolizasMes(empresaId, mes, anio);

    return NextResponse.json({
      success: true,
      message: `✅ ${resultado.polizasCreadas} pólizas generadas con partida doble para ${mes}/${anio}`,
      ...resultado,
    });
  } catch (e: any) {
    console.error('Error en generar-automatico:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
