import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/**
 * POST /api/upload-imss
 * Carga un PDF del estado de cuenta IMSS (determinación de cuotas).
 * Guarda el PDF y extrae datos básicos si puede.
 *
 * Body (multipart/form-data):
 *   - file: PDF del IMSS
 *   - mes: mes (1-12)
 *   - anio: año
 *   - empresaId: opcional
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

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
    }
    if (!mes || !anio) {
      return NextResponse.json({ error: 'Falta mes o anio' }, { status: 400 });
    }

    let empId = empresaId;
    if (!empId) {
      const primera = await db.empresa.findFirst();
      if (!primera) return NextResponse.json({ error: 'No hay empresas' }, { status: 400 });
      empId = primera.id;
    }

    const isVercel = !!process.env.VERCEL;
    const uploadBase = isVercel ? '/tmp' : process.cwd();
    const uploadDir = path.join(uploadBase, 'uploads', 'imss');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const fileName = `imss_${empId}_${anio}_${String(mes).padStart(2, '0')}.pdf`;
    const filePath = path.join(uploadDir, fileName);
    const bytes = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));

    // Intentar extraer texto del PDF (sin librería por ahora — solo guardarlo)
    // En producción se puede usar pdf-parse o pdf2json

    return NextResponse.json({
      success: true,
      fileName,
      fileSize: file.size,
      mes,
      anio,
      message: `✅ PDF del IMSS guardado para ${mes}/${anio}. El sistema calculará las cuotas automáticamente basándose en los empleados activos.`,
    });
  } catch (e: any) {
    console.error('Error en upload-imss:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** GET /api/upload-imss — lista PDFs guardados */
export async function GET() {
  const isVercel = !!process.env.VERCEL;
    const uploadBase = isVercel ? '/tmp' : process.cwd();
    const uploadDir = path.join(uploadBase, 'uploads', 'imss');
  if (!existsSync(uploadDir)) {
    return NextResponse.json({ archivos: [] });
  }
  const { readdir, stat } = await import('fs/promises');
  const files = await readdir(uploadDir);
  const archivos = await Promise.all(
    files.filter(f => f.endsWith('.pdf')).map(async name => {
      const s = await stat(path.join(uploadDir, name));
      const match = name.match(/imss_(.+)_(\d{4})_(\d{2})\.pdf/);
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
