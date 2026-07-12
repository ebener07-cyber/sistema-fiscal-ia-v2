import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, hashPassword } from '@/lib/auth';

/**
 * PATCH /api/admin/usuarios/[id] — actualizar usuario (cambiar rol, password, empresa)
 * DELETE /api/admin/usuarios/[id] — eliminar usuario
 *
 * Solo admin puede usar estas rutas.
 * No se puede eliminar a uno mismo ni cambiar el propio rol.
 */

async function verificarAdmin(req: NextRequest) {
  const token = req.cookies.get('auth-token')?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const usuario = await db.usuario.findUnique({
    where: { id: payload.sub },
    select: { id: true, email: true, nombre: true, rol: true },
  });
  if (!usuario || usuario.rol !== 'admin') return null;
  return usuario;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verificarAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 });
  }

  try {
    const { id } = await params;
    const body = await req.json();

    // No permitir que el admin se quite el rol a sí mismo
    if (id === admin.id && body.rol && body.rol !== 'admin') {
      return NextResponse.json({ error: 'No puedes cambiar tu propio rol de admin' }, { status: 400 });
    }

    const data: any = {};

    if (body.nombre) data.nombre = String(body.nombre).slice(0, 200);
    if (body.email) {
      // Verificar email único (excluyendo el actual)
      const existente = await db.usuario.findFirst({
        where: { email: body.email.toLowerCase().trim(), NOT: { id } },
      });
      if (existente) {
        return NextResponse.json({ error: 'Email ya en uso por otro usuario' }, { status: 409 });
      }
      data.email = body.email.toLowerCase().trim();
    }
    if (body.rol) {
      const rolesValidos = ['admin', 'contador', 'usuario', 'lectura'];
      if (!rolesValidos.includes(body.rol)) {
        return NextResponse.json({ error: 'Rol inválido' }, { status: 400 });
      }
      data.rol = body.rol;
    }
    if (body.empresaId !== undefined) {
      data.empresaId = body.empresaId || null;
    }
    if (body.password) {
      if (body.password.length < 6) {
        return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });
      }
      data.password = hashPassword(body.password);
    }

    const actualizado = await db.usuario.update({
      where: { id },
      data,
      select: { id: true, email: true, nombre: true, rol: true, empresaId: true },
    });

    return NextResponse.json({
      success: true,
      usuario: actualizado,
      message: `✅ Usuario "${actualizado.nombre}" actualizado`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const admin = await verificarAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: 'Acceso denegado' }, { status: 403 });
  }

  try {
    const { id } = await params;

    // No permitir que el admin se elimine a sí mismo
    if (id === admin.id) {
      return NextResponse.json({ error: 'No puedes eliminar tu propia cuenta de admin' }, { status: 400 });
    }

    const usuario = await db.usuario.findUnique({ where: { id } });
    if (!usuario) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }

    await db.usuario.delete({ where: { id } });

    return NextResponse.json({
      success: true,
      message: `✅ Usuario "${usuario.nombre}" eliminado`,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
