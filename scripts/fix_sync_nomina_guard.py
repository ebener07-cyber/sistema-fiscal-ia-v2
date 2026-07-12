#!/usr/bin/env python3
"""Fix sync-nomina.ts: add runtime guard for factura.receptorRfc"""

target = "/home/z/my-project/nuevo-proyecto/sync-nomina.ts"
with open(target, "rb") as f:
    text = f.read().decode("utf-8")

# Add a guard at the start of the loop iteration
old = "    for (const factura of facturasNomina) {\r\n      try {\r\n        // Verificar si ya existe el recibo"
new = "    for (const factura of facturasNomina) {\r\n      // Saltar facturas sin RFC de receptor (no se puede ubicar al empleado)\r\n      if (!factura.receptorRfc) continue;\r\n      try {\r\n        // Verificar si ya existe el recibo"

if old in text:
    text = text.replace(old, new, 1)
    with open(target, "wb") as f:
        f.write(text.encode("utf-8"))
    print("OK: runtime guard added")
else:
    print("FAIL: pattern not found")
