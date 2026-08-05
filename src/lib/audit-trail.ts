import { db } from '@/lib/db';
import { maskPIIObject } from '@/lib/pii-mask';

/**
 * Helper para registrar entradas en el Audit Trail
 * Cada llamada a una tool de un agente IA debe registrarse aquí para trazabilidad
 *
 * IMPORTANTE: Antes de guardar input/output en BD, se enmascaran los PII
 * (RFC, números de cuenta, CLABE, emails, teléfonos) para protección de datos.
 */

export interface AuditTrailInput {
  agente: string; // 'rag-fiscal' | 'cfdi-validator' | 'erp-query' | 'red-team' | 'orchestrator' | 'maker' | 'checker' | 'categorizador' | 'conciliador-banco' | 'mcp-server'
  herramienta: string; // nombre de la tool
  input: any; // parámetros
  output?: any; // respuesta
  scoreConfianza?: number; // 0.0 a 1.0
  verificado?: boolean;
  observaciones?: string;
  empresaId?: string;
  usuarioId?: string;
  conversacionId?: string;
  duracionMs?: number;
  error?: string;
}

/**
 * Registra una entrada en el audit trail
 * Los campos input y output se enmascaran automáticamente para protección PII
 */
export async function registrarAuditTrail(datos: AuditTrailInput): Promise<string | null> {
  try {
    // Enmascarar PII en input y output antes de guardar
    const inputMasked = maskPIIObject(datos.input);
    const outputMasked = datos.output !== undefined ? maskPIIObject(datos.output) : null;

    const entrada = await db.auditTrail.create({
      data: {
        agente: datos.agente,
        herramienta: datos.herramienta,
        input: inputMasked,
        output: outputMasked,
        scoreConfianza: datos.scoreConfianza ?? 0,
        verificado: datos.verificado ?? false,
        observaciones: datos.observaciones ?? null,
        empresaId: datos.empresaId ?? null,
        usuarioId: datos.usuarioId ?? null,
        conversacionId: datos.conversacionId ?? null,
        duracionMs: datos.duracionMs ?? null,
        error: datos.error ?? null,
      },
    });
    return entrada.id;
  } catch (e: any) {
    console.error('Error registrando audit trail:', e.message);
    return null;
  }
}

/**
 * Marca una entrada como verificada por el checker
 */
export async function marcarVerificado(
  auditTrailId: string,
  scoreConfianza: number,
  observaciones: string,
  verificado: boolean = true,
): Promise<void> {
  try {
    await db.auditTrail.update({
      where: { id: auditTrailId },
      data: { verificado, scoreConfianza, observaciones },
    });
  } catch (e: any) {
    console.error('Error marcando audit trail verificado:', e.message);
  }
}

/**
 * Mide el tiempo de ejecución de una función y registra el audit trail
 * Aplica PII masking automáticamente al output
 */
export async function conAuditoria<T>(
  datos: Omit<AuditTrailInput, 'output' | 'duracionMs' | 'error'>,
  fn: () => Promise<T>,
): Promise<{ resultado: T; auditTrailId: string | null; duracionMs: number }> {
  const inicio = Date.now();
  let auditTrailId: string | null = null;
  try {
    const resultado = await fn();
    const duracionMs = Date.now() - inicio;
    auditTrailId = await registrarAuditTrail({
      ...datos,
      output: resultado,
      duracionMs,
    });
    return { resultado, auditTrailId, duracionMs };
  } catch (e: any) {
    const duracionMs = Date.now() - inicio;
    auditTrailId = await registrarAuditTrail({
      ...datos,
      duracionMs,
      error: e.message,
    });
    throw e;
  }
}
