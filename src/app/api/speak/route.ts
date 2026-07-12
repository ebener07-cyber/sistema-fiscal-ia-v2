import { NextRequest, NextResponse } from 'next/server';

/**
 * GET /api/speak?probe=1
 * Devuelve qué backend de voz está configurado.
 *
 * POST /api/speak
 * Body: { text: string }
 * Devuelve: audio/mpeg (stream) si hay ELEVENLABS_API_KEY,
 *           o JSON { error, fallback: 'web-speech' } si no.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// Voz "Adam" de ElevenLabs — grave, masculina, confiable.
// Otras opciones: "Marcus", "Callum", "Antoni", "Arnold"
// Voice IDs:
//   Adam   = pNInz6obpgDQGcFmaJgB
//   Marcus = 6bd9CGQk4QYoZk0pRFmg
//   Callum = N2lFW1Xy9HkQf3yFv9tC
//   Antoni = ErXwobaYiN019PkySvjV
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB';
const ELEVENLABS_MODEL = 'eleven_multilingual_v2';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get('probe') === '1') {
    return NextResponse.json({
      backend: ELEVENLABS_API_KEY ? 'elevenlabs' : 'web-speech',
      voice_id: ELEVENLABS_VOICE_ID,
      model: ELEVENLABS_MODEL,
    });
  }
  return NextResponse.json({ error: 'Usa POST con { text }' }, { status: 400 });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const text = body.text;
    if (!text || typeof text !== 'string') {
      return NextResponse.json({ error: 'Falta text' }, { status: 400 });
    }

    if (!ELEVENLABS_API_KEY) {
      return NextResponse.json(
        {
          error: 'ELEVENLABS_API_KEY no configurada. Usando fallback Web Speech.',
          fallback: 'web-speech',
        },
        { status: 200 }
      );
    }

    const voiceSettings = {
      stability: 0.75,
      similarity_boost: 0.85,
      style: 0.4,
      use_speaker_boost: true,
    };

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          Accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text,
          model_id: ELEVENLABS_MODEL,
          voice_settings: voiceSettings,
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error('ElevenLabs error:', errText);
      return NextResponse.json(
        {
          error: `ElevenLabs devolvió ${response.status}`,
          fallback: 'web-speech',
        },
        { status: 200 }
      );
    }

    const audioBuffer = await response.arrayBuffer();

    return new Response(audioBuffer, {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Content-Length': String(audioBuffer.byteLength),
        'Cache-Control': 'no-cache, no-transform',
      },
    });
  } catch (e: any) {
    console.error('Error en /api/speak:', e);
    return NextResponse.json(
      { error: e.message, fallback: 'web-speech' },
      { status: 500 }
    );
  }
}
