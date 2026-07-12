import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createToken } from '@/lib/auth';

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Autentica al usuario y devuelve un token en cookie.
 */

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: 'Email y password son obligatorios' }, { status: 400 });
    }

    const usuario = await db.usuario.findUnique({
      where: { email: email.toLowerCase().trim() },
      include: { empresa: true },
    });

    if (!usuario) {
      return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 404 });
    }

    // Verificar password (base64 simple — en producción usar bcrypt)
    const passwordHash = Buffer.from(password).toString('base64');
    if (usuario.password !== passwordHash) {
      return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 });
    }

    // Crear token
    const token = createToken(usuario.id, usuario.email);

    const response = NextResponse.json({
      success: true,
      usuario: {
        id: usuario.id,
        email: usuario.email,
        nombre: usuario.nombre,
        rol: usuario.rol,
        empresaId: usuario.empresaId,
        empresa: usuario.empresa ? { id: usuario.empresa.id, nombre: usuario.empresa.nombre, rfc: usuario.empresa.rfc } : null,
      },
    });

    // Cookie httpOnly con el token (7 días)
    response.cookies.set('auth-token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 días
      path: '/',
    });

    return response;
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
