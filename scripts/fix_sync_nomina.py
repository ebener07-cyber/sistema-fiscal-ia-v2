#!/usr/bin/env python3
"""Fix sync-nomina.ts: filter receptorRfc NOT NULL in the query"""
import re

target = "/home/z/my-project/nuevo-proyecto/sync-nomina.ts"
with open(target, "rb") as f:
    data = f.read()

# Convert to text with CRLF preserved
text = data.decode("utf-8")

# Replace the where clause to filter receptorRfc NOT NULL
old = "where: {\r\n        complementoNomina: true,\r\n      },"
new = "where: {\r\n        complementoNomina: true,\r\n        receptorRfc: { not: null },\r\n      },"

if old in text:
    text = text.replace(old, new, 1)
    with open(target, "wb") as f:
        f.write(text.encode("utf-8"))
    print("OK: where clause updated")
else:
    print("FAIL: pattern not found")
    print("First 800 bytes:")
    print(repr(text[:800]))
