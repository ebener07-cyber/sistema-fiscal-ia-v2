import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

/**
 * POST /api/upload-constancia-fiscal
 *
 * Recibe un PDF de la Constancia de Situación Fiscal (CSF) del SAT,
 * extrae automáticamente todos los datos y opcionalmente da de alta la empresa.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface DatosConstancia {
  rfc: string;
  nombre: string;
  regimenFiscalCodigo: string;
  regimenFiscalDescripcion: string;
  nombreComercial: string | null;
  codigoPostal: string;
  domicilio: string | null;
  fechaInicioOperaciones: string | null;
  situacionContribuyente: string;
  fechaUltimoMovimiento: string | null;
  tipoPersona: string;
}

function extraerRFC(texto: string): string {
  const patrones = [
    /RFC\s*:?\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/i,
    /([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})\s/,
    /Contribuyente\s*:?\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/i,
  ];
  for (const p of patrones) {
    const match = texto.match(p);
    if (match) return match[1].toUpperCase().trim();
  }
  return '';
}

function extraerNombre(texto: string): string {
  const patrones = [
    /(?:Nombre|Denominaci[oó]n|Raz[oó]n Social)[\s\S]{0,40}?:\s*([\s\S]+?)(?:\n|R[eé]gimen|Nombre comercial|Domicilio)/i,
    /Contribuyente[\s\S]{0,30}?\n\s*([\s\S]+?)\n/i,
  ];
  for (const p of patrones) {
    const match = texto.match(p);
    if (match) {
      const nombre = match[1].trim();
      if (nombre.length > 3 && nombre.length < 200) return nombre;
    }
  }
  const rfcMatch = texto.match(/([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/);
  if (rfcMatch) {
    const idx = texto.indexOf(rfcMatch[1]);
    const despues = texto.slice(idx + rfcMatch[1].length, idx + 300).trim();
    const lineas = despues.split('\n').filter((l: string) => l.trim().length > 3);
    if (lineas.length > 0) return lineas[0].trim();
  }
  return '';
}

function extraerRegimen(texto: string): { codigo: string; descripcion: string } {
  const patrones = [
    /R[eé]gimen\s*(?:fiscal)?\s*:?\s*(\d{3})\s*[-—]\s*([^\n]+)/i,
    /R[eé]gimen\s*(?:fiscal)?\s*:?\s*(\d{3})\s+([^\n]+)/i,
    /(\d{3})\s*[-—]\s*(General de Ley|Persona F[ií]sica|Persona Moral|R[eé]gimen|Sueldos|Arrendamiento|Actividades|Incorporaci[oó]n|RIF|Honorarios|Dividendos|Intereses|Sin obligaciones)[^\n]*/i,
  ];
  for (const p of patrones) {
    const match = texto.match(p);
    if (match) return { codigo: match[1].trim(), descripcion: match[2].trim().slice(0, 100) };
  }
  const codMatch = texto.match(/R[eé]gimen[\s\S]{0,40}?(\d{3})/i);
  if (codMatch) return { codigo: codMatch[1].trim(), descripcion: '' };
  return { codigo: '', descripcion: '' };
}

function extraerCodigoPostal(texto: string): string {
  const patrones = [
    /C[oó]digo\s*(?:postal)?\s*:?\s*(\d{5})/i,
    /CP\s*:?\s*(\d{5})/i,
  ];
  for (const p of patrones) {
    const match = texto.match(p);
    if (match) return match[1];
  }
  return '';
}

function extraerNombreComercial(texto: string): string | null {
  const match = texto.match(/Nombre\s*comercial\s*:?\s*([^\n]+)/i);
  return match ? match[1].trim() : null;
}

function extraerSituacion(texto: string): string {
  const match = texto.match(/Situaci[oó]n\s*(?:del\s*)?contribuyente\s*:?\s*([^\n]+)/i);
  return match ? match[1].trim() : 'ACTIVO';
}

function extraerFechaInicio(texto: string): string | null {
  const match = texto.match(/(?:Fecha|Inicio)\s*(?:de\s*)?(?:inicio\s*)?operaciones\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i);
  return match ? match[1] : null;
}

function detectarTipoPersona(rfc: string, texto: string): string {
  if (rfc.length === 13) return 'FISICA';
  if (rfc.length === 12) return 'MORAL';
  if (/persona\s*f[ií]sica/i.test(texto)) return 'FISICA';
  if (/persona\s*moral/i.test(texto)) return 'MORAL';
  return 'FISICA';
}

