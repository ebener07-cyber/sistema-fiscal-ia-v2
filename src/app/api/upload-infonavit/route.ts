import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/**
 * POST /api/upload-infonavit
 * Carga un PDF del estado de cuenta INFONAVIT.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const mes = parseInt(formData.get('mes') as string);
    const anio = parseInt(formData.get('anio') as string);
    const empresaId = (formData.get('empresaId') as string) || '';

    if (!file) return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
    if (!mes || !anio) return NextResponse.json({ error: 'Falta mes o anio' }, { status: 400 });

    let empId = empresaId;
    if (!empId) {
      const primera = await db.empresa.findFirst();
      if (!primera) return NextResponse.json({ error: 'No hay empresas' }, { status: 400 });
      empId = primera.id;
    }

    const isVercel = !!process.env.VERCEL;
    const uploadBase = isVercel ? '/tmp' : process.cwd();
    const uploadDir = path.join(uploadBase, 'uploads', 'infonavit');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const fileName = `infonavit_${empId}_${anio}_${String(mes).padStart(2, '0')}.pdf`;
    const filePath = path.join(uploadDir, fileName);
    const bytes = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));

    return NextResponse.json({
      success: true,
      fileName,
      fileSize: file.size,
      mes,
      anio,
      message: `✅ PDF del INFONAVIT guardado para ${mes}/${anio}. El sistema calculará las aportaciones automáticamente basándose en los empleados activos.`,
    });
  } catch (e: any) {
    console.error('Error en upload-infonavit:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET() {
  const isVercel = !!process.env.VERCEL;
    const uploadBase = isVercel ? '/tmp' : process.cwd();
    const uploadDir = path.join(uploadBase, 'uploads', 'infonavit');
  if (!existsSync(uploadDir)) {
    return NextResponse.json({ archivos: [] });
  }
  const { readdir, stat } = await import('fs/promises');
  const files = await readdir(uploadDir);
  const archivos = await Promise.all(
    files.filter(f => f.endsWith('.pdf')).map(async name => {
      const s = await stat(path.join(uploadDir, name));
      const match = name.match(/infonavit_(.+)_(\d{4})_(\d{2})\.pdf/);
      return {
        name,
        size: s.size,
        fecha: s.mtime,
        empresaId: match?.[1] || '',
        anio: match?.[2] || '',
        mes: match?.[3] || '',
      };
    })
  );
  return NextResponse.json({ archivos });
}
