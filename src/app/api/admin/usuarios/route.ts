import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyToken, hashPassword } from '@/lib/auth';

/**
 * APIs de administración de usuarios — SOLO admin
 *
 * GET /api/admin/usuarios — lista todos los usuarios
 * POST /api/admin/usuarios — crea nuevo usuario
 *
 * Todas las peticiones verifican que el usuario logueado sea admin.
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

/** GET — lista todos los usuarios */
export async function GET(req: NextRequest) {
  const admin = await verificarAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: 'Acceso denegado. Solo administradores.' }, { status: 403 });
  }

  const usuarios = await db.usuario.findMany({
    select: {
      id: true,
      email: true,
      nombre: true,
      rol: true,
      empresaId: true,
      empresa: { select: { id: true, nombre: true, rfc: true } },
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return NextResponse.json({ usuarios, admin: { id: admin.id, nombre: admin.nombre } });
}

/** POST — crea nuevo usuario */
export async function POST(req: NextRequest) {
  const admin = await verificarAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: 'Acceso denegado. Solo administradores.' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { nombre, email, password, rol, empresaId } = body;

    if (!nombre || !email || !password) {
      return NextResponse.json({ error: 'Nombre, email y password son obligatorios' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ error: 'La contraseña debe tener al menos 6 caracteres' }, { status: 400 });
    }

    // Verificar email único
    const existente = await db.usuario.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existente) {
      return NextResponse.json({ error: `Ya existe un usuario con email ${email}` }, { status: 409 });
    }

    // Roles válidos
    const rolesValidos = ['admin', 'contador', 'usuario', 'lectura'];
    const rolFinal = rolesValidos.includes(rol) ? rol : 'usuario';

    const nuevoUsuario = await db.usuario.create({
      data: {
        nombre: String(nombre).slice(0, 200),
        email: email.toLowerCase().trim(),
        password: hashPassword(password),
        rol: rolFinal,
        empresaId: empresaId || null,
      },
      select: {
        id: true, email: true, nombre: true, rol: true, empresaId: true, createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      usuario: nuevoUsuario,
      message: `✅ Usuario "${nuevoUsuario.nombre}" creado con rol ${rolFinal}`,
    }, { status: 201 });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
