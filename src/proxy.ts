import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicRoutes = ['/login', '/api/auth/login', '/api/auth/logout'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Permitir rutas públicas
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Permitir TODO lo de _next sin verificar token
  if (pathname.startsWith('/_next')) {
    return NextResponse.next();
  }

  // Permitir archivos estáticos
  if (pathname.startsWith('/favicon') || pathname.match(/\.(svg|png|jpg|ico|css|js|woff|woff2|ttf|eot)$/)) {
    return NextResponse.next();
  }

  // Para APIs, verificar token
  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    // NO redirigir páginas — dejar que el cliente maneje la auth
    // Solo las APIs están protegidas
    return NextResponse.next();
  }

  // Verificar expiración
  try {
    const decoded = atob(token);
    const payload = JSON.parse(decoded);
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Token expirado' }, { status: 401 });
      }
      return NextResponse.next();
    }
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|login|robots.txt).*)'],
};
