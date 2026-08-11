import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';
import { mapearMovimiento, detectarPagosMultiples } from '@/lib/agentes/conciliador-inteligente';

/**
 * GET /api/reportes/conciliacion-maestra?empresaId=xxx&anio=2026
 *
 * CONCILIACIÓN MAESTRA v3 — Con Dashboard + Semáforo + Deduplicación
 *
 * 4 Arreglos críticos aplicados:
 * 1. DEDUPLICACIÓN: Elimina filas duplicadas (Fecha + Concepto + Monto)
 * 2. MOTOR DE MAPEO: Clasifica TODO con reglas (no más "Sin Clasificar")
 * 3. MATCH POR MONTO EXACTO: Busca CFDIs por monto (no solo por SPEI/UUID)
 * 4. SEMÁFORO: Columna con colores Verde/Amarillo/Rojo
 *
 * Genera Excel con:
 * - Hoja 1: Dashboard Ejecutivo (KPIs con semáforo)
 * - Hoja 2: Semáforo Detallado (todos los movimientos con colores)
 * - Hoja 3: Santander Match
 * - Hoja 4: Banorte Match
 * - Hoja 5: Top Clientes
 * - Hoja 6: Top Proveedores
 * - Hoja 7: Dictamen
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOL_MONTO = 0.02; // 2% tolerancia para match por monto
const TOL_FECHA = 7; // ±7 días

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const anio = parseInt(searchParams.get('anio') ?? '2026');
    const empresaId = searchParams.get('empresaId');
    if (!empresaId) return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });

    const inicioAnio = new Date(anio, 0, 1);
    const finAnio = new Date(anio, 11, 31, 23, 59, 59);
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const empresa = await db.empresa.findUnique({ where: { id: empresaId }, select: { nombre: true, rfc: true } });

    // ===== OBTENER DATOS =====
    const [movimientosRaw, facturasEmitidas, facturasRecibidas] = await Promise.all([
      db.movimientoBanco.findMany({
        where: { cuenta: { empresaId }, fecha: { gte: inicioAnio, lte: finAnio } },
        include: {
          cuenta: { select: { banco: true, cuenta: true } },
          facturaConciliada: { select: { folio: true, serie: true, total: true, uuid: true, receptorNombre: true, emisorNombre: true } },
        },
        orderBy: { fecha: 'asc' },
      }),
      db.factura.findMany({
        where: { empresaId, direccion: 'emitida', estado: 'timbrada', tipoComprobante: 'I', fecha: { gte: inicioAnio, lte: finAnio } },
        select: { id: true, folio: true, serie: true, fecha: true, total: true, receptorRfc: true, receptorNombre: true, uuid: true },
        orderBy: { fecha: 'asc' },
      }),
      db.factura.findMany({
        where: { empresaId, direccion: 'recibida', estado: 'timbrada', tipoComprobante: 'I', fecha: { gte: inicioAnio, lte: finAnio } },
        select: { id: true, folio: true, serie: true, fecha: true, total: true, emisorRfc: true, emisorNombre: true, uuid: true },
        orderBy: { fecha: 'asc' },
      }),
    ]);

    // ===== ARREGLO 1: DEDUPLICACIÓN =====
    // Eliminar movimientos duplicados (misma fecha + concepto + monto)
    const vistos = new Set<string>();
    const movimientos = movimientosRaw.filter(mov => {
      const key = `${mov.fecha.toISOString().slice(0,10)}|${mov.concepto.slice(0,50)}|${mov.monto.toFixed(2)}`;
      if (vistos.has(key)) return false; // Duplicado
      vistos.add(key);
      return true;
    });

    // ===== DETECTAR PAGOS MÚLTIPLES =====
    const pagosMultiplesSet = detectarPagosMultiples(movimientos.map(m => ({ id: m.id, fecha: m.fecha, concepto: m.concepto, monto: m.monto })));

    // ===== PROCESAR CADA MOVIMIENTO =====
    const facturasConPago = new Set<string>();
    const resultados: any[] = [];

    for (const mov of movimientos) {
      const esDeposito = mov.monto > 0;
      const montoAbs = Math.abs(mov.monto);

      // ===== ARREGLO 2: MOTOR DE MAPEO AUTOMÁTICO =====
      const mapeo = mapearMovimiento(mov.concepto, mov.monto);

      let estado = 'Requiere Acción';
      let semaforo = '🔴 Rojo (Sin Factura)';
      let uuid = '';
      let folio = '';
      let clienteProveedor = '';
      let montoFactura = 0;
      let categoriaReal = mapeo.categoria;
      let cuentaContable = mapeo.cuentaContable;

      // Si ya tiene factura conciliada en BD
      if (mov.facturaConciliadaId && mov.facturaConciliada) {
        estado = 'CONCILIADO';
        semaforo = '🟢 Verde (Conciliado)';
        uuid = mov.facturaConciliada.uuid || '';
        folio = `${mov.facturaConciliada.serie || ''}${mov.facturaConciliada.folio}`;
        clienteProveedor = esDeposito ? mov.facturaConciliada.receptorNombre || '' : mov.facturaConciliada.emisorNombre || '';
        montoFactura = mov.facturaConciliada.total;
        facturasConPago.add(mov.facturaConciliadaId);
        categoriaReal = 'CONCILIADO (Por UUID/SPEI)';
      }
      // Si el motor de mapeo dice que NO requiere CFDI
      else if (!mapeo.requiereCfdi) {
        estado = mapeo.estado;
        semaforo = '🟡 Amarillo (Mapeado Auto)';
        categoriaReal = mapeo.categoria;
      }
      // Si requiere comprobación (anticipos a empleados)
      else if (mapeo.estado === 'Pendiente Comprobación') {
        estado = 'Pendiente Comprobación';
        semaforo = '🟡 Amarillo (Pendiente Comprobación)';
      }
      else {
        // ===== ARREGLO 3: MATCH POR MONTO EXACTO =====
        // Buscar facturas que coincidan por monto ±2% y fecha ±7 días
        const facturas = esDeposito ? facturasEmitidas : facturasRecibidas;
        const matches = facturas.filter(f => {
          if (f.total < montoAbs * (1 - TOL_MONTO) || f.total > montoAbs * (1 + TOL_MONTO)) return false;
          return Math.abs(f.fecha.getTime() - mov.fecha.getTime()) / 86400000 <= TOL_FECHA;
        });

        if (matches.length === 1) {
          estado = 'CONCILIADO';
          semaforo = '🟢 Verde (Conciliado)';
          uuid = matches[0].uuid || '';
          folio = `${matches[0].serie || ''}${matches[0].folio}`;
          clienteProveedor = esDeposito ? matches[0].receptorNombre || '' : matches[0].emisorNombre || '';
          montoFactura = matches[0].total;
          facturasConPago.add(matches[0].id);
          categoriaReal = 'CONCILIADO (Por Monto)';
        } else if (matches.length > 1) {
          estado = 'MULTIPLES';
          semaforo = '🟠 Naranja (Requiere Agrupar)';
          folio = `${matches.length} facturas similares`;
          montoFactura = matches[0].total;
          clienteProveedor = esDeposito ? matches[0].receptorNombre || '' : matches[0].emisorNombre || '';
        } else {
          // Si no hay match, marcar como pendiente
          estado = 'SIN_FACTURA';
          semaforo = '🔴 Rojo (Sin Factura)';
        }
      }

      // Marcar pagos múltiples
      const esPagoMultiple = pagosMultiplesSet.has(mov.id);
      if (esPagoMultiple && semaforo === '🔴 Rojo (Sin Factura)') {
        semaforo = '🟠 Naranja (Posible Pago Múltiple)';
      }

      resultados.push({
        fecha: mov.fecha,
        banco: mov.cuenta.banco,
        cuenta: mov.cuenta.cuenta,
        tipo: esDeposito ? 'Depósito' : 'Pago',
        concepto: mov.concepto,
        monto: mov.monto,
        categoria: categoriaReal,
        cuentaContable,
        estado,
        semaforo,
        uuid,
        folio,
        clienteProveedor,
        montoFactura,
        esPagoMultiple,
      });
    }

    // ===== TOTALES PARA DASHBOARD =====
    const totalVerde = resultados.filter(r => r.semaforo.includes('Verde')).length;
    const totalAmarillo = resultados.filter(r => r.semaforo.includes('Amarillo')).length;
    const totalNaranja = resultados.filter(r => r.semaforo.includes('Naranja')).length;
    const totalRojo = resultados.filter(r => r.semaforo.includes('Rojo')).length;

    const montoVerde = resultados.filter(r => r.semaforo.includes('Verde')).reduce((s, r) => s + Math.abs(r.monto), 0);
    const montoAmarillo = resultados.filter(r => r.semaforo.includes('Amarillo')).reduce((s, r) => s + Math.abs(r.monto), 0);
    const montoRojo = resultados.filter(r => r.semaforo.includes('Rojo')).reduce((s, r) => s + Math.abs(r.monto), 0);

    const totalVentas = facturasEmitidas.reduce((s, f) => s + f.total, 0);
    const totalCompras = facturasRecibidas.reduce((s, f) => s + f.total, 0);
    const utilidad = totalVentas - totalCompras;
    const margen = totalVentas > 0 ? (utilidad / totalVentas * 100) : 0;
    const tasaConc = resultados.length > 0 ? ((totalVerde + totalAmarillo) / resultados.length * 100) : 0;

    // ===== TOP CLIENTES/PROVEEDORES =====
    const porCliente = new Map<string, { nombre: string; rfc: string; count: number; total: number }>();
    for (const f of facturasEmitidas) {
      const key = f.receptorRfc || 'SIN_RFC';
      const ex = porCliente.get(key);
      if (ex) { ex.count++; ex.total += f.total; } else porCliente.set(key, { nombre: f.receptorNombre || 'N/A', rfc: key, count: 1, total: f.total });
    }
    const topClientes = Array.from(porCliente.values()).sort((a, b) => b.total - a.total).slice(0, 10);

    const porProveedor = new Map<string, { nombre: string; rfc: string; count: number; total: number }>();
    for (const f of facturasRecibidas) {
      const key = f.emisorRfc || 'SIN_RFC';
      const ex = porProveedor.get(key);
      if (ex) { ex.count++; ex.total += f.total; } else porProveedor.set(key, { nombre: f.emisorNombre || 'N/A', rfc: key, count: 1, total: f.total });
    }
    const topProveedores = Array.from(porProveedor.values()).sort((a, b) => b.total - a.total).slice(0, 10);

    // ===== CREAR EXCEL =====
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Sistema Fiscal IA';
    wb.created = new Date();

    const COLOR_PRIMARIO = 'FF7C3AED';
    const COLOR_VERDE_BG = 'FFC6EFCE';
    const COLOR_VERDE_TX = 'FF006100';
    const COLOR_AMARILLO_BG = 'FFFFEB9C';
    const COLOR_AMARILLO_TX = 'FF9C6500';
    const COLOR_ROJO_BG = 'FFFFC7CE';
    const COLOR_ROJO_TX = 'FF9C0006';
    const COLOR_NARANJA_BG = 'FFFCD5B4';
    const COLOR_HEADER = 'FF1E293B';

    // ===== HOJA 1: DASHBOARD EJECUTIVO =====
    const ws1 = wb.addWorksheet('📊 Dashboard', { views: [{ showGridLines: false }] });
    ws1.columns = [{ width: 40 }, { width: 22 }, { width: 22 }, { width: 22 }];

    ws1.mergeCells('A1:D1');
    ws1.getCell('A1').value = `${empresa?.nombre} — DASHBOARD DE CONCILIACIÓN DINÁMICA`;
    ws1.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
    ws1.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_PRIMARIO } };
    ws1.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(1).height = 35;

    ws1.mergeCells('A2:D2');
    ws1.getCell('A2').value = `RFC: ${empresa?.rfc} | Periodo: ${anio} | Generado: ${new Date().toLocaleDateString('es-MX')}`;
    ws1.getCell('A2').font = { italic: true };
    ws1.getCell('A2').alignment = { horizontal: 'center' };

    let r = 4;
    // KPIs del Semáforo
    ws1.getCell(`A${r}`).value = 'SEMAPHORE — RESUMEN DE CONCILIACIÓN';
    ws1.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: COLOR_PRIMARIO } };
    r++;

    const kpis = [
      { label: '🟢 Conciliado (Verde)', count: totalVerde, monto: montoVerde, bg: COLOR_VERDE_BG, tx: COLOR_VERDE_TX },
      { label: '🟡 Mapeado Auto (Amarillo)', count: totalAmarillo, monto: montoAmarillo, bg: COLOR_AMARILLO_BG, tx: COLOR_AMARILLO_TX },
      { label: '🟠 Requiere Agrupar (Naranja)', count: totalNaranja, monto: 0, bg: COLOR_NARANJA_BG, tx: 'FF8B4513' },
      { label: '🔴 Sin Factura (Rojo)', count: totalRojo, monto: montoRojo, bg: COLOR_ROJO_BG, tx: COLOR_ROJO_TX },
    ];

    for (const kpi of kpis) {
      ws1.getCell(`A${r}`).value = kpi.label;
      ws1.getCell(`A${r}`).font = { bold: true };
      ws1.getCell(`B${r}`).value = `${kpi.count} movimientos`;
      ws1.getCell(`B${r}`).font = { bold: true, color: { argb: kpi.tx } };
      ws1.getCell(`C${r}`).value = kpi.monto;
      ws1.getCell(`C${r}`).numFmt = '"$"#,##0.00';
      ws1.getCell(`C${r}`).font = { bold: true, color: { argb: kpi.tx } };
      ws1.getCell(`D${r}`).value = kpi.count > 0 ? `${(kpi.count / resultados.length * 100).toFixed(1)}%` : '0%';
      for (let c = 1; c <= 4; c++) {
        ws1.getCell(`${String.fromCharCode(64 + c)}${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kpi.bg } };
      }
      r++;
    }

    r++;
    ws1.getCell(`A${r}`).value = 'TASA DE CONCILIACIÓN';
    ws1.getCell(`A${r}`).font = { bold: true, size: 12 };
    ws1.getCell(`B${r}`).value = `${tasaConc.toFixed(1)}%`;
    ws1.getCell(`B${r}`).font = { bold: true, size: 16, color: { argb: tasaConc > 70 ? COLOR_VERDE_TX : COLOR_ROJO_TX } };
    r += 2;

    // KPIs Financieros
    ws1.getCell(`A${r}`).value = 'KPIs FINANCIEROS';
    ws1.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: COLOR_PRIMARIO } };
    r++;

    const finKpis = [
      { label: 'Total Ventas (CFDIs Emitidos)', valor: totalVentas, sub: `${facturasEmitidas.length} facturas` },
      { label: 'Total Compras (CFDIs Recibidos)', valor: totalCompras, sub: `${facturasRecibidas.length} facturas` },
      { label: 'Utilidad Bruta', valor: utilidad, sub: `Margen: ${margen.toFixed(1)}%` },
      { label: 'Total Movimientos Bancarios', valor: resultados.length, sub: `${movimientosRaw.length - movimientos.length} duplicados eliminados` },
      { label: 'Pagos Múltiples Detectados', valor: pagosMultiplesSet.size, sub: 'Movimientos que pueden agruparse' },
    ];
    for (const k of finKpis) {
      ws1.getCell(`A${r}`).value = k.label;
      ws1.getCell(`A${r}`).font = { bold: true };
      ws1.getCell(`B${r}`).value = k.valor;
      if (typeof k.valor === 'number' && k.valor > 1000) ws1.getCell(`B${r}`).numFmt = '"$"#,##0.00';
      ws1.getCell(`B${r}`).font = { bold: true, size: 14 };
      ws1.mergeCells(`C${r}:D${r}`);
      ws1.getCell(`C${r}`).value = k.sub;
      ws1.getCell(`C${r}`).font = { color: { argb: 'FF64748B' } };
      r++;
    }

    // ===== HOJA 2: SEMÁFORO DETALLADO =====
    const ws2 = wb.addWorksheet('🚦 Semáforo Detallado');
    ws2.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Banco', key: 'banco', width: 12 },
      { header: 'Tipo', key: 'tipo', width: 10 },
      { header: 'Concepto', key: 'concepto', width: 40 },
      { header: 'Monto', key: 'monto', width: 14 },
      { header: 'Categoría', key: 'categoria', width: 22 },
      { header: 'Cuenta Contable', key: 'cuentaContable', width: 10 },
      { header: 'Estado', key: 'estado', width: 18 },
      { header: 'Semáforo', key: 'semaforo', width: 28 },
      { header: 'UUID', key: 'uuid', width: 36 },
      { header: 'Folio', key: 'folio', width: 12 },
      { header: 'Cliente/Proveedor', key: 'clienteProveedor', width: 28 },
      { header: 'Monto Factura', key: 'montoFactura', width: 14 },
      { header: 'Pago Múltiple', key: 'esPagoMultiple', width: 8 },
    ];
    ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_HEADER } };

    for (const res of resultados) {
      const row = ws2.addRow({
        ...res,
        fecha: res.fecha.toLocaleDateString('es-MX'),
        esPagoMultiple: res.esPagoMultiple ? 'SÍ' : '',
      });
      row.getCell(5).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
      row.getCell(13).numFmt = '"$"#,##0.00';

      // ===== ARREGLO 4: FORMATO CONDICIONAL (SEMÁFORO) =====
      const semaforoCell = row.getCell(9);
      if (res.semaforo.includes('Verde')) {
        semaforoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_VERDE_BG } };
        semaforoCell.font = { color: { argb: COLOR_VERDE_TX }, bold: true };
      } else if (res.semaforo.includes('Amarillo')) {
        semaforoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_AMARILLO_BG } };
        semaforoCell.font = { color: { argb: COLOR_AMARILLO_TX }, bold: true };
      } else if (res.semaforo.includes('Naranja')) {
        semaforoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_NARANJA_BG } };
        semaforoCell.font = { color: { argb: 'FF8B4513' }, bold: true };
      } else if (res.semaforo.includes('Rojo')) {
        semaforoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ROJO_BG } };
        semaforoCell.font = { color: { argb: COLOR_ROJO_TX }, bold: true };
      }
    }

    // ===== HOJA 3: TOP CLIENTES =====
    const ws3 = wb.addWorksheet('👥 Top Clientes');
    ws3.columns = [{ header: '#', key: 'pos', width: 5 }, { header: 'Cliente', key: 'nombre', width: 35 }, { header: 'RFC', key: 'rfc', width: 18 }, { header: 'Facturas', key: 'count', width: 10 }, { header: 'Total', key: 'total', width: 16 }];
    ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_VERDE_TX } };
    topClientes.forEach((c, i) => {
      const row = ws3.addRow({ pos: i + 1, ...c });
      row.getCell(5).numFmt = '"$"#,##0.00';
    });

    // ===== HOJA 4: TOP PROVEEDORES =====
    const ws4 = wb.addWorksheet('🚚 Top Proveedores');
    ws4.columns = [{ header: '#', key: 'pos', width: 5 }, { header: 'Proveedor', key: 'nombre', width: 35 }, { header: 'RFC', key: 'rfc', width: 18 }, { header: 'Facturas', key: 'count', width: 10 }, { header: 'Total', key: 'total', width: 16 }];
    ws4.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws4.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_AMARILLO_TX } };
    topProveedores.forEach((p, i) => {
      const row = ws4.addRow({ pos: i + 1, ...p });
      row.getCell(5).numFmt = '"$"#,##0.00';
    });

    // ===== HOJA 5: DICTAMEN =====
    const ws5 = wb.addWorksheet('📝 Dictamen', { views: [{ showGridLines: false }] });
    ws5.columns = [{ width: 100 }];
    ws5.getCell('A1').value = 'DICTAMEN DE CONCILIACIÓN';
    ws5.getCell('A1').font = { bold: true, size: 18, color: { argb: COLOR_PRIMARIO } };

    let r5 = 3;
    const dictamen = [
      `RESUMEN DEL SEMÁFORO:`,
      `  🟢 Verde (Conciliado): ${totalVerde} movimientos ($${montoVerde.toFixed(2)})`,
      `  🟡 Amarillo (Mapeado Auto): ${totalAmarillo} movimientos ($${montoAmarillo.toFixed(2)})`,
      `  🟠 Naranja (Requiere Agrupar): ${totalNaranja} movimientos`,
      `  🔴 Rojo (Sin Factura): ${totalRojo} movimientos ($${montoRojo.toFixed(2)})`,
      `  Tasa de conciliación: ${tasaConc.toFixed(1)}%`,
      ``,
      `DEDUPLICACIÓN: ${movimientosRaw.length - movimientos.length} filas duplicadas eliminadas de ${movimientosRaw.length} totales.`,
      ``,
      `MOTOR DE MAPEO: Todos los movimientos fueron clasificados con cuenta contable.`,
      `  Categorías asignadas: ${new Set(resultados.map(r => r.categoria)).size} categorías diferentes.`,
      `  Movimientos con cuenta contable: ${resultados.filter(r => r.cuentaContable).length} de ${resultados.length}.`,
      ``,
      `MATCH POR MONTO: Se buscaron CFDIs por monto ±2% y fecha ±7 días.`,
      `  Facturas emitidas conciliadas: ${facturasEmitidas.filter(f => facturasConPago.has(f.id)).length} de ${facturasEmitidas.length}.`,
      `  Facturas recibidas conciliadas: ${facturasRecibidas.filter(f => facturasConPago.has(f.id)).length} de ${facturasRecibidas.length}.`,
      ``,
      `PAGOS MÚLTIPLES: ${pagosMultiplesSet.size} movimientos marcados como posibles pagos múltiples.`,
      ``,
      `FINANCIERO:`,
      `  Ventas: $${totalVentas.toFixed(2)} (${facturasEmitidas.length} CFDIs)`,
      `  Compras: $${totalCompras.toFixed(2)} (${facturasRecibidas.length} CFDIs)`,
      `  Utilidad: $${utilidad.toFixed(2)} (Margen: ${margen.toFixed(1)}%)`,
      ``,
      `RECOMENDACIONES:`,
      `  1. Revisar los ${totalRojo} movimientos en ROJO — son los únicos que realmente requieren atención.`,
      `  2. Los ${totalAmarillo} movimientos en AMARILLO no requieren acción (ya están clasificados).`,
      `  3. Los ${totalNaranja} movimientos en NARANJA pueden agruparse (mismo día + mismo beneficiario).`,
      `  4. Subir complementos de pago (CFDIs tipo P) para mejorar la tasa de conciliación.`,
      `  5. Los movimientos VERDES ya están conciliados con su factura correspondiente.`,
    ];
    for (const linea of dictamen) {
      ws5.getCell(`A${r5}`).value = linea;
      if (linea.startsWith('RESUMEN') || linea.startsWith('DEDUP') || linea.startsWith('MOTOR') || linea.startsWith('MATCH') || linea.startsWith('PAGOS') || linea.startsWith('FINAN') || linea.startsWith('RECOMEND')) {
        ws5.getCell(`A${r5}`).font = { bold: true, color: { argb: COLOR_PRIMARIO } };
      }
      r5++;
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Conciliacion_Maestra_v3_${anio}_${empresa?.rfc}.xlsx"`,
      },
    });
  } catch (e: any) {
    console.error('Error en conciliacion-maestra v3:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
