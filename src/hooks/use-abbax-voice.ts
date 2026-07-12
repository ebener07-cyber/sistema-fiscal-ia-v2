'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook de voz ABBAX.
 *
 * Estrategia:
 * 1. Si hay ELEVENLABS_API_KEY en el servidor → usa ElevenLabs (voz grave tipo Idzi Dutkiewicz)
 * 2. Si no, hace fallback a Web Speech API con configuración para voz grave y pausada.
 *
 * El endpoint /api/speak recibe el texto y devuelve audio MP3 stream.
 */

interface AbbaxVoiceState {
  speak: (text: string) => Promise<void>;
  cancel: () => void;
  isSpeaking: boolean;
  isLoading: boolean;
  isSupported: boolean;
  backend: 'elevenlabs' | 'web-speech' | 'none';
  error: string | null;
}

export function useAbbaxVoice(): AbbaxVoiceState {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<'elevenlabs' | 'web-speech' | 'none'>('none');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const webSpeechUtterRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Detectar soporte y preferencia de backend al montar
  useEffect(() => {
    if (typeof window === 'undefined') return;

    async function detectBackend() {
      try {
        // Preguntar al endpoint qué backend tiene configurado
        const r = await fetch('/api/speak?probe=1');
        if (r.ok) {
          const d = await r.json();
          if (d.backend === 'elevenlabs') {
            setBackend('elevenlabs');
            return;
          }
        }
      } catch {
        // ignore, fallar a web speech
      }
      // Fallback: Web Speech API
      if ('speechSynthesis' in window) {
        setBackend('web-speech');
      } else {
        setBackend('none');
      }
    }
    detectBackend();
  }, []);

  // === HABLAR CON ELEVENLABS ===
  const speakWithElevenLabs = useCallback(async (text: string) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/speak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Error ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onplay = () => {
        setIsSpeaking(true);
        setIsLoading(false);
      };
      audio.onended = () => {
        setIsSpeaking(false);
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };
      audio.onerror = () => {
        setIsSpeaking(false);
        setIsLoading(false);
        setError('No pude reproducir el audio');
        URL.revokeObjectURL(url);
        audioRef.current = null;
      };
      await audio.play();
    } catch (e: any) {
      setIsLoading(false);
      setError(e.message);
      // Fallback silencioso a Web Speech
      speakWithWebSpeech(text);
    }
  }, []);

  // === HABLAR CON WEB SPEECH (FALLBACK) ===
  const speakWithWebSpeech = useCallback((text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setError('Tu navegador no soporta síntesis de voz');
      return;
    }
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    // Configuración para que suene grave y pausada (vibra Stark)
    utter.lang = 'es-MX';
    utter.rate = 0.92;  // ligeramente más lento = más confiado
    utter.pitch = 0.75; // más grave que el default (1.0)
    utter.volume = 1.0;

    // Buscar voz masculina española preferida
    const voices = window.speechSynthesis.getVoices();
    // Prioridad: voces masculinas en español (Google español masculino, o voces del sistema)
    const prioridad = [
      (v: SpeechSynthesisVoice) => v.lang === 'es-MX' && /Google/i.test(v.name),
      (v: SpeechSynthesisVoice) => v.lang === 'es-MX',
      (v: SpeechSynthesisVoice) => v.lang === 'es-ES' && /Google/i.test(v.name),
      (v: SpeechSynthesisVoice) => v.lang === 'es-ES',
      (v: SpeechSynthesisVoice) => v.lang.startsWith('es-419'),
      (v: SpeechSynthesisVoice) => v.lang.startsWith('es'),
    ];
    for (const pred of prioridad) {
      const found = voices.find(pred);
      if (found) {
        utter.voice = found;
        break;
      }
    }

    utter.onstart = () => setIsSpeaking(true);
    utter.onend = () => setIsSpeaking(false);
    utter.onerror = () => setIsSpeaking(false);

    webSpeechUtterRef.current = utter;
    window.speechSynthesis.speak(utter);
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!text.trim()) return;
      // Cancelar cualquier reproducción previa
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setIsSpeaking(false);

      if (backend === 'elevenlabs') {
        await speakWithElevenLabs(text);
      } else if (backend === 'web-speech') {
        speakWithWebSpeech(text);
      } else {
        setError('No hay backend de voz disponible');
      }
    },
    [backend, speakWithElevenLabs, speakWithWebSpeech]
  );

  const cancel = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    return () => {
      if (audioRef.current) audioRef.current.pause();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return {
    speak,
    cancel,
    isSpeaking,
    isLoading,
    isSupported: backend !== 'none',
    backend,
    error,
  };
}
