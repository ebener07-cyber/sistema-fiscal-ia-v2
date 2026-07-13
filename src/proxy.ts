/**
 * Next.js 16 — proxy.ts (reemplaza middleware.ts)
 *
 * Solo protege rutas /api (excepto /api/auth/*).
 * Las páginas se protegen client-side (home-page.tsx redirige a /login si no hay auth).
 */

import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Solo intervenir en rutas API
  if (!pathname.startsWith('/api')) {
    return NextResponse.next();
  }

  // Permitir rutas públicas de auth
  if (pathname.startsWith('/api/auth/')) {
    return NextResponse.next();
  }

  // Verificar token en cookie httpOnly
  const token = request.cookies.get('token')?.value;
  if (!token) {
    return NextResponse.json(
      { error: 'No autenticado', code: 'NO_TOKEN' },
      { status: 401 }
    );
  }

  // Verificación básica (la validación completa se hace en cada route handler con verifyToken)
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString('utf-8'));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      return NextResponse.json(
        { error: 'Sesión expirada', code: 'TOKEN_EXPIRED' },
        { status: 401 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: 'Token inválido', code: 'INVALID_TOKEN' },
      { status: 401 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