function parsearConstancia(texto: string): DatosConstancia {
  const rfc = extraerRFC(texto);
  const nombre = extraerNombre(texto);
  const { codigo, descripcion } = extraerRegimen(texto);
  const codigoPostal = extraerCodigoPostal(texto);
  const nombreComercial = extraerNombreComercial(texto);
  const situacion = extraerSituacion(texto);
  const fechaInicio = extraerFechaInicio(texto);

  let domicilio: string | null = null;
  const calleMatch = texto.match(/(?:Calle|Avenida|Av\.?|Calz\.?)\s*:?\s*([^\n]+)/i);
  const colMatch = texto.match(/(?:Colonia|Col\.?)\s*:?\s*([^\n]+)/i);
  const muniMatch = texto.match(/(?:Municipio|Delegaci[oó]n|Alcald[ií]a)\s*:?\s*([^\n]+)/i);
  const estadoMatch = texto.match(/(?:Estado|Entidad)\s*:?\s*([^\n]+)/i);
  const partes = [calleMatch?.[1], colMatch?.[1], muniMatch?.[1], estadoMatch?.[1]].filter(Boolean);
  if (partes.length > 0) domicilio = partes.join(', ').trim();

  return {
    rfc, nombre, regimenFiscalCodigo: codigo, regimenFiscalDescripcion: descripcion,
    nombreComercial, codigoPostal, domicilio, fechaInicioOperaciones: fechaInicio,
    situacionContribuyente: situacion, fechaUltimoMovimiento: null,
    tipoPersona: detectarTipoPersona(rfc, texto),
  };
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const crearEmpresa = formData.get('crearEmpresa') === 'true';

    if (!file) return NextResponse.json({ error: 'No se recibió archivo' }, { status: 400 });

    // Extraer texto del PDF usando pdfjs-dist (legacy build)
    // Cargar worker manualmente para evitar problemas con Turbopack
    const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.js');
    const path = (await import('path')).default;
    const workerPath = path.join(process.cwd(), 'node_modules', 'pdfjs-dist', 'legacy', 'build', 'pdf.worker.js');
    const fs = await import('fs');
    const workerCode = fs.readFileSync(workerPath, 'utf-8');
    // Usar fake worker cargando el código directamente
    pdfjs.GlobalWorkerOptions.workerSrc = workerPath;

    const buffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(buffer);
    const loadingTask = pdfjs.getDocument({ data: uint8 });
    const pdf = await loadingTask.promise;
    let texto = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(' ');
      texto += pageText + '\n';
    }

    if (!texto || texto.length < 50) {
      return NextResponse.json({
        error: 'No se pudo extraer texto del PDF. Asegúrate de que sea una Constancia de Situación Fiscal válida del SAT.',
      }, { status: 400 });
    }

    const datos = parsearConstancia(texto);

    if (!datos.rfc) {
      return NextResponse.json({
        error: 'No se encontró RFC en el PDF. Verifica que sea una constancia fiscal válida.',
      }, { status: 400 });
    }

    let empresaCreada = null;
    if (crearEmpresa) {
      const existente = await db.empresa.findUnique({ where: { rfc: datos.rfc } });
      if (existente) {
        return NextResponse.json({
          error: `Ya existe una empresa con RFC ${datos.rfc}: ${existente.nombre}`,
          datos, existente: true,
        }, { status: 409 });
      }

      let regimenStr = datos.regimenFiscalDescripcion;
      if (datos.tipoPersona === 'MORAL') regimenStr = 'Persona Moral';
      else if (datos.tipoPersona === 'FISICA') regimenStr = 'Persona Física';
      if (datos.regimenFiscalDescripcion) {
        regimenStr = `${datos.regimenFiscalDescripcion}${datos.regimenFiscalCodigo ? ` (${datos.regimenFiscalCodigo})` : ''}`;
      }

      empresaCreada = await db.empresa.create({
        data: {
          nombre: datos.nombre || 'Sin nombre',
          rfc: datos.rfc,
          regimenFiscal: regimenStr,
          telefono: null,
          direccion: datos.domicilio || `CP ${datos.codigoPostal}`,
          status: datos.situacionContribuyente.toLowerCase().includes('activo') ? 'activo' : 'suspendido',
        },
      });
    }

    return NextResponse.json({
      success: true,
      datos,
      empresaCreada,
      message: crearEmpresa && empresaCreada
        ? `✅ Empresa "${empresaCreada.nombre}" creada con RFC ${empresaCreada.rfc}`
        : `✅ Constancia procesada. Revisa los datos extraídos.`,
    });
  } catch (e: any) {
    console.error('Error en upload-constancia-fiscal:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
