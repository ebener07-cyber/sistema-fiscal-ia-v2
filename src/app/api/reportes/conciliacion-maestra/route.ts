import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';
import { mapearMovimiento, detectarPagosMultiples } from '@/lib/agentes/conciliador-inteligente';

/**
 * GET /api/reportes/conciliacion-maestra?empresaId=xxx&anio=2026
 *
 * CONCILIACIÓN MAESTRA v4 — Sin huecos negros
 *
 * 3 Correcciones aplicadas:
 * 1. MATCH MÚLTIPLE DESGLOSADO: Cuando hay múltiples facturas similares,
 *    muestra TODOS los UUIDs separados por coma (no solo "3 facturas similares")
 * 2. RECATEGORIZACIÓN: Todos los falsos SIN_FACTURA (TANIA, GORDO, JUCA, VIÁTICOS)
 *    se mueven a "Anticipo Nómina / Caja Chica" (amarillo)
 * 3. DEDUPLICACIÓN DE INVERSIÓN: Si un movimiento aparece en Banorte Y Banorte Inversión,
 *    se marca el de Inversión como "Traspaso Interno (No Deducible)" y no se cuenta doble
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOL_MONTO = 0.02;
const TOL_FECHA = 7;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const anio = parseInt(searchParams.get('anio') ?? '2026');
    const empresaId = searchParams.get('empresaId');
    if (!empresaId) return NextResponse.json({ error: 'empresaId requerido' }, { status: 400 });

    const inicioAnio = new Date(anio, 0, 1);
    const finAnio = new Date(anio, 11, 31, 23, 59, 59);

    const empresa = await db.empresa.findUnique({ where: { id: empresaId }, select: { nombre: true, rfc: true } });

    const [movimientosRaw, facturasEmitidas, facturasRecibidas] = await Promise.all([
      db.movimientoBanco.findMany({
        where: { cuenta: { empresaId }, fecha: { gte: inicioAnio, lte: finAnio } },
        include: {
          cuenta: { select: { banco: true, cuenta: true, tipo: true } },
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

    // ===== ARREGLO 3: DEDUPLICACIÓN + FILTRADO DE INVERSIÓN =====
    const vistos = new Set<string>();
    const movimientos = movimientosRaw.filter(mov => {
      const key = `${mov.fecha.toISOString().slice(0,10)}|${mov.concepto.slice(0,50)}|${mov.monto.toFixed(2)}`;
      if (vistos.has(key)) return false;
      vistos.add(key);
      return true;
    });

    const pagosMultiplesSet = detectarPagosMultiples(movimientos.map(m => ({ id: m.id, fecha: m.fecha, concepto: m.concepto, monto: m.monto })));

    // ===== PROCESAR CADA MOVIMIENTO =====
    const facturasConPago = new Set<string>();
    const resultados: any[] = [];

    for (const mov of movimientos) {
      const esDeposito = mov.monto > 0;
      const montoAbs = Math.abs(mov.monto);
      const esInversion = mov.cuenta.tipo === 'inversion' || mov.cuenta.banco.includes('Inversión');

      // Motor de mapeo
      const mapeo = mapearMovimiento(mov.concepto, mov.monto);

      let estado = 'SIN_FACTURA';
      let semaforo = '🔴 Pendiente (Falta Ticket/Factura)';
      let uuid = '';
      let uuidsDesglosados = '';
      let folio = '';
      let foliosDesglosados = '';
      let clienteProveedor = '';
      let montoFactura = 0;
      let categoriaReal = mapeo.categoria;

      // Si es cuenta de inversión, marcar como traspaso interno
      if (esInversion) {
        estado = 'NO_REQUIERE';
        semaforo = '⚪ Bancario / Fiscal (Inversión)';
        categoriaReal = 'Traspaso Interno (Inversión)';
      }
      // Si ya tiene factura conciliada
      else if (mov.facturaConciliadaId && mov.facturaConciliada) {
        estado = 'CONCILIADO';
        semaforo = '🟢 Cuadrado';
        uuid = mov.facturaConciliada.uuid || '';
        uuidsDesglosados = uuid;
        folio = `${mov.facturaConciliada.serie || ''}${mov.facturaConciliada.folio}`;
        foliosDesglosados = folio;
        clienteProveedor = esDeposito ? mov.facturaConciliada.receptorNombre || '' : mov.facturaConciliada.emisorNombre || '';
        montoFactura = mov.facturaConciliada.total;
        facturasConPago.add(mov.facturaConciliadaId);
        categoriaReal = 'CONCILIADO (Por UUID/SPEI)';
      }
      // Si el motor dice que NO requiere CFDI
      else if (!mapeo.requiereCfdi) {
        estado = 'NO_REQUIERE';
        semaforo = '🟡 Mapeado (Interno)';
        categoriaReal = mapeo.categoria;
      }
      else {
        // Buscar facturas por monto ±2% + fecha ±7 días
        const facturas = esDeposito ? facturasEmitidas : facturasRecibidas;
        const matches = facturas.filter(f => {
          if (f.total < montoAbs * (1 - TOL_MONTO) || f.total > montoAbs * (1 + TOL_MONTO)) return false;
          return Math.abs(f.fecha.getTime() - mov.fecha.getTime()) / 86400000 <= TOL_FECHA;
        });

        if (matches.length === 1) {
          estado = 'CONCILIADO';
          semaforo = '🟢 Cuadrado';
          uuid = matches[0].uuid || '';
          uuidsDesglosados = uuid;
          folio = `${matches[0].serie || ''}${matches[0].folio}`;
          foliosDesglosados = folio;
          clienteProveedor = esDeposito ? matches[0].receptorNombre || '' : matches[0].emisorNombre || '';
          montoFactura = matches[0].total;
          facturasConPago.add(matches[0].id);
          categoriaReal = 'CONCILIADO (Por Monto)';
        }
        // ===== ARREGLO 1: MATCH MÚLTIPLE DESGLOSADO =====
        else if (matches.length > 1) {
          // Desglosar TODOS los UUIDs y folios
          uuidsDesglosados = matches.map(m => m.uuid || '').filter(Boolean).join(', ');
          foliosDesglosados = matches.map(m => `${m.serie || ''}${m.folio}`).join(', ');
          clienteProveedor = esDeposito ? matches[0].receptorNombre || '' : matches[0].emisorNombre || '';
          montoFactura = matches.reduce((s, m) => s + m.total, 0);

          // Verificar si la SUMA de las facturas coincide con el monto del banco
          const sumaFacturas = matches.reduce((s, m) => s + m.total, 0);
          if (Math.abs(sumaFacturas - montoAbs) < montoAbs * 0.02) {
            estado = 'CONCILIADO_MULTIPLE';
            semaforo = '🟢 Cuadrado (Múltiple)';
            categoriaReal = 'CONCILIADO (Match Múltiple)';
            matches.forEach(m => facturasConPago.add(m.id));
          } else {
            estado = 'MULTIPLES';
            semaforo = '🟠 Naranja (Requiere Agrupar)';
          }
        } else {
          estado = 'SIN_FACTURA';
          semaforo = '🔴 Pendiente (Falta Ticket/Factura)';
        }
      }

      const esPagoMultiple = pagosMultiplesSet.has(mov.id);
      if (esPagoMultiple && semaforo.includes('Rojo')) {
        semaforo = '🟠 Naranja (Posible Pago Múltiple)';
      }

      resultados.push({
        fecha: mov.fecha,
        banco: mov.cuenta.banco,
        tipo: esDeposito ? 'Depósito' : 'Pago',
        concepto: mov.concepto,
        monto: mov.monto,
        categoria: categoriaReal,
        cuentaContable: mapeo.cuentaContable,
        estado,
        semaforo,
        uuid,
        uuidsDesglosados,
        folio,
        foliosDesglosados,
        clienteProveedor,
        montoFactura,
        esPagoMultiple,
      });
    }

    // ===== TOTALES =====
    const totalVerde = resultados.filter(r => r.semaforo.includes('Cuadrado')).length;
    const totalAmarillo = resultados.filter(r => r.semaforo.includes('Mapeado')).length;
    const totalNaranja = resultados.filter(r => r.semaforo.includes('Naranja')).length;
    const totalRojo = resultados.filter(r => r.semaforo.includes('Pendiente')).length;
    const totalBlanco = resultados.filter(r => r.semaforo.includes('Bancario')).length;

    const montoVerde = resultados.filter(r => r.semaforo.includes('Cuadrado')).reduce((s, r) => s + Math.abs(r.monto), 0);
    const montoAmarillo = resultados.filter(r => r.semaforo.includes('Mapeado')).reduce((s, r) => s + Math.abs(r.monto), 0);
    const montoRojo = resultados.filter(r => r.semaforo.includes('Pendiente')).reduce((s, r) => s + Math.abs(r.monto), 0);

    const totalVentas = facturasEmitidas.reduce((s, f) => s + f.total, 0);
    const totalCompras = facturasRecibidas.reduce((s, f) => s + f.total, 0);
    const utilidad = totalVentas - totalCompras;
    const margen = totalVentas > 0 ? (utilidad / totalVentas * 100) : 0;
    const tasaConc = resultados.length > 0 ? ((totalVerde + totalAmarillo + totalBlanco) / resultados.length * 100) : 0;

    // Top clientes/proveedores
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

    const PR = 'FF7C3AED', VG_BG = 'FFC6EFCE', VG_TX = 'FF006100', AM_BG = 'FFFFEB9C', AM_TX = 'FF9C6500';
    const RD_BG = 'FFFFC7CE', RD_TX = 'FF9C0006', NR_BG = 'FFFCD5B4', BL_BG = 'FFD9E1F2', HD = 'FF1E293B';

    // ===== HOJA 1: DASHBOARD =====
    const ws1 = wb.addWorksheet('📊 Dashboard', { views: [{ showGridLines: false }] });
    ws1.columns = [{ width: 45 }, { width: 22 }, { width: 22 }, { width: 22 }];
    ws1.mergeCells('A1:D1');
    ws1.getCell('A1').value = `${empresa?.nombre} — SISTEMA DE CONCILIACIÓN ERP`;
    ws1.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
    ws1.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PR } };
    ws1.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(1).height = 35;
    ws1.mergeCells('A2:D2');
    ws1.getCell('A2').value = `RFC: ${empresa?.rfc} | Periodo: ${anio} | Generado: ${new Date().toLocaleDateString('es-MX')}`;
    ws1.getCell('A2').font = { italic: true };
    ws1.getCell('A2').alignment = { horizontal: 'center' };

    let r = 4;
    ws1.getCell(`A${r}`).value = 'SEMAPHORE — RESUMEN DE CONCILIACIÓN';
    ws1.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: PR } };
    r++;

    const kpis = [
      { label: '🟢 Conciliado (CFDI Exacto + Múltiple)', count: totalVerde, monto: montoVerde, bg: VG_BG, tx: VG_TX },
      { label: '🟡 Mapeado (Caja Chica / Traspasos / Deuda)', count: totalAmarillo, monto: montoAmarillo, bg: AM_BG, tx: AM_TX },
      { label: '🟠 Requiere Agrupar (Pagos Múltiples)', count: totalNaranja, monto: 0, bg: NR_BG, tx: 'FF8B4513' },
      { label: '⚪ Bancario / Fiscal (Inversión)', count: totalBlanco, monto: 0, bg: BL_BG, tx: 'FF002060' },
      { label: '🔴 Pendiente (Falta Ticket/Factura)', count: totalRojo, monto: montoRojo, bg: RD_BG, tx: RD_TX },
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
      for (let c = 1; c <= 4; c++) ws1.getCell(`${String.fromCharCode(64 + c)}${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kpi.bg } };
      r++;
    }
    r++;
    ws1.getCell(`A${r}`).value = 'ÍNDICE DE EFICIENCIA';
    ws1.getCell(`A${r}`).font = { bold: true, size: 12 };
    ws1.getCell(`B${r}`).value = `${tasaConc.toFixed(1)}%`;
    ws1.getCell(`B${r}`).font = { bold: true, size: 18, color: { argb: tasaConc > 80 ? VG_TX : RD_TX } };
    r += 2;

    ws1.getCell(`A${r}`).value = 'KPIs FINANCIEROS';
    ws1.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: PR } };
    r++;
    const finKpis = [
      { label: 'Total Ventas (CFDIs Emitidos)', valor: totalVentas, sub: `${facturasEmitidas.length} facturas` },
      { label: 'Total Compras (CFDIs Recibidos)', valor: totalCompras, sub: `${facturasRecibidas.length} facturas` },
      { label: 'Utilidad Bruta', valor: utilidad, sub: `Margen: ${margen.toFixed(1)}%` },
      { label: 'Movimientos Bancarios', valor: resultados.length, sub: `${movimientosRaw.length - movimientos.length} duplicados eliminados` },
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

    // ===== HOJA 2: MATCH DETALLADO CON UUIDs DESGLOSADOS =====
    const ws2 = wb.addWorksheet('🔍 Match Detallado');
    ws2.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Banco', key: 'banco', width: 12 },
      { header: 'Tipo', key: 'tipo', width: 10 },
      { header: 'Concepto', key: 'concepto', width: 40 },
      { header: 'Monto', key: 'monto', width: 14 },
      { header: 'Categoría', key: 'categoria', width: 25 },
      { header: 'Cuenta Contable', key: 'cuentaContable', width: 10 },
      { header: 'Estado', key: 'estado', width: 18 },
      { header: 'Semáforo', key: 'semaforo', width: 30 },
      { header: 'UUIDs Desglosados', key: 'uuidsDesglosados', width: 50 },
      { header: 'Folios Desglosados', key: 'foliosDesglosados', width: 30 },
      { header: 'Cliente/Proveedor', key: 'clienteProveedor', width: 28 },
      { header: 'Monto Factura', key: 'montoFactura', width: 14 },
      { header: 'Pago Múltiple', key: 'esPagoMultiple', width: 8 },
    ];
    ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HD } };

    for (const res of resultados) {
      const row = ws2.addRow({
        ...res,
        fecha: res.fecha.toLocaleDateString('es-MX'),
        esPagoMultiple: res.esPagoMultiple ? 'SÍ' : '',
      });
      row.getCell(5).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
      row.getCell(13).numFmt = '"$"#,##0.00';

      // Formato condicional semáforo
      const cell = row.getCell(9);
      if (res.semaforo.includes('Cuadrado')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VG_BG } };
        cell.font = { color: { argb: VG_TX }, bold: true };
      } else if (res.semaforo.includes('Mapeado')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AM_BG } };
        cell.font = { color: { argb: AM_TX }, bold: true };
      } else if (res.semaforo.includes('Naranja')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NR_BG } };
        cell.font = { color: { argb: 'FF8B4513' }, bold: true };
      } else if (res.semaforo.includes('Bancario')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BL_BG } };
        cell.font = { color: { argb: 'FF002060' }, bold: true };
      } else if (res.semaforo.includes('Pendiente')) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RD_BG } };
        cell.font = { color: { argb: RD_TX }, bold: true };
      }
    }

    // ===== HOJA 3: TOP CLIENTES =====
    const ws3 = wb.addWorksheet('👥 Top Clientes');
    ws3.columns = [{ header: '#', key: 'pos', width: 5 }, { header: 'Cliente', key: 'nombre', width: 35 }, { header: 'RFC', key: 'rfc', width: 18 }, { header: 'Facturas', key: 'count', width: 10 }, { header: 'Total', key: 'total', width: 16 }];
    ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VG_TX } };
    topClientes.forEach((c, i) => { const row = ws3.addRow({ pos: i + 1, ...c }); row.getCell(5).numFmt = '"$"#,##0.00'; });

    // ===== HOJA 4: TOP PROVEEDORES =====
    const ws4 = wb.addWorksheet('🚚 Top Proveedores');
    ws4.columns = [{ header: '#', key: 'pos', width: 5 }, { header: 'Proveedor', key: 'nombre', width: 35 }, { header: 'RFC', key: 'rfc', width: 18 }, { header: 'Facturas', key: 'count', width: 10 }, { header: 'Total', key: 'total', width: 16 }];
    ws4.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws4.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AM_TX } };
    topProveedores.forEach((p, i) => { const row = ws4.addRow({ pos: i + 1, ...p }); row.getCell(5).numFmt = '"$"#,##0.00'; });

    // ===== HOJA 5: DICTAMEN =====
    const ws5 = wb.addWorksheet('📝 Dictamen', { views: [{ showGridLines: false }] });
    ws5.columns = [{ width: 100 }];
    ws5.getCell('A1').value = 'DICTAMEN DE CONCILIACIÓN';
    ws5.getCell('A1').font = { bold: true, size: 18, color: { argb: PR } };

    let r5 = 3;
    const dict = [
      `SEMAPHORE:`,
      `  🟢 Cuadrado: ${totalVerde} movs ($${montoVerde.toFixed(2)})`,
      `  🟡 Mapeado: ${totalAmarillo} movs ($${montoAmarillo.toFixed(2)})`,
      `  🟠 Naranja: ${totalNaranja} movs`,
      `  ⚪ Bancario: ${totalBlanco} movs`,
      `  🔴 Pendiente: ${totalRojo} movs ($${montoRojo.toFixed(2)})`,
      `  Índice de eficiencia: ${tasaConc.toFixed(1)}%`,
      ``,
      `DEDUPLICACIÓN: ${movimientosRaw.length - movimientos.length} filas duplicadas eliminadas.`,
      `CUENTA INVERSIÓN: ${totalBlanco} movimientos marcados como "Bancario / Fiscal (Inversión)" — no se cuentan como egresos.`,
      ``,
      `MATCH MÚLTIPLE: Los movimientos con múltiples facturas ahora muestran TODOS los UUIDs desglosados.`,
      `  Si la suma de facturas = monto del banco → 🟢 CONCILIADO_MULTIPLE`,
      `  Si no cuadra → 🟠 Requiere Agrupar (con UUIDs visibles para revisión)`,
      ``,
      `RECATEGORIZACIÓN: Los siguientes conceptos ya NO aparecen como "SIN_FACTURA":`,
      `  - SUPERVISION TANIA → Anticipo Nómina / Caja Chica (🟡)`,
      `  - REEMBOLSO GORDO / JUCA → Anticipo Nómina / Caja Chica (🟡)`,
      `  - VIÁTICOS / COMBUSTIBLES → Anticipo Nómina / Caja Chica (🟡)`,
      `  - TRASPASOS / RETIROS → Traspaso Interno (🟡)`,
      ``,
      `FINANCIERO:`,
      `  Ventas: $${totalVentas.toFixed(2)} | Compras: $${totalCompras.toFixed(2)} | Utilidad: $${utilidad.toFixed(2)} (${margen.toFixed(1)}%)`,
      ``,
      `RECOMENDACIONES:`,
      `  1. Solo los ${totalRojo} movimientos en ROJO requieren atención real.`,
      `  2. Los ${totalNaranja} en NARANJA tienen UUIDs desglosados — revisar si cuadran.`,
      `  3. Los ${totalAmarillo} en AMARILLO no requieren acción (caja chica, traspasos, deuda).`,
      `  4. Los ${totalBlanco} en BLANCO son de cuenta inversión (no deducibles).`,
    ];
    for (const l of dict) {
      ws5.getCell(`A${r5}`).value = l;
      if (l.startsWith('SEMAPHORE') || l.startsWith('DEDUP') || l.startsWith('CUENTA') || l.startsWith('MATCH') || l.startsWith('RECATE') || l.startsWith('FINAN') || l.startsWith('RECOMEND')) ws5.getCell(`A${r5}`).font = { bold: true, color: { argb: PR } };
      r5++;
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Conciliacion_Maestra_v4_${anio}_${empresa?.rfc}.xlsx"`,
      },
    });
  } catch (e: any) {
    console.error('Error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
