import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * POST /api/upload-estado-cuenta
 * Carga un estado de cuenta (PDF o CSV) y procesa los movimientos.
 *
 * Body (multipart/form-data):
 *   - file: archivo PDF o CSV
 *   - cuentaId: ID de la cuenta bancaria
 *   - mes: mes del estado (1-12)
 *   - anio: año del estado
 *
 * Por ahora solo procesa CSV (los PDF requieren biblioteca de parseo)
 * y guarda el archivo en el sistema de archivos.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const cuentaId = formData.get('cuentaId') as string;
    const mes = parseInt(formData.get('mes') as string);
    const anio = parseInt(formData.get('anio') as string);

    if (!file) {
      return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
    }
    if (!cuentaId) {
      return NextResponse.json({ error: 'Falta cuentaId' }, { status: 400 });
    }

    // Verificar que existe la cuenta
    const cuenta = await db.cuentaBancaria.findUnique({ where: { id: cuentaId } });
    if (!cuenta) {
      return NextResponse.json({ error: 'Cuenta bancaria no encontrada' }, { status: 404 });
    }

    // Guardar el archivo
    const isVercel = !!process.env.VERCEL;
    const uploadBase = isVercel ? '/tmp' : process.cwd();
    const uploadDir = path.join(uploadBase, 'uploads', 'estados-cuenta');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const fileName = `estado_${cuentaId}_${anio}_${String(mes).padStart(2, '0')}.${ext}`;
    const filePath = path.join(uploadDir, fileName);

    const bytes = await file.arrayBuffer();
    await writeFile(filePath, Buffer.from(bytes));

    // Si es CSV, parsear movimientos
    let movimientosCreados = 0;
    if (ext === 'csv') {
      const text = Buffer.from(bytes).toString('utf-8');
      const lineas = text.split('\n').filter(l => l.trim());

      // Detectar separador (coma o punto y coma o tab)
      const separador = lineas[0].includes(';') ? ';' : lineas[0].includes('\t') ? '\t' : ',';

      // Asumir formato: fecha, concepto, monto (puede haber header)
      let empezarDesde = 0;
      if (lineas[0].toLowerCase().includes('fecha') || lineas[0].toLowerCase().includes('date')) {
        empezarDesde = 1;
      }

      for (let i = empezarDesde; i < lineas.length; i++) {
        const partes = lineas[i].split(separador).map(p => p.trim().replace(/"/g, ''));
        if (partes.length < 3) continue;

        try {
          // Intentar parsear fecha (formato DD/MM/YYYY o YYYY-MM-DD)
          let fecha: Date;
          const fechaStr = partes[0];
          if (fechaStr.match(/^\d{4}-\d{2}-\d{2}/)) {
            fecha = new Date(fechaStr);
          } else if (fechaStr.match(/^\d{1,2}\/\d{1,2}\/\d{4}/)) {
            const [dia, mes, anio] = fechaStr.split('/');
            fecha = new Date(parseInt(anio), parseInt(mes) - 1, parseInt(dia));
          } else {
            continue;
          }

          // Buscar la columna de monto (puede estar en posición 2 o 3 o 4)
          let monto = 0;
          let concepto = partes[1] || 'Movimiento';
          for (let j = 2; j < partes.length; j++) {
            const valor = partes[j].replace(/[$,\s]/g, '').replace(',', '.');
            const parsed = parseFloat(valor);
            if (!isNaN(parsed) && parsed !== 0) {
              monto = parsed;
              // Si hay columna siguiente, también es concepto
              if (partes[j + 1]) concepto = `${concepto} ${partes[j + 1]}`.trim();
              break;
            }
          }

          if (monto === 0) continue;

          // Verificar si ya existe (deduplicar por fecha + concepto + monto)
          const existente = await db.movimientoBanco.findFirst({
            where: {
              cuentaId,
              fecha,
              concepto,
              monto,
            },
          });
          if (existente) continue;

          await db.movimientoBanco.create({
            data: {
              fecha,
              concepto,
              monto,
              tipo: monto > 0 ? 'ingreso' : 'egreso',
              estado: 'conciliado',
              cuentaId,
            },
          });
          movimientosCreados++;
        } catch (e) {
          // saltar línea inválida
          continue;
        }
      }
    }

    // Actualizar saldo de la cuenta con los movimientos del mes
    const inicioMes = new Date(anio, mes - 1, 1);
    const finMes = new Date(anio, mes, 0, 23, 59, 59);
    const movimientosMes = await db.movimientoBanco.findMany({
      where: { cuentaId, fecha: { gte: inicioMes, lte: finMes } },
    });
    const saldoCalculado = movimientosMes.reduce((s, m) => s + m.monto, 0);

    return NextResponse.json({
      success: true,
      fileName,
      fileSize: file.size,
      movimientosCreados,
      movimientosTotales: movimientosMes.length,
      saldoDelMes: saldoCalculado,
      message: `✅ Estado de cuenta procesado. ${movimientosCreados} movimientos nuevos importados.`,
    });
  } catch (e: any) {
    console.error('Error en upload-estado-cuenta:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

/** GET /api/upload-estado-cuenta — lista estados de cuenta guardados */
export async function GET() {
  const isVercel = !!process.env.VERCEL;
    const uploadBase = isVercel ? '/tmp' : process.cwd();
    const uploadDir = path.join(uploadBase, 'uploads', 'estados-cuenta');
  if (!existsSync(uploadDir)) {
    return NextResponse.json({ archivos: [] });
  }
  const { readdir } = await import('fs/promises');
  const files = await readdir(uploadDir);
  const archivos = files.map(name => {
    const match = name.match(/estado_(.+)_(\d{4})_(\d{2})\.(.+)/);
    return {
      name,
      cuentaId: match?.[1] || '',
      anio: match?.[2] || '',
      mes: match?.[3] || '',
      ext: match?.[4] || '',
    };
  });
  return NextResponse.json({ archivos });
}
