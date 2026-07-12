import { NextResponse } from 'next/server';

export async function POST() {
  const response = NextResponse.json({ success: true, message: 'Sesión cerrada' });
  response.cookies.delete('auth-token');
  return response;
}
