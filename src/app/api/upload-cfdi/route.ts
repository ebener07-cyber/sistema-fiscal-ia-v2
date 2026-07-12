import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { XMLParser } from 'fast-xml-parser';
import { writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

/**
 * POST /api/upload-cfdi
 * Carga uno o más archivos XML (CFDI) y opcionalmente sus PDFs asociados.
 * Parsea automáticamente los XML y guarda las facturas en la base de datos.
 *
 * Body (multipart/form-data):
 *   - files: archivos XML o ZIP con XMLs (pueden ser múltiples)
 *   - direccion: 'emitida' | 'recibida' (default: 'recibida')
 *   - empresaId: ID de la empresa (default: primera empresa)
 *
 * Si se sube un PDF con el mismo nombre que un XML, se guarda como archivo adjunto.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => {
    const arrayElements = [
      'cfdi:Concepto', 'Concepto',
      'cfdi:Traslado', 'Traslado',
      'cfdi:Retencion', 'Retencion',
    ];
    return arrayElements.some(el => name === el || name.endsWith(':' + el));
  },
});

function parseCFDIXML(xmlContent: string) {
  try {
    if (!xmlContent || !xmlContent.includes('Comprobante')) return null;
    const result = parser.parse(xmlContent);
    const comprobante = result['cfdi:Comprobante'] || result['Comprobante'];
    if (!comprobante) return null;

    const getAttr = (obj: any, name: string): string => (obj ? obj[`@_${name}`] || '' : '');

    const folio = getAttr(comprobante, 'Folio') || 'S/F';
    const serie = getAttr(comprobante, 'Serie') || null;
    const fecha = getAttr(comprobante, 'Fecha') || new Date().toISOString();
    const subtotal = parseFloat(getAttr(comprobante, 'SubTotal')) || 0;
    const total = parseFloat(getAttr(comprobante, 'Total')) || 0;
    const descuento = parseFloat(getAttr(comprobante, 'Descuento')) || 0;
    const moneda = getAttr(comprobante, 'Moneda') || 'MXN';
    const tipoComprobante = getAttr(comprobante, 'TipoDeComprobante') || 'I';
    const metodoPago = getAttr(comprobante, 'MetodoPago') || 'PUE';
    const formaPago = getAttr(comprobante, 'FormaPago') || '01';
    const lugarExpedicion = getAttr(comprobante, 'LugarExpedicion') || '';

    const emisor = comprobante['cfdi:Emisor'] || comprobante['Emisor'] || {};
    const emisorRfc = getAttr(emisor, 'Rfc');
    const emisorNombre = getAttr(emisor, 'Nombre');
    const emisorRegimen = getAttr(emisor, 'RegimenFiscal');

    const receptor = comprobante['cfdi:Receptor'] || comprobante['Receptor'] || {};
    const receptorRfc = getAttr(receptor, 'Rfc');
    const receptorNombre = getAttr(receptor, 'Nombre');
    const receptorUsoCfdi = getAttr(receptor, 'UsoCFDI');

    // UUID del Timbre Fiscal
    let uuid = '';
    const complemento = comprobante['cfdi:Complemento'] || comprobante['Complemento'];
    if (complemento) {
      const timbre = complemento['tfd:TimbreFiscalDigital'] || complemento['TimbreFiscalDigital'];
      if (timbre) {
        uuid = getAttr(timbre, 'UUID') || getAttr(timbre, 'uuid') || '';
      }
      // Detectar si es nómina
      if (complemento['nomina12:Nomina'] || complemento['Nomina']) {
        // Es un CFDI de nómina
      }
    }

    // Impuestos
    const impuestosNode = comprobante['cfdi:Impuestos'] || comprobante['Impuestos'] || {};
    const totalTrasladados = parseFloat(getAttr(impuestosNode, 'TotalImpuestosTrasladados')) || 0;
    const totalRetenidos = parseFloat(getAttr(impuestosNode, 'TotalImpuestosRetenidos')) || 0;

    return {
      folio,
      serie,
      fecha: new Date(fecha),
      subtotal,
      totalImpuestos: totalTrasladados,
      total,
      moneda,
      tipoComprobante,
      metodoPago,
      formaPago,
      uuid: uuid.toUpperCase(),
      emisorRfc,
      emisorNombre,
      emisorRegimen,
      receptorRfc,
      receptorNombre,
      receptorUsoCfdi,
      lugarExpedicion,
    };
  } catch (e) {
    console.error('Error parseando CFDI:', e);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const files = formData.getAll('files') as File[];
    const direccion = (formData.get('direccion') as string) || 'recibida';
    const empresaId = (formData.get('empresaId') as string) || '';

    if (!files || files.length === 0) {
      return NextResponse.json({ error: 'No se recibieron archivos' }, { status: 400 });
    }

    // Obtener empresa
    let empId = empresaId;
    if (!empId) {
      const primera = await db.empresa.findFirst();
      if (!primera) {
        return NextResponse.json({ error: 'No hay empresas registradas. Crea una primero.' }, { status: 400 });
      }
      empId = primera.id;
    }

    // Carpeta de uploads — usar /tmp en Vercel (sistema de archivos de solo lectura excepto /tmp)
    const isVercel = !!process.env.VERCEL;
    const uploadBase = isVercel ? '/tmp' : process.cwd();
    const uploadDir = path.join(uploadBase, 'uploads', 'cfdi', direccion);
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    let procesados = 0;
    let duplicados = 0;
    let errores = 0;
    let pdfsGuardados = 0;
    const detalles: Array<{ archivo: string; estado: string; mensaje: string }> = [];

    for (const file of files) {
      const nombreArchivo = file.name.toLowerCase();
      const ext = nombreArchivo.split('.').pop() || '';

      // Si es PDF, guardarlo
      if (ext === 'pdf') {
        const filePath = path.join(uploadDir, file.name);
        const bytes = await file.arrayBuffer();
        await writeFile(filePath, Buffer.from(bytes));
        pdfsGuardados++;
        detalles.push({ archivo: file.name, estado: 'pdf', mensaje: 'PDF guardado' });
        continue;
      }

      // Si es XML, parsearlo
      if (ext === 'xml') {
        try {
          const xmlContent = await file.text();
          const cfdi = parseCFDIXML(xmlContent);

          if (!cfdi) {
            errores++;
            detalles.push({ archivo: file.name, estado: 'error', mensaje: 'No se pudo parsear el XML' });
            continue;
          }

          // Verificar duplicado por UUID
          if (cfdi.uuid) {
            const existente = await db.factura.findUnique({ where: { uuid: cfdi.uuid } });
            if (existente) {
              duplicados++;
              detalles.push({ archivo: file.name, estado: 'duplicado', mensaje: `UUID ${cfdi.uuid} ya existe` });
              continue;
            }
          }

          // Guardar XML original
          try {
            const xmlPath = path.join(uploadDir, file.name);
            await writeFile(xmlPath, await file.text());
          } catch {}

          // ===== DETECTAR TIPO DE CFDI =====
          // tipoComprobante: I=Ingreso, E=Egreso(Nota de crédito), T=Traslado, N=Nómina, P=Pago
          const esNomina = cfdi.tipoComprobante === 'N';
          const esNotaCredito = cfdi.tipoComprobante === 'E';

          if (esNomina) {
            // ===== NÓMINA → Guardar en ReciboNomina =====
            // Buscar empleado por RFC del receptor
            let empleado = await db.empleado.findFirst({
              where: { rfc: cfdi.receptorRfc },
            });

            // Si no existe el empleado, crearlo automáticamente
            if (!empleado) {
              empleado = await db.empleado.create({
                data: {
                  nombre: cfdi.receptorNombre || 'Empleado sin nombre',
                  rfc: cfdi.receptorRfc || 'XAXX000000XXX',
                  puesto: 'Por clasificar',
                  departamento: 'Por clasificar',
                  salarioMensual: cfdi.total, // Aproximación
                  empresaId: empId,
                },
              });
            }

            // Calcular deducciones aproximadas (15% del total)
            const deducciones = cfdi.total * 0.15;
            const neto = cfdi.total - deducciones;
            const isr = deducciones * 0.5;
            const imss = deducciones * 0.3;

            const fechaRecibo = new Date(cfdi.fecha);
            await db.reciboNomina.create({
              data: {
                folio: cfdi.folio,
                fecha: fechaRecibo,
                periodo: `${fechaRecibo.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}`,
                totalPercepciones: cfdi.total,
                totalDeducciones: deducciones,
                neto,
                isr,
                imss,
                uuid: cfdi.uuid || `${file.name}-${Date.now()}`,
                estado: 'timbrado',
                empleadoId: empleado.id,
                empresaId: empId,
              },
            });

            procesados++;
            detalles.push({
              archivo: file.name,
              estado: 'nomina',
              mensaje: `📋 Nómina → ${cfdi.receptorNombre}: $${cfdi.total.toFixed(2)} (guardada en módulo Nómina)`,
            });
            continue;
          }

          // ===== FACTURA NORMAL O NOTA DE CRÉDITO → Guardar en Factura =====
          // Buscar cliente/proveedor por RFC
          let clienteId: string | null = null;
          let proveedorId: string | null = null;

          if (direccion === 'emitida') {
            const cliente = await db.cliente.findFirst({ where: { rfc: cfdi.receptorRfc } });
            if (cliente) clienteId = cliente.id;
          } else {
            const proveedor = await db.proveedor.findFirst({ where: { rfc: cfdi.emisorRfc } });
            if (proveedor) proveedorId = proveedor.id;
          }

          await db.factura.create({
            data: {
              folio: cfdi.folio,
              serie: cfdi.serie,
              fecha: cfdi.fecha,
              subtotal: cfdi.subtotal,
              totalImpuestos: cfdi.totalImpuestos,
              total: cfdi.total,
              moneda: cfdi.moneda,
              tipoComprobante: cfdi.tipoComprobante, // I, E, T, P
              metodoPago: cfdi.metodoPago,
              formaPago: cfdi.formaPago,
              uuid: cfdi.uuid || `${file.name}-${Date.now()}`,
              direccion,
              estado: 'timbrada',
              empresaId: empId,
              clienteId,
              proveedorId,
              receptorRfc: cfdi.receptorRfc,
              receptorNombre: cfdi.receptorNombre,
              emisorRfc: cfdi.emisorRfc,
              emisorNombre: cfdi.emisorNombre,
              concepto: esNotaCredito
                ? `Nota de crédito: ${file.name}`
                : `Importado: ${file.name}`,
            },
          });

          procesados++;
          detalles.push({
            archivo: file.name,
            estado: esNotaCredito ? 'nota_credito' : 'procesado',
            mensaje: `${esNotaCredito ? '⚠️ Nota de crédito' : '🧾 Factura'} → ${cfdi.emisorNombre || 'N/A'} → ${cfdi.receptorNombre || 'N/A'}: $${cfdi.total.toFixed(2)}`,
          });
        } catch (e: any) {
          errores++;
          detalles.push({ archivo: file.name, estado: 'error', mensaje: e.message });
        }
        continue;
      }

      // Si es ZIP, descomprimir (requiere adm-zip)
      if (ext === 'zip') {
        try {
          const AdmZip = (await import('adm-zip')).default;
          const zipBuffer = Buffer.from(await file.arrayBuffer());
          const zip = new AdmZip(zipBuffer);
          const entries = zip.getEntries();

          for (const entry of entries) {
            if (entry.isDirectory) continue;
            const entryName = entry.entryName.toLowerCase();
            if (!entryName.endsWith('.xml')) continue;

            try {
              const xmlContent = entry.getData().toString('utf8');
              const cfdi = parseCFDIXML(xmlContent);
              if (!cfdi) {
                errores++;
                continue;
              }

              if (cfdi.uuid) {
                const existenteFactura = await db.factura.findUnique({ where: { uuid: cfdi.uuid } });
                const existenteNomina = await db.reciboNomina.findUnique({ where: { uuid: cfdi.uuid } });
                if (existenteFactura || existenteNomina) {
                  duplicados++;
                  continue;
                }
              }

              // Guardar XML
              try {
                const xmlPath = path.join(uploadDir, entry.entryName);
                const entryDir = path.dirname(xmlPath);
                if (!existsSync(entryDir)) {
                  await mkdir(entryDir, { recursive: true });
                }
                await writeFile(xmlPath, xmlContent);
              } catch {}

              // Detectar tipo
              const esNominaZip = cfdi.tipoComprobante === 'N';
              const esNotaCreditoZip = cfdi.tipoComprobante === 'E';

              if (esNominaZip) {
                // Nómina → ReciboNomina
                let empleado = await db.empleado.findFirst({
                  where: { rfc: cfdi.receptorRfc },
                });
                if (!empleado) {
                  empleado = await db.empleado.create({
                    data: {
                      nombre: cfdi.receptorNombre || 'Empleado sin nombre',
                      rfc: cfdi.receptorRfc || 'XAXX000000XXX',
                      puesto: 'Por clasificar',
                      departamento: 'Por clasificar',
                      salarioMensual: cfdi.total,
                      empresaId: empId,
                    },
                  });
                }
                const deducciones = cfdi.total * 0.15;
                const neto = cfdi.total - deducciones;
                const fechaRecibo = new Date(cfdi.fecha);
                await db.reciboNomina.create({
                  data: {
                    folio: cfdi.folio,
                    fecha: fechaRecibo,
                    periodo: `${fechaRecibo.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' })}`,
                    totalPercepciones: cfdi.total,
                    totalDeducciones: deducciones,
                    neto,
                    isr: deducciones * 0.5,
                    imss: deducciones * 0.3,
                    uuid: cfdi.uuid || `${entry.entryName}-${Date.now()}`,
                    estado: 'timbrado',
                    empleadoId: empleado.id,
                    empresaId: empId,
                  },
                });
                procesados++;
              } else {
                // Factura o nota de crédito → Factura
                let clienteId: string | null = null;
                let proveedorId: string | null = null;
                if (direccion === 'emitida') {
                  const c = await db.cliente.findFirst({ where: { rfc: cfdi.receptorRfc } });
                  if (c) clienteId = c.id;
                } else {
                  const p = await db.proveedor.findFirst({ where: { rfc: cfdi.emisorRfc } });
                  if (p) proveedorId = p.id;
                }

                await db.factura.create({
                  data: {
                    folio: cfdi.folio,
                    serie: cfdi.serie,
                    fecha: cfdi.fecha,
                    subtotal: cfdi.subtotal,
                    totalImpuestos: cfdi.totalImpuestos,
                    total: cfdi.total,
                    moneda: cfdi.moneda,
                    tipoComprobante: cfdi.tipoComprobante,
                    metodoPago: cfdi.metodoPago,
                    formaPago: cfdi.formaPago,
                    uuid: cfdi.uuid || `${entry.entryName}-${Date.now()}`,
                    direccion,
                    estado: 'timbrada',
                    empresaId: empId,
                    clienteId,
                    proveedorId,
                    receptorRfc: cfdi.receptorRfc,
                    receptorNombre: cfdi.receptorNombre,
                    emisorRfc: cfdi.emisorRfc,
                    emisorNombre: cfdi.emisorNombre,
                    concepto: esNotaCreditoZip
                      ? `Nota de crédito (ZIP): ${file.name}`
                      : `Importado ZIP: ${file.name}`,
                  },
                });
                procesados++;
              }
            } catch (e) {
              errores++;
            }
          }
          detalles.push({
            archivo: file.name,
            estado: 'zip',
            mensaje: `ZIP con ${entries.filter(e => !e.isDirectory && e.entryName.toLowerCase().endsWith('.xml')).length} XMLs procesados`,
          });
        } catch (e: any) {
          errores++;
          detalles.push({ archivo: file.name, estado: 'error', mensaje: `ZIP error: ${e.message}` });
        }
      }
    }

    return NextResponse.json({
      success: true,
      total: files.length,
      procesados,
      duplicados,
      errores,
      pdfsGuardados,
      detalles: detalles.slice(0, 50),
      message: `✅ ${procesados} CFDI(s) procesado(s), ${duplicados} duplicado(s), ${errores} error(es), ${pdfsGuardados} PDF(s) guardado(s)`,
    });
  } catch (e: any) {
    console.error('Error en upload-cfdi:', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
