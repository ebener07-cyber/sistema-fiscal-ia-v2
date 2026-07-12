#!/bin/bash
# Append validateCFDI function to cfdi-parser.ts

TARGET="/home/z/my-project/nuevo-proyecto/lib/cfdi-parser.ts"
APPEND_FILE="/tmp/validate_cfdi_fn.ts"

cat > "$APPEND_FILE" << 'EOF'

export interface CFDIValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Valida que un CFDI ya parseado tenga los campos minimos exigidos por el SAT.
 * No verifica el sello fiscal ni la existencia en el SAT; solo valida integridad
 * estructural basica para evitar guardar XML invalidos en la base de datos.
 */
export function validateCFDI(cfdi: CFDIData | null): CFDIValidationResult {
  const errors: string[] = [];

  if (!cfdi) {
    return { valid: false, errors: ['CFDI nulo o no parseado'] };
  }

  // UUID obligatorio, formato canonico de 36 caracteres
  if (!cfdi.uuid || cfdi.uuid.length !== 36) {
    errors.push('UUID ausente o con formato invalido');
  }

  // Fecha obligatoria
  if (!cfdi.fecha) {
    errors.push('Fecha del comprobante ausente');
  }

  // Folio: permitimos 'S/F' como valor por defecto del parser, pero si viene
  // vacio lo marcamos como advertencia.
  if (!cfdi.folio) {
    errors.push('Folio ausente');
  }

  // Totales numericos y coherentes
  if (typeof cfdi.subtotal !== 'number' || isNaN(cfdi.subtotal) || cfdi.subtotal < 0) {
    errors.push('Subtotal invalido');
  }
  if (typeof cfdi.total !== 'number' || isNaN(cfdi.total) || cfdi.total < 0) {
    errors.push('Total invalido');
  }

  // Coherencia basica: total = subtotal - descuento + traslados - retenidos
  // Tolerancia de 1 centavo por redondeo
  const expectedTotal =
    cfdi.subtotal -
    (cfdi.descuento || 0) +
    (cfdi.impuestos?.totalTrasladados || 0) -
    (cfdi.impuestos?.totalRetenidos || 0);
  if (
    typeof cfdi.total === 'number' &&
    !isNaN(cfdi.total) &&
    Math.abs(cfdi.total - expectedTotal) > 0.01
  ) {
    errors.push(
      `Total no cuadra con subtotal+impuestos (esperado=${expectedTotal.toFixed(2)}, actual=${cfdi.total.toFixed(2)})`
    );
  }

  // Emisor
  if (!cfdi.emisor?.rfc || cfdi.emisor.rfc.length < 12 || cfdi.emisor.rfc.length > 13) {
    errors.push('RFC del emisor ausente o invalido');
  }
  if (!cfdi.emisor?.nombre) {
    errors.push('Nombre del emisor ausente');
  }

  // Receptor
  if (!cfdi.receptor?.rfc || cfdi.receptor.rfc.length < 12 || cfdi.receptor.rfc.length > 13) {
    errors.push('RFC del receptor ausente o invalido');
  }

  // Tipo de comprobante valido: I, E, T, N, P
  const tiposValidos = ['I', 'E', 'T', 'N', 'P'];
  if (!tiposValidos.includes(cfdi.tipoComprobante)) {
    errors.push(`Tipo de comprobante invalido: "${cfdi.tipoComprobante}"`);
  }

  // Conceptos: al menos uno (excepto nomina que no siempre los trae en cfdi:Conceptos)
  if (!cfdi.esNomina && (!cfdi.conceptos || cfdi.conceptos.length === 0)) {
    errors.push('El CFDI no tiene conceptos');
  }

  return { valid: errors.length === 0, errors };
}
EOF

# Convert the appended content to CRLF to match the rest of the file
sed -i 's/$/\r/' "$APPEND_FILE"

# Append to the target file
cat "$APPEND_FILE" >> "$TARGET"

echo "✅ validateCFDI appended to $TARGET"
echo ""
echo "--- Last 15 lines of file ---"
tail -15 "$TARGET"
