/**
 * Helper para inicializar Z.AI SDK desde variables de entorno o archivo config.
 *
 * En el sandbox: lee de /etc/.z-ai-config (automático)
 * En Vercel/producción: lee de variables de entorno ZAI_API_KEY y ZAI_BASE_URL
 */

let zaiInstance: any = null;

export async function getZAI() {
  if (zaiInstance) return zaiInstance;

  const ZAI = (await import('z-ai-web-dev-sdk')).default;

  // Intentar primero desde variables de entorno (Vercel/producción)
  const envApiKey = process.env.ZAI_API_KEY;
  const envBaseUrl = process.env.ZAI_BASE_URL || 'https://api.z.ai/v1';

  if (envApiKey) {
    // Crear instancia directamente con la config de env vars
    zaiInstance = new ZAI({
      baseUrl: envBaseUrl,
      apiKey: envApiKey,
    });
    return zaiInstance;
  }

  // Fallback: usar ZAI.create() que lee de .z-ai-config (sandbox)
  zaiInstance = await ZAI.create();
  return zaiInstance;
}
