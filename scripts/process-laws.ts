/**
 * Procesa los 10 PDFs de leyes fiscales y los convierte en knowledge base JSON.
 * Ejecutar: bun run scripts/process-laws.ts
 *
 * Estructura de salida: /home/z/my-project/skills/auditoria-fiscal/
 *   - SKILL.md (descriptor del skill)
 *   - laws/{LEY}.json (texto extraído + metadatos + chunks por artículo)
 */
import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const UPLOAD_DIR = '/home/z/my-project/upload';
const OUTPUT_DIR = '/home/z/my-project/skills/auditoria-fiscal';
const LAWS_DIR = path.join(OUTPUT_DIR, 'laws');

interface LeyProcesada {
  id: string;
  nombre: string;
  abreviatura: string;
  archivo: string;
  paginas: number;
  caracteres: number;
  texto: string;
  articulos: Array<{
    numero: string;
    texto: string;
  }>;
  indiceTemas: string[];
}

const LEYES = [
  { id: 'l isr', nombre: 'Ley del Impuesto Sobre la Renta', abreviatura: 'LISR', archivo: 'LISR.pdf' },
  { id: 'l iva', nombre: 'Ley del Impuesto al Valor Agregado', abreviatura: 'LIVA', archivo: 'LIVA.pdf' },
  { id: 'cff', nombre: 'Código Fiscal de la Federación', abreviatura: 'CFF', archivo: 'CFF.pdf' },
  { id: 'lft', nombre: 'Ley Federal del Trabajo', abreviatura: 'LFT', archivo: 'LFT140526.pdf' },
  { id: 'lss', nombre: 'Ley del Seguro Social', abreviatura: 'LSS', archivo: 'LSS_15-01-26.pdf' },
  { id: 'linfonavit', nombre: 'Ley del INFONAVIT', abreviatura: 'LINFONAVIT', archivo: 'LIFNVT-21-02-2025.pdf' },
  { id: 'lfprh', nombre: 'Ley Federal de Protección de Datos Personales en Posesión de Particulares', abreviatura: 'LFPDPPP', archivo: 'LFPRH.pdf' },
  { id: 'lga', nombre: 'Ley General de Asentamientos Humanos', abreviatura: 'LGA', archivo: 'LGA+14.11.25.pdf' },
  { id: 'dof', nombre: 'Diario Oficial de la Federación', abreviatura: 'DOF', archivo: 'DOF - Diario Oficial de la Federación.pdf' },
];

async function extractPdfText(filePath: string): Promise<{ text: string; numpages: number }> {
  try {
    const { PDFParse } = await import('pdf-parse');
    const buffer = await readFile(filePath);
    const uint8 = new Uint8Array(buffer);
    const p = new PDFParse(uint8);
    await p.load();
    const result: any = await p.getText();
    return {
      text: result.text || '',
      numpages: result.total || (result.pages?.length || 0),
    };
  } catch (e: any) {
    console.error(`Error extrayendo ${filePath}:`, e.message);
    return { text: '', numpages: 0 };
  }
}

function extraerArticulos(texto: string): Array<{ numero: string; texto: string }> {
  const articulos: Array<{ numero: string; texto: string }> = [];
  // Patrones: "Artículo 27.", "Artículo 27.-", "ARTÍCULO 27"
  const regex = /Art[ií]culo\s+(\d+[A-Za-z]?)[.-]\s*/gi;
  let match;
  let lastIndex = 0;
  let lastNum = '';

  while ((match = regex.exec(texto)) !== null) {
    if (lastNum) {
      articulos.push({
        numero: lastNum,
        texto: texto.slice(lastIndex, match.index).trim(),
      });
    }
    lastNum = match[1];
    lastIndex = regex.lastIndex;
  }
  if (lastNum) {
    articulos.push({
      numero: lastNum,
      texto: texto.slice(lastIndex, lastIndex + 3000).trim(),
    });
  }

  // Limitar cada artículo a 3000 caracteres para no saturar el contexto
  return articulos.map(a => ({
    numero: a.numero,
    texto: a.texto.slice(0, 3000),
  }));
}

