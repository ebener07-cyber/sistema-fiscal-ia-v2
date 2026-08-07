import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/**
 * POST /api/proyectos/upload-contrato
 *
 * Sube un PDF de contrato y extrae automáticamente:
 * - Monto del contrato
 * - Nombre del cliente
 * - RFC del cliente
 * - Fecha del contrato
 * - Ubicación de la obra
 * - Tipo de obra
 * - Plazo en días
 * - Anticipo %
 *
 * Crea o actualiza el proyecto con estos datos.
 *
 * Body (multipart/form-data):
 *   - file: PDF del contrato
 *   - empresaId: ID de la empresa
 *   - proyectoId: ID del proyecto existente (opcional, si no se crea uno nuevo)
 *   - nombreProyecto: Nombre del proyecto (si se crea nuevo)
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DatosContrato {
  monto?: number;
  moneda?: string;
  fecha?: Date;
  contratista?: string;
  clienteNombre?: string;
  clienteRfc?: string;
  ubicacion?: string;
  tipoObra?: string;
  alcance?: string;
  plazoDias?: number;
  anticipoPct?: number;
}

function extraerDatosContrato(texto: string): DatosContrato {
  const datos: DatosContrato = {};
  const textoUpper = texto.toUpperCase();

  // === MONTO DEL CONTRATO ===
  // Buscar patrones como: "$1,234,567.89", "MONTO TOTAL: $500,000.00", "cantidad de $100,000"
  const patronesMonto = [
    /(?:MONTO\s+TOTAL|IMPORTE\s+TOTAL|CANTIDAD\s+TOTAL|VALOR\s+DEL\s+CONTRATO|MONTO\s+DEL\s+CONTRATO)[:\s]*\$?([\d,]+\.?\d*)/i,
    /(?:MONTO|IMPORTE|CANTIDAD|VALOR)[:\s]*\$?([\d,]+\.\d{2})/i,
    /\$\s*([\d,]+\.\d{2})/,
  ];
  for (const patron of patronesMonto) {
    const match = texto.match(patron);
    if (match) {
      const monto = parseFloat(match[1].replace(/,/g, ''));
      if (monto > 1000) { // Solo montos significativos
        datos.monto = monto;
        break;
      }
    }
  }

  // === MONEDA ===
  if (textoUpper.includes('PESOS') || textoUpper.includes('MXN') || textoUpper.includes('MONEDA NACIONAL')) {
    datos.moneda = 'MXN';
  } else if (textoUpper.includes('DOLARES') || textoUpper.includes('USD') || textoUpper.includes('DÓLARES')) {
    datos.moneda = 'USD';
  } else {
    datos.moneda = 'MXN';
  }

  // === RFC ===
  // Buscar RFC persona moral (3 letras + 6 dígitos + 3 alfanuméricos) o persona física
  const rfcMoral = texto.match(/\b([A-ZÑ&]{3}\d{6}[A-Z0-9]{3})\b/);
  const rfcFisica = texto.match(/\b([A-ZÑ&]{4}\d{6}[A-Z0-9]{3})\b/);
  if (rfcMoral) datos.clienteRfc = rfcMoral[1];
  else if (rfcFisica) datos.clienteRfc = rfcFisica[1];

  // === FECHA DEL CONTRATO ===
  // Buscar patrones: "DD de MES de YYYY", "DD/MM/YYYY", "DD-MM-YYYY"
  const meses = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
  const fechaTexto = texto.match(/(\d{1,2})\s+de\s+([A-Za-zÁÉÍÓÚáéíóú]+)\s+de\s+(\d{4})/i);
  if (fechaTexto) {
    const dia = parseInt(fechaTexto[1]);
    const mesStr = fechaTexto[2].toUpperCase();
    const mes = meses.findIndex(m => mesStr.includes(m.slice(0, 5)));
    const anio = parseInt(fechaTexto[3]);
    if (mes >= 0) {
      datos.fecha = new Date(anio, mes, dia, 12, 0, 0);
    }
  }
  if (!datos.fecha) {
    const fechaNum = texto.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
    if (fechaNum) {
      datos.fecha = new Date(parseInt(fechaNum[3]), parseInt(fechaNum[2]) - 1, parseInt(fechaNum[1]), 12, 0, 0);
    }
  }

  // === NOMBRE DEL CLIENTE ===
  // Buscar después de "CLIENTE:", "EL CLIENTE:", "CONTRATANTE:"
  const clienteMatch = texto.match(/(?:CLIENTE|CONTRATANTE|COMITENTE)[:\s]*\n?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,&\.]{5,80})/i);
  if (clienteMatch) {
    datos.clienteNombre = clienteMatch[1].trim().slice(0, 100);
  }

  // === UBICACIÓN ===
  const ubicacionMatch = texto.match(/(?:UBICACIÓN|UBICACION|DOMICILIO|DIRECCIÓN|DIRECCION)[:\s]*\n?\s*([A-ZÁÉÍÓÚÑ0-9\s#,.]{10,100})/i);
  if (ubicacionMatch) {
    datos.ubicacion = ubicacionMatch[1].trim().slice(0, 200);
  }

  // === TIPO DE OBRA ===
  const tiposObra = ['ELECTRIC', 'ELECTROMECAN', 'CONSTRUCTORA', 'CONSTRUCCION', 'INSTALACION', 'INSTALACIÓN', 'MANTENIMIENTO', 'OBRA', 'SERVICIO'];
  for (const tipo of tiposObra) {
    if (textoUpper.includes(tipo)) {
      datos.tipoObra = tipo.charAt(0) + tipo.slice(1).toLowerCase();
      break;
    }
  }

  // === PLAZO EN DÍAS ===
  const plazoMatch = texto.match(/(?:PLAZO|DURACIÓN|DURACION)[:\s]*(\d+)\s*(?:DÍAS|DIAS|DAYS)/i);
  if (plazoMatch) {
    datos.plazoDias = parseInt(plazoMatch[1]);
  }

  // === ANTICIPO ===
  const anticipoMatch = texto.match(/(?:ANTICIPO)[:\s]*(\d+(?:\.\d+)?)\s*%/i);
  if (anticipoMatch) {
    datos.anticipoPct = parseFloat(anticipoMatch[1]);
  }

  // === CONTRATISTA ===
  const contratistaMatch = texto.match(/(?:CONTRATISTA|PRESTADOR)[:\s]*\n?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s,&\.]{5,80})/i);
  if (contratistaMatch) {
    datos.contratista = contratistaMatch[1].trim().slice(0, 100);
  }

  // === ALCANCE ===
  const alcanceMatch = texto.match(/(?:ALCANCE|OBJETO|DESCRIPCIÓN|DESCRIPCION)[:\s]*\n?\s*([A-ZÁÉÍÓÚÑa-z0-9\s,.\(\)áéíóú]{20,500})/i);
  if (alcanceMatch) {
    datos.alcance = alcanceMatch[1].trim().slice(0, 500);
  }

  return datos;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const empresaId = formData.get('empresaId') as string;
    const proyectoId = formData.get('proyectoId') as string;
    const nombreProyecto = formData.get('nombreProyecto') as string;

    if (!file) return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });
    if (!empresaId) return NextResponse.json({ error: 'Falta empresaId' }, { status: 400 });

    // Guardar PDF
    const isVercel = !!process.env.VERCEL;
    const uploadBase = isVercel ? '/tmp' : process.cwd();
    const uploadDir = path.join(uploadBase, 'uploads', 'contratos');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    const fileName = `contrato_${Date.now()}.pdf`;
    const filePath = path.join(uploadDir, fileName);
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    // Extraer texto del PDF
    let textoPDF = '';
    let datosExtraidos: DatosContrato = {};

    try {
      // Polyfills para pdfjs-dist en serverless
      if (typeof (globalThis as any).DOMMatrix === 'undefined') {
        (globalThis as any).DOMMatrix = class DOMMatrix {
          private _a = 1; private _b = 0; private _c = 0; private _d = 1; private _e = 0; private _f = 0;
          constructor(init?: any) {
            if (Array.isArray(init)) {
              this._a = init[0] || 1; this._b = init[1] || 0;
              this._c = init[2] || 0; this._d = init[3] || 1;
              this._e = init[4] || 0; this._f = init[5] || 0;
            }
          }
          get a() { return this._a; } get b() { return this._b; }
          get c() { return this._c; } get d() { return this._d; }
          get e() { return this._e; } get f() { return this._f; }
          multiply() { return this; } translate() { return this; } scale() { return this; }
        };
      }
      if (typeof (globalThis as any).Path2D === 'undefined') {
        (globalThis as any).Path2D = class Path2D {
          constructor() {} moveTo() {} lineTo() {} closePath() {} arc() {} rect() {} ellipse() {}
        };
      }

      const pdfjsLib: any = await import('pdfjs-dist/legacy/build/pdf.js');
      const data = new Uint8Array(buffer);
      const pdfDoc = await pdfjsLib.getDocument({
        data, useSystemFonts: true, disableFontFace: true, isEvalSupported: false,
      }).promise;

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        let lineaActual = '';
        let yAnterior: number | null = null;
        for (const item of content.items) {
          const y = item.transform ? item.transform[5] : 0;
          if (yAnterior !== null && Math.abs(y - yAnterior) > 2) {
            textoPDF += lineaActual.trim() + '\n';
            lineaActual = '';
          }
          lineaActual += (item.str || '') + ' ';
          yAnterior = y;
        }
        if (lineaActual.trim()) textoPDF += lineaActual.trim() + '\n';
      }

      // Extraer datos del texto
      datosExtraidos = extraerDatosContrato(textoPDF);
    } catch (pdfError: any) {
      console.error('Error procesando PDF del contrato:', pdfError.message);
      // Si falla el PDF, continuar sin datos extraídos
    }

    // Buscar o crear cliente si se encontró RFC
    let clienteId: string | null = null;
    if (datosExtraidos.clienteRfc) {
      const clienteExistente = await db.cliente.findFirst({
        where: { rfc: { equals: datosExtraidos.clienteRfc, mode: 'insensitive' }, empresaId },
      });
      if (clienteExistente) {
        clienteId = clienteExistente.id;
      } else {
        const nuevoCliente = await db.cliente.create({
          data: {
            nombre: datosExtraidos.clienteNombre || `Cliente ${datosExtraidos.clienteRfc}`,
            rfc: datosExtraidos.clienteRfc.toUpperCase(),
            empresaId,
          },
        });
        clienteId = nuevoCliente.id;
      }
    }

    // Crear o actualizar proyecto
    let proyecto;
    if (proyectoId) {
      // Actualizar existente
      proyecto = await db.proyecto.update({
        where: { id: proyectoId },
        data: {
          contratoPdf: file.name,
          contratoMonto: datosExtraidos.monto,
          contratoMoneda: datosExtraidos.moneda,
          contratoFecha: datosExtraidos.fecha,
          contratista: datosExtraidos.contratista,
          clienteNombre: datosExtraidos.clienteNombre,
          clienteRfc: datosExtraidos.clienteRfc,
          ubicacion: datosExtraidos.ubicacion,
          tipoObra: datosExtraidos.tipoObra,
          alcanceTrabajo: datosExtraidos.alcance,
          plazoDias: datosExtraidos.plazoDias,
          anticipoPct: datosExtraidos.anticipoPct,
          presupuesto: datosExtraidos.monto || 0,
          ...(clienteId ? { clienteId } : {}),
        },
      });
    } else {
      // Crear nuevo
      proyecto = await db.proyecto.create({
        data: {
          nombre: nombreProyecto || datosExtraidos.clienteNombre || `Proyecto ${new Date().getFullYear()}`,
          descripcion: datosExtraidos.alcance || 'Proyecto creado desde contrato PDF',
          empresaId,
          contratoPdf: file.name,
          contratoMonto: datosExtraidos.monto,
          contratoMoneda: datosExtraidos.moneda,
          contratoFecha: datosExtraidos.fecha,
          contratista: datosExtraidos.contratista,
          clienteNombre: datosExtraidos.clienteNombre,
          clienteRfc: datosExtraidos.clienteRfc,
          ubicacion: datosExtraidos.ubicacion,
          tipoObra: datosExtraidos.tipoObra,
          alcanceTrabajo: datosExtraidos.alcance,
          plazoDias: datosExtraidos.plazoDias,
          anticipoPct: datosExtraidos.anticipoPct,
          presupuesto: datosExtraidos.monto || 0,
          fechaInicio: datosExtraidos.fecha,
          ...(clienteId ? { clienteId } : {}),
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: `✅ Contrato procesado. Proyecto ${proyectoId ? 'actualizado' : 'creado'}: ${proyecto.nombre}`,
      proyecto: {
        id: proyecto.id,
        nombre: proyecto.nombre,
        contratoMonto: proyecto.contratoMonto,
        contratoMoneda: proyecto.contratoMoneda,
        contratoFecha: proyecto.contratoFecha,
        clienteNombre: proyecto.clienteNombre,
        clienteRfc: proyecto.clienteRfc,
        ubicacion: proyecto.ubicacion,
        tipoObra: proyecto.tipoObra,
        plazoDias: proyecto.plazoDias,
        anticipoPct: proyecto.anticipoPct,
        alcanceTrabajo: proyecto.alcanceTrabajo,
      },
      datosExtraidos,
      textoExtraido: textoPDF.slice(0, 1000) + (textoPDF.length > 1000 ? '...' : ''),
    });
  } catch (e: any) {
    console.error('Error en upload-contrato:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
