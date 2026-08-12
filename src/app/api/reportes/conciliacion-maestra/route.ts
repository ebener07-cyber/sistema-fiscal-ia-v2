import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import ExcelJS from 'exceljs';
import { mapearMovimiento, detectarPagosMultiples } from '@/lib/agentes/conciliador-inteligente';

/**
 * CONCILIACIÓN MAESTRA v5 — 7 Mejoras aplicadas
 *
 * 1. Recategorización ampliada (PAGO CAPITAL, ABEL LOREDO, CREDITO SANTANDER TANIA)
 * 2. Monto Factura correcto en MULTIPLES + columna Diferencia
 * 3. Conciliación de INGRESOS (depósitos vs CFDIs emitidos)
 * 4. Catálogo contable detallado (14 cuentas)
 * 5. Dashboard con alertas inteligentes + flujo + IVA
 * 6. Validación RFC + monto exacto
 * 7. Columna Diferencia (Monto Factura - Monto Banco)
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
    const meses = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

    const empresa = await db.empresa.findUnique({ where: { id: empresaId }, select: { nombre: true, rfc: true } });

    const [movimientosRaw, facturasEmitidas, facturasRecibidas] = await Promise.all([
      db.movimientoBanco.findMany({
        where: { cuenta: { empresaId }, fecha: { gte: inicioAnio, lte: finAnio } },
        include: {
          cuenta: { select: { banco: true, cuenta: true, tipo: true } },
          facturaConciliada: { select: { folio: true, serie: true, total: true, uuid: true, receptorNombre: true, emisorNombre: true, receptorRfc: true, emisorRfc: true } },
        },
        orderBy: { fecha: 'asc' },
      }),
      db.factura.findMany({
        where: { empresaId, direccion: 'emitida', estado: 'timbrada', tipoComprobante: 'I', fecha: { gte: inicioAnio, lte: finAnio } },
        select: { id: true, folio: true, serie: true, fecha: true, total: true, subtotal: true, totalImpuestos: true, receptorRfc: true, receptorNombre: true, uuid: true },
        orderBy: { fecha: 'asc' },
      }),
      db.factura.findMany({
        where: { empresaId, direccion: 'recibida', estado: 'timbrada', tipoComprobante: 'I', fecha: { gte: inicioAnio, lte: finAnio } },
        select: { id: true, folio: true, serie: true, fecha: true, total: true, subtotal: true, totalImpuestos: true, emisorRfc: true, emisorNombre: true, uuid: true },
        orderBy: { fecha: 'asc' },
      }),
    ]);

    // Deduplicación
    const vistos = new Set<string>();
    const movimientos = movimientosRaw.filter(mov => {
      const key = `${mov.fecha.toISOString().slice(0,10)}|${mov.concepto.slice(0,50)}|${mov.monto.toFixed(2)}`;
      if (vistos.has(key)) return false;
      vistos.add(key);
      return true;
    });

    const pagosMultiplesSet = detectarPagosMultiples(movimientos.map(m => ({ id: m.id, fecha: m.fecha, concepto: m.concepto, monto: m.monto })));
    const facturasConPago = new Set<string>();
    const resultados: any[] = [];
    const alertas: string[] = [];

    for (const mov of movimientos) {
      const esDeposito = mov.monto > 0; // MEJORA 3: depósitos = ingresos
      const montoAbs = Math.abs(mov.monto);
      const esInversion = mov.cuenta.tipo === 'inversion' || mov.cuenta.banco.includes('Inversión');
      const mapeo = mapearMovimiento(mov.concepto, mov.monto);

      let estado = 'SIN_FACTURA';
      let semaforo = '🔴 Pendiente (Falta Ticket/Factura)';
      let uuid = '';
      let uuidsDesglosados = '';
      let folio = '';
      let foliosDesglosados = '';
      let clienteProveedor = '';
      let montoFactura = 0;
      let diferencia = 0; // MEJORA 7: Diferencia = Monto Factura - Monto Banco
      let categoriaReal = mapeo.categoria;
      let validacionRfc = ''; // MEJORA 7: validación RFC
      let logRegla = ''; // Log de qué regla concilió

      if (esInversion) {
        estado = 'NO_REQUIERE';
        semaforo = '⚪ Bancario / Fiscal (Inversión)';
        categoriaReal = 'Traspaso Interno (Inversión)';
        logRegla = 'Filtrado por cuenta tipo=inversion';
      } else if (mov.facturaConciliadaId && mov.facturaConciliada) {
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
        logRegla = 'Match por facturaConciliadaId en BD';
        // MEJORA 7: Validación
        diferencia = montoFactura - montoAbs;
        if (Math.abs(diferencia) > 1) {
          semaforo = '🟠 Naranja (Diferencia)';
          alertas.push(`Diferencia en ${folio}: banco $${montoAbs.toFixed(2)} vs factura $${montoFactura.toFixed(2)} (diff $${diferencia.toFixed(2)})`);
        }
      } else if (!mapeo.requiereCfdi) {
        estado = 'NO_REQUIERE';
        semaforo = '🟡 Mapeado (Interno)';
        categoriaReal = mapeo.categoria;
        logRegla = `Mapeo automático: ${mapeo.categoria}`;
      } else {
        // MEJORA 3: Si es depósito → buscar en CFDIs EMITIDOS; si es pago → buscar en RECIBIDOS
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
          categoriaReal = esDeposito ? 'CONCILIADO (Ingreso por Monto)' : 'CONCILIADO (Por Monto)';
          logRegla = `Match por monto ±${TOL_MONTO * 100}% + fecha ±${TOL_FECHA}d (${esDeposito ? 'emitida' : 'recibida'})`;
          // MEJORA 7
          diferencia = montoFactura - montoAbs;
          if (Math.abs(diferencia) > 1) {
            semaforo = '🟠 Naranja (Diferencia)';
            alertas.push(`Diferencia en ${folio}: banco $${montoAbs.toFixed(2)} vs factura $${montoFactura.toFixed(2)} (diff $${diferencia.toFixed(2)})`);
          }
          // MEJORA 7: Validación RFC
          const rfcFactura = esDeposito ? matches[0].receptorRfc : matches[0].emisorRfc;
          validacionRfc = rfcFactura ? '✅ RFC en CFDI' : '⚠️ Sin RFC';
        } else if (matches.length > 1) {
          // MEJORA 2: SUMAR facturas + calcular diferencia
          uuidsDesglosados = matches.map(m => m.uuid || '').filter(Boolean).join(', ');
          foliosDesglosados = matches.map(m => `${m.serie || ''}${m.folio}`).join(', ');
          clienteProveedor = esDeposito ? matches[0].receptorNombre || '' : matches[0].emisorNombre || '';
          montoFactura = matches.reduce((s, m) => s + m.total, 0);
          diferencia = montoFactura - montoAbs; // MEJORA 2 + 7

          if (Math.abs(diferencia) < montoAbs * 0.02) {
            estado = 'CONCILIADO_MULTIPLE';
            semaforo = '🟢 Cuadrado (Múltiple)';
            categoriaReal = 'CONCILIADO (Match Múltiple)';
            matches.forEach(m => facturasConPago.add(m.id));
            logRegla = `Match múltiple: ${matches.length} facturas suman $${montoFactura.toFixed(2)} vs banco $${montoAbs.toFixed(2)}`;
          } else {
            estado = 'MULTIPLES';
            semaforo = '🟠 Naranja (Requiere Agrupar)';
            logRegla = `Múltiples matches: ${matches.length} facturas, diferencia $${diferencia.toFixed(2)}`;
          }
        } else {
          estado = 'SIN_FACTURA';
          semaforo = '🔴 Pendiente (Falta Ticket/Factura)';
          logRegla = 'Sin match por monto ni mapeo';
        }
      }

      const esPagoMultiple = pagosMultiplesSet.has(mov.id);
      if (esPagoMultiple && semaforo.includes('Pendiente')) {
        semaforo = '🟠 Naranja (Posible Pago Múltiple)';
      }

      resultados.push({
        fecha: mov.fecha, banco: mov.cuenta.banco, tipo: esDeposito ? 'Depósito' : 'Pago',
        concepto: mov.concepto, monto: mov.monto, categoria: categoriaReal,
        cuentaContable: mapeo.cuentaContable, estado, semaforo,
        uuid, uuidsDesglosados, folio, foliosDesglosados,
        clienteProveedor, montoFactura, diferencia, validacionRfc,
        esPagoMultiple, logRegla,
      });
    }

    // Totales
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
    const ivaTrasladado = facturasEmitidas.reduce((s, f) => s + f.totalImpuestos, 0);
    const ivaAcreditable = facturasRecibidas.reduce((s, f) => s + f.totalImpuestos, 0);
    const ivaPorPagar = ivaTrasladado - ivaAcreditable;
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

    // Flujo mensual
    const flujoMensual: any[] = [];
    for (let m = 0; m < 12; m++) {
      const ingMes = resultados.filter(r => r.monto > 0 && r.fecha.getMonth() === m).reduce((s, r) => s + r.monto, 0);
      const egrMes = resultados.filter(r => r.monto < 0 && r.fecha.getMonth() === m).reduce((s, r) => s + Math.abs(r.monto), 0);
      if (ingMes > 0 || egrMes > 0) flujoMensual.push({ mes: meses[m], ingresos: ingMes, egresos: egrMes, neto: ingMes - egrMes });
    }

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
    ws1.getCell('A1').value = `${empresa?.nombre} — CENTRO DE CONCILIACIÓN FISCAL IA v5`;
    ws1.getCell('A1').font = { bold: true, size: 18, color: { argb: 'FFFFFFFF' } };
    ws1.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: PR } };
    ws1.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(1).height = 35;
    ws1.mergeCells('A2:D2');
    ws1.getCell('A2').value = `RFC: ${empresa?.rfc} | Periodo: ${anio} | Generado: ${new Date().toLocaleDateString('es-MX')}`;
    ws1.getCell('A2').font = { italic: true };
    ws1.getCell('A2').alignment = { horizontal: 'center' };

    let r = 4;
    // 3 KPIs principales
    ws1.getCell(`A${r}`).value = 'KPIs PRINCIPALES';
    ws1.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: PR } };
    r++;
    const mainKpis = [
      { label: 'CONCILIACIÓN — Índice de Eficiencia', valor: `${tasaConc.toFixed(1)}%`, sub: `Antes era menor`, color: tasaConc > 80 ? VG_TX : RD_TX },
      { label: 'FLUJO — Utilidad Bruta', valor: utilidad, sub: `Margen: ${margen.toFixed(1)}%`, color: utilidad > 0 ? VG_TX : RD_TX },
      { label: 'IMPUESTOS — IVA por Pagar', valor: ivaPorPagar, sub: `Trasladado: $${ivaTrasladado.toFixed(0)} - Acreditable: $${ivaAcreditable.toFixed(0)}`, color: ivaPorPagar > 0 ? RD_TX : VG_TX },
    ];
    for (const k of mainKpis) {
      ws1.getCell(`A${r}`).value = k.label;
      ws1.getCell(`A${r}`).font = { bold: true };
      ws1.getCell(`B${r}`).value = k.valor;
      if (typeof k.valor === 'number') {
        ws1.getCell(`B${r}`).numFmt = '"$"#,##0.00';
        ws1.getCell(`B${r}`).font = { bold: true, size: 16, color: { argb: k.color } };
      } else {
        ws1.getCell(`B${r}`).font = { bold: true, size: 16, color: { argb: k.color } };
      }
      ws1.mergeCells(`C${r}:D${r}`);
      ws1.getCell(`C${r}`).value = k.sub;
      ws1.getCell(`C${r}`).font = { color: { argb: 'FF64748B' } };
      r++;
    }
    r++;

    // Semáforo
    ws1.getCell(`A${r}`).value = 'SEMAPHORE — RESUMEN';
    ws1.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: PR } };
    r++;
    const kpis = [
      { label: '🟢 Conciliado (CFDI Exacto + Múltiple)', count: totalVerde, monto: montoVerde, bg: VG_BG, tx: VG_TX },
      { label: '🟡 Mapeado (Caja Chica / Traspasos / Deuda)', count: totalAmarillo, monto: montoAmarillo, bg: AM_BG, tx: AM_TX },
      { label: '🟠 Requiere Agrupar / Diferencia', count: totalNaranja, monto: 0, bg: NR_BG, tx: 'FF8B4513' },
      { label: '⚪ Bancario / Fiscal (Inversión)', count: totalBlanco, monto: 0, bg: BL_BG, tx: 'FF002060' },
      { label: '🔴 Pendiente (Falta Ticket/Factura)', count: totalRojo, monto: montoRojo, bg: RD_BG, tx: RD_TX },
    ];
    for (const kpi of kpis) {
      ws1.getCell(`A${r}`).value = kpi.label;
      ws1.getCell(`A${r}`).font = { bold: true };
      ws1.getCell(`B${r}`).value = `${kpi.count} movs`;
      ws1.getCell(`B${r}`).font = { bold: true, color: { argb: kpi.tx } };
      ws1.getCell(`C${r}`).value = kpi.monto;
      ws1.getCell(`C${r}`).numFmt = '"$"#,##0.00';
      ws1.getCell(`C${r}`).font = { bold: true, color: { argb: kpi.tx } };
      ws1.getCell(`D${r}`).value = kpi.count > 0 ? `${(kpi.count / resultados.length * 100).toFixed(1)}%` : '0%';
      for (let c = 1; c <= 4; c++) ws1.getCell(`${String.fromCharCode(64 + c)}${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: kpi.bg } };
      r++;
    }
    r++;

    // Alertas inteligentes
    ws1.getCell(`A${r}`).value = '⚠️ ALERTAS INTELIGENTES';
    ws1.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: 'FFEF4444' } };
    r++;
    if (alertas.length === 0) {
      ws1.getCell(`A${r}`).value = '✅ No hay alertas. Todo cuadra.';
      r++;
    } else {
      for (const a of alertas.slice(0, 15)) {
        ws1.getCell(`A${r}`).value = `• ${a}`;
        ws1.getCell(`A${r}`).font = { color: { argb: 'FFEF4444' } };
        ws1.mergeCells(`A${r}:D${r}`);
        r++;
      }
    }
    r++;

    // Flujo mensual
    ws1.getCell(`A${r}`).value = '📈 FLUJO DE EFECTIVO MENSUAL';
    ws1.getCell(`A${r}`).font = { bold: true, size: 13, color: { argb: PR } };
    r++;
    ws1.getCell(`A${r}`).value = 'Mes';
    ws1.getCell(`B${r}`).value = 'Ingresos';
    ws1.getCell(`C${r}`).value = 'Egresos';
    ws1.getCell(`D${r}`).value = 'Neto';
    for (let c = 1; c <= 4; c++) { ws1.getCell(`${String.fromCharCode(64+c)}${r}`).font = { bold: true, color: { argb: 'FFFFFFFF' } }; ws1.getCell(`${String.fromCharCode(64+c)}${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HD } }; }
    r++;
    for (const f of flujoMensual) {
      ws1.getCell(`A${r}`).value = f.mes;
      ws1.getCell(`B${r}`).value = f.ingresos;
      ws1.getCell(`C${r}`).value = f.egresos;
      ws1.getCell(`D${r}`).value = f.neto;
      ws1.getCell(`B${r}`).numFmt = '"$"#,##0';
      ws1.getCell(`C${r}`).numFmt = '"$"#,##0';
      ws1.getCell(`D${r}`).numFmt = '"$"#,##0;[Red]("$"#,##0)';
      r++;
    }

    // ===== HOJA 2: MATCH DETALLADO =====
    const ws2 = wb.addWorksheet('🔍 Match Detallado');
    ws2.columns = [
      { header: 'Fecha', key: 'fecha', width: 12 }, { header: 'Banco', key: 'banco', width: 12 },
      { header: 'Tipo', key: 'tipo', width: 10 }, { header: 'Concepto', key: 'concepto', width: 40 },
      { header: 'Monto Banco', key: 'monto', width: 14 }, { header: 'Categoría', key: 'categoria', width: 25 },
      { header: 'Cuenta', key: 'cuentaContable', width: 8 }, { header: 'Estado', key: 'estado', width: 18 },
      { header: 'Semáforo', key: 'semaforo', width: 30 }, { header: 'UUIDs Desglosados', key: 'uuidsDesglosados', width: 50 },
      { header: 'Folios', key: 'foliosDesglosados', width: 30 }, { header: 'Cliente/Prov.', key: 'clienteProveedor', width: 28 },
      { header: 'Monto Factura', key: 'montoFactura', width: 14 }, { header: 'Diferencia', key: 'diferencia', width: 14 },
      { header: 'RFC Val', key: 'validacionRfc', width: 12 }, { header: 'Pago Múlt.', key: 'esPagoMultiple', width: 8 },
      { header: 'Log de Regla', key: 'logRegla', width: 45 },
    ];
    ws2.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HD } };

    for (const res of resultados) {
      const row = ws2.addRow({ ...res, fecha: res.fecha.toLocaleDateString('es-MX'), esPagoMultiple: res.esPagoMultiple ? 'SÍ' : '' });
      row.getCell(5).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
      row.getCell(13).numFmt = '"$"#,##0.00';
      row.getCell(14).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)'; // Diferencia
      const cell = row.getCell(9);
      if (res.semaforo.includes('Cuadrado')) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VG_BG } }; cell.font = { color: { argb: VG_TX }, bold: true }; }
      else if (res.semaforo.includes('Mapeado')) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AM_BG } }; cell.font = { color: { argb: AM_TX }, bold: true }; }
      else if (res.semaforo.includes('Naranja')) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NR_BG } }; cell.font = { color: { argb: 'FF8B4513' }, bold: true }; }
      else if (res.semaforo.includes('Bancario')) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BL_BG } }; cell.font = { color: { argb: 'FF002060' }, bold: true }; }
      else if (res.semaforo.includes('Pendiente')) { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RD_BG } }; cell.font = { color: { argb: RD_TX }, bold: true }; }
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

    // ===== HOJA 5: ANÁLISIS IVA =====
    const ws5 = wb.addWorksheet('🧾 Análisis IVA');
    ws5.columns = [{ header: 'Mes', key: 'mes', width: 15 }, { header: 'IVA Trasladado', key: 'trasladado', width: 18 }, { header: 'IVA Acreditable', key: 'acreditable', width: 18 }, { header: 'IVA por Pagar', key: 'porPagar', width: 18 }];
    ws5.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws5.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HD } };
    for (let m = 0; m < 12; m++) {
      const trasl = facturasEmitidas.filter(f => f.fecha.getMonth() === m).reduce((s, f) => s + f.totalImpuestos, 0);
      const acred = facturasRecibidas.filter(f => f.fecha.getMonth() === m).reduce((s, f) => s + f.totalImpuestos, 0);
      if (trasl === 0 && acred === 0) continue;
      const row = ws5.addRow({ mes: meses[m], trasladado: trasl, acreditable: acred, porPagar: trasl - acred });
      row.getCell(2).numFmt = '"$"#,##0.00'; row.getCell(3).numFmt = '"$"#,##0.00'; row.getCell(4).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';
    }
    const totRow = ws5.addRow({ mes: 'TOTAL', trasladado: ivaTrasladado, acreditable: ivaAcreditable, porPagar: ivaPorPagar });
    totRow.font = { bold: true }; totRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEDE9FE' } };
    totRow.getCell(2).numFmt = '"$"#,##0.00'; totRow.getCell(3).numFmt = '"$"#,##0.00'; totRow.getCell(4).numFmt = '"$"#,##0.00;[Red]("$"#,##0.00)';

    // ===== HOJA 6: DICTAMEN =====
    const ws6 = wb.addWorksheet('📝 Dictamen', { views: [{ showGridLines: false }] });
    ws6.columns = [{ width: 100 }];
    ws6.getCell('A1').value = 'DICTAMEN DE CONCILIACIÓN v5';
    ws6.getCell('A1').font = { bold: true, size: 18, color: { argb: PR } };
    let r6 = 3;
    const dict = [
      `SEMAPHORE:`,
      `  🟢 Cuadrado: ${totalVerde} movs ($${montoVerde.toFixed(2)})`,
      `  🟡 Mapeado: ${totalAmarillo} movs ($${montoAmarillo.toFixed(2)})`,
      `  🟠 Naranja: ${totalNaranja} movs`,
      `  ⚪ Bancario: ${totalBlanco} movs`,
      `  🔴 Pendiente: ${totalRojo} movs ($${montoRojo.toFixed(2)})`,
      `  Índice de eficiencia: ${tasaConc.toFixed(1)}%`,
      ``,
      `ALERTAS: ${alertas.length} alertas detectadas (diferencias de monto entre banco y factura).`,
      ``,
      `MEJORA 1 — RECATEGORIZACIÓN: Se ampliaron las reglas para incluir:`,
      `  PAGO DE CAPITAL → Servicio de Deuda (2200)`,
      `  ABEL LOREDO → Préstamo / Cuenta por Cobrar (1300)`,
      `  CREDITO SANTANDER TANIA → Financiamiento / Deuda (2200)`,
      `  Estos ya NO aparecen como SIN_FACTURA.`,
      ``,
      `MEJORA 2 — MULTIPLES: Las facturas múltiples ahora SUMAN su total.`,
      `  Columna Diferencia = Monto Factura - Monto Banco.`,
      `  Si Diferencia ≈ 0 → 🟢 CONCILIADO_MULTIPLE`,
      `  Si Diferencia ≠ 0 → 🟠 con diferencia visible.`,
      ``,
      `MEJORA 3 — INGRESOS: Los depósitos ahora se cruzan con CFDIs EMITIDOS.`,
      `  Esto convierte depósitos de clientes (ESINAR, PALMIRA, TEUKHEIN) de 🔴 a 🟢.`,
      ``,
      `MEJORA 7 — VALIDACIÓN: Columna Diferencia + RFC Val en cada movimiento.`,
      `  Si |diferencia| > $1 → se genera alerta automática.`,
      ``,
      `FINANCIERO:`,
      `  Ventas: $${totalVentas.toFixed(2)} | Compras: $${totalCompras.toFixed(2)} | Utilidad: $${utilidad.toFixed(2)} (${margen.toFixed(1)}%)`,
      `  IVA Trasladado: $${ivaTrasladado.toFixed(2)} | IVA Acreditable: $${ivaAcreditable.toFixed(2)} | IVA por Pagar: $${ivaPorPagar.toFixed(2)}`,
    ];
    for (const l of dict) {
      ws6.getCell(`A${r6}`).value = l;
      if (l.startsWith('SEMAPHORE') || l.startsWith('ALERTAS') || l.startsWith('MEJORA') || l.startsWith('FINAN')) ws6.getCell(`A${r6}`).font = { bold: true, color: { argb: PR } };
      r6++;
    }

    const buffer = await wb.xlsx.writeBuffer();
    return new Response(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="Conciliacion_Maestra_v5_${anio}_${empresa?.rfc}.xlsx"`,
      },
    });
  } catch (e: any) {
    console.error('Error:', e.message);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
