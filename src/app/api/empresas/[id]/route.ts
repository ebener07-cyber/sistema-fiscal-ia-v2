import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * DELETE /api/empresas/[id]
 * Elimina una empresa. Verifica que no tenga registros asociados
 * o ofrece eliminar en cascada con ?force=true
 *
 * PATCH /api/empresas/[id]
 * Actualiza datos de la empresa
 */

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const force = searchParams.get('force') === 'true';

    const empresa = await db.empresa.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            clientes: true, proveedores: true, facturas: true,
            empleados: true, usuarios: true, cuentas: true, productos: true,
          },
        },
      },
    });

    if (!empresa) {
      return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 });
    }

    // Si tiene registros asociados y no es force, advertir
    const totalAsociados = empresa._count.clientes + empresa._count.proveedores +
      empresa._count.facturas + empresa._count.empleados + empresa._count.cuentas +
      empresa._count.productos;

    if (totalAsociados > 0 && !force) {
      return NextResponse.json({
        error: `La empresa tiene ${totalAsociados} registro(s) asociado(s) (${empresa._count.facturas} facturas, ${empresa._count.clientes} clientes, ${empresa._count.empleados} empleados, etc.). Usa force=true para eliminar todo en cascada.`,
        totalAsociados,
        detalle: empresa._count,
        needsForce: true,
      }, { status: 409 });
    }

    // Eliminar en cascada (force=true)
    // Orden importa por las foreign keys
    await db.movimientoBanco.deleteMany({
      where: { cuenta: { empresaId: id } },
    });
    await db.cuentaBancaria.deleteMany({ where: { empresaId: id } });
    await db.ordenCompra.deleteMany({ where: { empresaId: id } });
    await db.reciboNomina.deleteMany({ where: { empresaId: id } });
    await db.oportunidad.deleteMany({ where: { cliente: { empresaId: id } } });
    await db.factura.deleteMany({ where: { empresaId: id } });
    await db.producto.deleteMany({ where: { empresaId: id } });
    await db.empleado.deleteMany({ where: { empresaId: id } });
    await db.cliente.deleteMany({ where: { empresaId: id } });
    await db.proveedor.deleteMany({ where: { empresaId: id } });
    // Desvincular usuarios (no eliminarlos, solo quitar empresaId)
    await db.usuario.updateMany({
      where: { empresaId: id },
      data: { empresaId: null },
    });
    // Finalmente eliminar la empresa
    await db.empresa.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: `✅ Empresa "${empresa.nombre}" eliminada correctamente${totalAsociados > 0 ? ` junto con ${totalAsociados} registro(s) asociado(s)` : ''}`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const data: any = {};

    if (body.nombre) data.nombre = String(body.nombre).slice(0, 200);
    if (body.regimenFiscal !== undefined) data.regimenFiscal = body.regimenFiscal;
    if (body.email !== undefined) data.email = body.email;
    if (body.telefono !== undefined) data.telefono = body.telefono;
    if (body.direccion !== undefined) data.direccion = body.direccion;
    if (body.status) data.status = body.status;

    const actualizada = await db.empresa.update({ where: { id }, data });
    return NextResponse.json(actualizada);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
