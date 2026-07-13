import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const publicRoutes = ['/login', '/api/auth/login', '/api/auth/logout'];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (publicRoutes.some(route => pathname.startsWith(route))) {
    return NextResponse.next();
  }

  // Permitir TODO lo de _next (JS, CSS, imágenes, etc)
  if (pathname.startsWith('/_next')) {
    return NextResponse.next();
  }

  // Permitir archivos estáticos públicos
  if (pathname === '/' || pathname.startsWith('/favicon') || pathname.match(/\.(svg|png|jpg|ico|css|js|woff|woff2|ttf|eot)$/)) {
    return NextResponse.next();
  }

  // Para APIs y páginas, verificar token
  const token = request.cookies.get('auth-token')?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const decoded = atob(token);
    const payload = JSON.parse(decoded);
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      if (pathname.startsWith('/api/')) {
        return NextResponse.json({ error: 'Token expirado' }, { status: 401 });
      }
      const loginUrl = new URL('/login', request.url);
      return NextResponse.redirect(loginUrl);
    }
  } catch {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Token inválido' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|login|robots.txt).*)'],
};
