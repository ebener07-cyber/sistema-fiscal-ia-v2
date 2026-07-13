import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/proyectos?empresaId=xxx&estado=activo
 * Lista todos los proyectos de la empresa, con totales de facturas agrupadas.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const empresaId = searchParams.get('empresaId') || undefined;
    const estado = searchParams.get('estado') || undefined;

    const proyectos = await db.proyecto.findMany({
      where: {
        ...(empresaId ? { empresaId } : {}),
        ...(estado ? { estado } : {}),
      },
      include: {
        cliente: { select: { id: true, nombre: true, rfc: true } },
        _count: { select: { facturas: true } },
        facturas: {
          select: {
            id: true,
            folio: true,
            fecha: true,
            total: true,
            subtotal: true,
            totalImpuestos: true,
            tipoComprobante: true,
            direccion: true,
            concepto: true,
            receptorNombre: true,
            emisorNombre: true,
            estado: true,
          },
          orderBy: { fecha: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calcular totales por proyecto
    const proyectosConTotales = proyectos.map((p) => {
      const facturasEmitidas = p.facturas.filter((f) => f.direccion === 'emitida' && f.tipoComprobante === 'I');
      const facturasRecibidas = p.facturas.filter((f) => f.direccion === 'recibida' && f.tipoComprobante === 'I');
      const notasCreditoEmitidas = p.facturas.filter((f) => f.direccion === 'emitida' && f.tipoComprobante === 'E');
      const notasCreditoRecibidas = p.facturas.filter((f) => f.direccion === 'recibida' && f.tipoComprobante === 'E');

      const totalEmitido = facturasEmitidas.reduce((s, f) => s + f.total, 0);
      const totalRecibido = facturasRecibidas.reduce((s, f) => s + f.total, 0);
      const totalNotasCreditoE = notasCreditoEmitidas.reduce((s, f) => s + f.total, 0);
      const totalNotasCreditoR = notasCreditoRecibidas.reduce((s, f) => s + f.total, 0);

      const ivaEmitido = facturasEmitidas.reduce((s, f) => s + f.totalImpuestos, 0);
      const ivaRecibido = facturasRecibidas.reduce((s, f) => s + f.totalImpuestos, 0);

      const utilidad = totalEmitido - totalRecibido - totalNotasCreditoE + totalNotasCreditoR;
      const margen = totalEmitido > 0 ? (utilidad / totalEmitido) * 100 : 0;
      const restantePresupuesto = p.presupuesto - totalEmitido;
      const porcentajePresupuesto = p.presupuesto > 0 ? (totalEmitido / p.presupuesto) * 100 : 0;

      return {
        ...p,
        totales: {
          countFacturas: p.facturas.length,
          countEmitidas: facturasEmitidas.length,
          countRecibidas: facturasRecibidas.length,
          countNotasCreditoE: notasCreditoEmitidas.length,
          countNotasCreditoR: notasCreditoRecibidas.length,
          totalEmitido,
          totalRecibido,
          totalNotasCreditoE,
          totalNotasCreditoR,
          ivaEmitido,
          ivaRecibido,
          utilidad,
          margen,
          restantePresupuesto,
          porcentajePresupuesto,
        },
      };
    });

    return NextResponse.json({ proyectos: proyectosConTotales });
  } catch (error: any) {
    console.error('Error en /api/proyectos GET:', error.message);
    return NextResponse.json({ proyectos: [] });
  }
}

/**
 * POST /api/proyectos
 * Crea un nuevo proyecto.
 * Body: { nombre, codigo?, descripcion?, clienteId?, presupuesto?, fechaInicio?, fechaFin?, empresaId }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nombre, codigo, descripcion, clienteId, presupuesto, fechaInicio, fechaFin, empresaId } = body;

    if (!nombre || !empresaId) {
      return NextResponse.json(
        { error: 'Nombre y empresaId son obligatorios' },
        { status: 400 }
      );
    }

    // Verificar que el código no exista ya en la empresa
    if (codigo) {
      const existente = await db.proyecto.findFirst({
        where: { empresaId, codigo: { equals: codigo, mode: 'insensitive' } },
      });
      if (existente) {
        return NextResponse.json(
          { error: `Ya existe un proyecto con código ${codigo}` },
          { status: 409 }
        );
      }
    }

    const proyecto = await db.proyecto.create({
      data: {
        nombre: String(nombre).slice(0, 200),
        codigo: codigo || null,
        descripcion: descripcion || null,
        clienteId: clienteId || null,
        presupuesto: parseFloat(presupuesto) || 0,
        fechaInicio: fechaInicio ? new Date(fechaInicio) : null,
        fechaFin: fechaFin ? new Date(fechaFin) : null,
        estado: 'activo',
        empresaId: String(empresaId),
      },
      include: {
        cliente: { select: { id: true, nombre: true, rfc: true } },
      },
    });

    return NextResponse.json(proyecto, { status: 201 });
  } catch (e: any) {
    console.error('Error en /api/proyectos POST:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
