import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';

/**
 * GET /api/inegi?anio=2026&formato=excel
 * Genera reporte para INEGI (Instituto Nacional de Estadística y Geografía).
 *
 * El INEGI solicita reportes anuales con información de:
 *   - Personal ocupado
 *   - Remuneraciones
 *   - Ingresos por suministro de bienes y servicios
 *   - Gastos
 *   - Existencias de inventarios
 *   - Activos fijos
 *
 * Si formato=excel, descarga .xlsx
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const hoy = new Date();
    const anio = parseInt(searchParams.get('anio') ?? String(hoy.getFullYear()));
    const formato = searchParams.get('formato') || 'json';

    const inicioAnio = new Date(anio, 0, 1);
    const finAnio = new Date(anio, 11, 31, 23, 59, 59);

    const [empleados, facturasEmitidas, facturasRecibidas, productos] = await Promise.all([
      db.empleado.findMany({ where: { status: 'activo' } }),
      db.factura.findMany({ where: { direccion: 'emitida', fecha: { gte: inicioAnio, lte: finAnio } } }),
      db.factura.findMany({ where: { direccion: 'recibida', fecha: { gte: inicioAnio, lte: finAnio } } }),
      db.producto.findMany(),
    ]);

    const personalOcupado = empleados.length;
    const remuneraciones = empleados.reduce((s, e) => s + (e.salarioMensual * 12), 0);

    const ingresosSuministroBienes = facturasEmitidas
      .filter(f => f.tipoComprobante === 'I')
      .reduce((s, f) => s + f.subtotal, 0);

    const ivaIngresos = facturasEmitidas.reduce((s, f) => s + f.totalImpuestos, 0);
    const ingresosTotales = facturasEmitidas.reduce((s, f) => s + f.total, 0);

    const gastosCompras = facturasRecibidas.reduce((s, f) => s + f.subtotal, 0);
    const ivaGastos = facturasRecibidas.reduce((s, f) => s + f.totalImpuestos, 0);
    const gastosTotales = facturasRecibidas.reduce((s, f) => s + f.total, 0);

    const existenciasInventario = productos.reduce((s, p) => s + (p.existencia * p.precio), 0);
    const valorActivosFijos = 500000; // Estimación - configurar manualmente

    const reporte = {
      anio,
      identificacion: {
        razonSocial: 'Construcciones Hernández SAC',
        rfc: 'HEH850415ABC',
        tipoUnidad: 'Actividad económica',
        anioReferencia: anio,
      },
      personal: {
        personalOcupadoTotal: personalOcupado,
        // Desglose por tipo
        personalRemunerado: personalOcupado,
        personalNoRemunerado: 0,
        // Remuneraciones anuales
        remuneracionesTotales: remuneraciones,
        sueldosYSalarios: remuneraciones * 0.85,
        prestaciones: remuneraciones * 0.15,
      },
      ingresos: {
        ingresosPorSuministroBienesServicios: ingresosSuministroBienes,
        ivaTrasladado: ivaIngresos,
        ingresosTotales: ingresosTotales,
        // Por tipo
        ventasBienes: ingresosSuministroBienes * 0.7,
        servicios: ingresosSuministroBienes * 0.3,
        otrosIngresos: 0,
      },
      gastos: {
        comprasMateriasPrimas: gastosCompras * 0.6,
        gastosOperacion: gastosCompras * 0.3,
        otrosGastos: gastosCompras * 0.1,
        ivaAcreditable: ivaGastos,
        gastosTotales: gastosTotales,
      },
      existencias: {
        materiasPrimas: existenciasInventario * 0.7,
        productosTerminados: existenciasInventario * 0.3,
        totalInventario: existenciasInventario,
      },
      activosFijos: {
        maquinariaEquipo: valorActivosFijos * 0.5,
        construcciones: valorActivosFijos * 0.3,
        mobiliarioEquipo: valorActivosFijos * 0.15,
        equipoTransporte: valorActivosFijos * 0.05,
        totalActivosFijos: valorActivosFijos,
      },
      resumen: {
        totalIngresos: ingresosTotales,
        totalGastos: gastosTotales + remuneraciones,
        utilidadOperativa: ingresosTotales - gastosTotales - remuneraciones,
      },
    };

    if (formato === 'excel') {
      const wb = new ExcelJS.Workbook();
      wb.creator = 'Sistema Fiscal IA';
      wb.created = new Date();

      const ws = wb.addWorksheet('Reporte INEGI', { views: [{ showGridLines: false }] });
      ws.columns = [{ width: 45 }, { width: 22 }];

      ws.mergeCells('A1:B1');
      ws.getCell('A1').value = `REPORTE ESTADÍSTICO INEGI — ${anio}`;
      ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF7C3AED' } };
      ws.getCell('A1').alignment = { horizontal: 'center' };
      ws.getRow(1).height = 28;

      ws.mergeCells('A2:B2');
      ws.getCell('A2').value = 'Encuesta Mensual de la Industria Manufacturera / Establecimientos Comerciales';
      ws.getCell('A2').font = { italic: true, size: 10, color: { argb: 'FF64748B' } };
      ws.getCell('A2').alignment = { horizontal: 'center' };

      const secciones = [
        {
          titulo: 'IDENTIFICACIÓN',
          color: 'FF7C3AED',
          items: [
            ['Razón social', reporte.identificacion.razonSocial],
            ['RFC', reporte.identificacion.rfc],
            ['Tipo de unidad', reporte.identificacion.tipoUnidad],
            ['Año de referencia', String(reporte.identificacion.anioReferencia)],
          ],
        },
        {
          titulo: 'PERSONAL OCUPADO',
          color: 'FF3B82F6',
          items: [
            ['Personal ocupado total', String(reporte.personal.personalOcupadoTotal)],
            ['Personal remunerado', String(reporte.personal.personalRemunerado)],
            ['Personal no remunerado', String(reporte.personal.personalNoRemunerado)],
            ['Remuneraciones totales anuales', reporte.personal.remuneracionesTotales],
            ['Sueldos y salarios', reporte.personal.sueldosYSalarios],
            ['Prestaciones sociales', reporte.personal.prestaciones],
          ],
        },
        {
          titulo: 'INGRESOS POR SUMINISTRO DE BIENES Y SERVICIOS',
          color: 'FF10B981',
          items: [
            ['Ingresos por suministro de bienes y servicios', reporte.ingresos.ingresosPorSuministroBienesServicios],
            ['Venta de bienes', reporte.ingresos.ventasBienes],
            ['Prestación de servicios', reporte.ingresos.servicios],
            ['Otros ingresos', reporte.ingresos.otrosIngresos],
            ['IVA trasladado', reporte.ingresos.ivaTrasladado],
            ['Ingresos totales', reporte.ingresos.ingresosTotales],
          ],
        },
        {
          titulo: 'GASTOS',
          color: 'FFEF4444',
          items: [
            ['Compras de materias primas', reporte.gastos.comprasMateriasPrimas],
            ['Gastos de operación', reporte.gastos.gastosOperacion],
            ['Otros gastos', reporte.gastos.otrosGastos],
            ['IVA acreditable', reporte.gastos.ivaAcreditable],
            ['Gastos totales', reporte.gastos.gastosTotales],
          ],
        },
        {
          titulo: 'EXISTENCIAS DE INVENTARIOS',
          color: 'FF8B5CF6',
          items: [
            ['Materias primas', reporte.existencias.materiasPrimas],
            ['Productos terminados', reporte.existencias.productosTerminados],
            ['Total inventario', reporte.existencias.totalInventario],
          ],
        },
        {
          titulo: 'ACTIVOS FIJOS',
          color: 'FF06B6D4',
          items: [
            ['Maquinaria y equipo', reporte.activosFijos.maquinariaEquipo],
            ['Construcciones', reporte.activosFijos.construcciones],
            ['Mobiliario y equipo', reporte.activosFijos.mobiliarioEquipo],
            ['Equipo de transporte', reporte.activosFijos.equipoTransporte],
            ['Total activos fijos', reporte.activosFijos.totalActivosFijos],
          ],
        },
        {
          titulo: 'RESUMEN FINANCIERO',
          color: 'FF831843',
          items: [
            ['Total de ingresos', reporte.resumen.totalIngresos],
            ['Total de gastos (incluye nómina)', reporte.resumen.totalGastos],
            ['Utilidad operativa', reporte.resumen.utilidadOperativa],
          ],
        },
      ];

      let row = 4;
      for (const seccion of secciones) {
        ws.getCell(`A${row}`).value = seccion.titulo;
        ws.getCell(`A${row}`).font = { bold: true, size: 12, color: { argb: seccion.color } };
        row++;

        for (const [label, value] of seccion.items) {
          const isNumber = typeof value === 'number';
          ws.addRow([label, isNumber ? value : String(value)]);
          if (isNumber) {
            ws.getCell(`B${row}`).numFmt = '"$"#,##0.00';
          }
          row++;
        }
        row++; // Espacio entre secciones
      }

      const buffer = await wb.xlsx.writeBuffer();
      return new Response(buffer, {
        headers: {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="inegi_${anio}.xlsx"`,
        },
      });
    }

    return NextResponse.json(reporte);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