async function main() {
  console.log('📚 Procesando leyes fiscales...\n');

  if (!existsSync(LAWS_DIR)) {
    await mkdir(LAWS_DIR, { recursive: true });
  }

  const indice: Array<{ id: string; nombre: string; abreviatura: string; archivo: string; articulos: number; caracteres: number }> = [];

  for (const ley of LEYES) {
    const filePath = path.join(UPLOAD_DIR, ley.archivo);
    if (!existsSync(filePath)) {
      console.log(`⚠️  No encontrado: ${ley.archivo}`);
      continue;
    }

    console.log(`📖 Procesando ${ley.abreviatura} — ${ley.nombre}...`);
    const { text, numpages } = await extractPdfText(filePath);

    if (!text) {
      console.log(`❌ Sin texto extraído de ${ley.archivo}`);
      continue;
    }

    const articulos = extraerArticulos(text);
    console.log(`   ✅ ${numpages} páginas, ${text.length} caracteres, ${articulos.length} artículos`);

    const datos: LeyProcesada = {
      id: ley.id,
      nombre: ley.nombre,
      abreviatura: ley.abreviatura,
      archivo: ley.archivo,
      paginas: numpages,
      caracteres: text.length,
      texto: text,
      articulos,
      indiceTemas: detectarTemas(text, ley.abreviatura),
    };

    // Guardar JSON completo (con texto)
    await writeFile(
      path.join(LAWS_DIR, `${ley.abreviatura}.json`),
      JSON.stringify(datos, null, 2),
      'utf-8'
    );

    // Guardar versión "lite" sin texto completo (solo artículos) para carga rápida
    const lite = {
      id: ley.id,
      nombre: ley.nombre,
      abreviatura: ley.abreviatura,
      archivo: ley.archivo,
      paginas: numpages,
      caracteres: text.length,
      articulosCount: articulos.length,
      indiceTemas: datos.indiceTemas,
      articulos,
    };
    await writeFile(
      path.join(LAWS_DIR, `${ley.abreviatura}.lite.json`),
      JSON.stringify(lite, null, 2),
      'utf-8'
    );

    indice.push({
      id: ley.id,
      nombre: ley.nombre,
      abreviatura: ley.abreviatura,
      archivo: ley.archivo,
      articulos: articulos.length,
      caracteres: text.length,
    });
  }

  // Guardar índice maestro
  await writeFile(
    path.join(LAWS_DIR, '_indice.json'),
    JSON.stringify(indice, null, 2),
    'utf-8'
  );

  // Crear SKILL.md
  const skillMd = `# Skill: Auditoría Fiscal Mexicana

## Descripción
Asistente experto en leyes fiscales mexicanas con acceso a 9 leyes federales completas:
${indice.map(l => `- **${l.abreviatura}** — ${l.nombre} (${l.articulos} artículos, ${l.caracteres} caracteres)`).join('\n')}

## Capacidades
- Consultar artículos específicos de cualquier ley
- Explicar obligaciones fiscales según la ley aplicable
- Citar el artículo exacto en cada respuesta
- Cruzar información entre leyes (ej: nómina → LFT + LSS + LISR)
- Auditar cumplimiento fiscal basado en la ley vigente

## Cómo funciona
1. El usuario hace una pregunta fiscal
2. El sistema detecta la(s) ley(es) relevante(s)
3. Carga el texto de los artículos pertinentes como contexto
4. GLM-5.2 responde con la ley en mano, citando artículos

## Mapeo de temas a leyes
- **ISR, ingresos, utilidades, deducciones** → LISR
- **IVA, traslación, acreditamiento** → LIVA
- **CFDI, comprobantes, obligaciones fiscales** → CFF
- **Nómina, salario, jornada, vacaciones** → LFT
- **IMSS, cuotas, seguros** → LSS
- **INFONAVIT, vivienda, crédito** → LINFONAVIT
- **Datos personales, privacidad** → LFPDPPP
- **Asentamientos humanos, uso de suelo** → LGA

## Fuente de datos
- Carpeta: \`/skills/auditoria-fiscal/laws/\`
- Formato: JSON con texto completo + artículos extraídos
- Actualización: 11 julio 2026
`;
  await writeFile(path.join(OUTPUT_DIR, 'SKILL.md'), skillMd, 'utf-8');

  console.log('\n🎉 Procesamiento completo!');
  console.log(`📁 Skills guardados en: ${OUTPUT_DIR}`);
  console.log(`📊 Total: ${indice.length} leyes, ${indice.reduce((s, l) => s + l.articulos, 0)} artículos`);
  console.log(`📝 SKILL.md creado`);
}

function detectarTemas(texto: string, abreviatura: string): string[] {
  const temas: string[] = [];
  const t = texto.toLowerCase();

  if (t.includes('impuesto sobre la renta') || t.includes('isr')) temas.push('ISR', 'ingresos', 'utilidades', 'deducciones');
  if (t.includes('valor agregado') || t.includes('iva')) temas.push('IVA', 'traslación', 'acreditamiento');
  if (t.includes('código fiscal') || t.includes('cfdi')) temas.push('CFDI', 'comprobantes', 'obligaciones fiscales');
  if (t.includes('federal del trabajo') || t.includes('salario')) temas.push('nómina', 'salario', 'jornada', 'vacaciones');
  if (t.includes('seguro social') || t.includes('imss')) temas.push('IMSS', 'cuotas', 'seguros');
  if (t.includes('infonavit') || t.includes('vivienda')) temas.push('INFONAVIT', 'vivienda', 'crédito');
  if (t.includes('datos personales') || t.includes('privacidad')) temas.push('datos personales', 'privacidad');
  if (t.includes('asentamientos') || t.includes('uso de suelo')) temas.push('asentamientos', 'uso de suelo');

  return [...new Set(temas)];
}

main().catch(console.error);
