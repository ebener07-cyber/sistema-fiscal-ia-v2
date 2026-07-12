'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Hook MEJORADO para reconocimiento de voz usando Web Speech API.
 *
 * Mejoras:
 * - Detección robusta de soporte con mensajes claros
 * - Auto-selección de voz española cuando esté disponible
 * - Reintentos automáticos
 * - Mensajes de error específicos según el tipo de fallo
 * - Modo "push to talk" continuo
 */
export function useSpeechRecognition(options: {
  lang?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onFinalResult?: (texto: string) => void;
  onError?: (error: string) => void;
} = {}) {
  const {
    lang = 'es-MX',
    continuous = false,
    interimResults = true,
    onFinalResult,
    onError,
  } = options;

  const [isSupported] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return Boolean(
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    );
  });

  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const onFinalRef = useRef(onFinalResult);
  const onErrorRef = useRef(onError);
  const shouldListenRef = useRef(false);
  const restartAttemptsRef = useRef(0);

  useEffect(() => {
    onFinalRef.current = onFinalResult;
    onErrorRef.current = onError;
  }, [onFinalResult, onError]);

  // Detectar navegador para mensajes útiles (inicialización perezosa)
  const [browserInfo] = useState<string>(() => {
    if (typeof navigator === 'undefined') return '';
    const ua = navigator.userAgent;
    if (/Chrome\/(\d+)/.test(ua) && !/Edg/.test(ua)) {
      const m = ua.match(/Chrome\/(\d+)/);
      return `Chrome ${m?.[1] || ''}`;
    }
    if (/Edg\/(\d+)/.test(ua)) {
      const m = ua.match(/Edg\/(\d+)/);
      return `Edge ${m?.[1] || ''}`;
    }
    if (/Firefox\//.test(ua)) {
      return 'Firefox (no soporta Web Speech API)';
    }
    if (/Safari\//.test(ua) && !/Chrome/.test(ua)) {
      return 'Safari (soporte limitado)';
    }
    return 'Navegador desconocido';
  });

  useEffect(() => {
    if (!isSupported) return;
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.lang = lang;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    // Aumentar el tiempo máximo de silencio
    if ('maxAlternatives' in recognition) recognition.maxAlternatives = 3;

    recognition.onstart = () => {
      restartAttemptsRef.current = 0;
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const txt = res[0].transcript;
        if (res.isFinal) {
          final += txt;
        } else {
          interim += txt;
        }
      }
      if (final) {
        setTranscript((prev) => (prev ? prev + ' ' + final : final));
        setInterimTranscript('');
        if (onFinalRef.current) onFinalRef.current(final.trim());
      } else {
        setInterimTranscript(interim);
      }
    };

    recognition.onerror = (event: any) => {
      const err = event.error;
      let msg = '';
      switch (err) {
        case 'no-speech':
          // No es error real, simplemente no detectó voz
          return;
        case 'aborted':
          return;
        case 'not-allowed':
        case 'service-not-allowed':
          msg = '⛔ Permiso de micrófono denegado. Ve a la configuración del navegador → Privacidad → Micrófono y permite este sitio.';
          setIsListening(false);
          shouldListenRef.current = false;
          break;
        case 'network':
          msg = '🌐 Error de red en el servicio de reconocimiento de voz. Verifica tu conexión.';
          break;
        case 'audio-capture':
          msg = '🎤 No se detectó micrófono. Conecta un micrófono y reintenta.';
          setIsListening(false);
          shouldListenRef.current = false;
          break;
        case 'language-not-supported':
          msg = `🌍 Idioma ${lang} no soportado. Usa es-ES o es-MX.`;
          break;
        default:
          msg = `⚠️ Error de reconocimiento: ${err}`;
      }
      setError(msg);
      if (onErrorRef.current) onErrorRef.current(msg);
    };

    recognition.onend = () => {
      if (shouldListenRef.current && restartAttemptsRef.current < 3) {
        restartAttemptsRef.current++;
        try {
          setTimeout(() => {
            if (shouldListenRef.current) {
              recognition.start();
            }
          }, 100);
        } catch {
          // ya está corriendo
        }
      } else if (restartAttemptsRef.current >= 3) {
        setIsListening(false);
        shouldListenRef.current = false;
      } else {
        setIsListening(false);
      }
    };

    recognitionRef.current = recognition;

    return () => {
      shouldListenRef.current = false;
      try {
        recognition.stop();
      } catch {}
    };
  }, [isSupported, lang, continuous, interimResults]);

  const start = useCallback(() => {
    if (!recognitionRef.current) {
      setError('El reconocimiento de voz no está disponible en este navegador. Usa Chrome o Edge de escritorio.');
      return;
    }
    // Verificar permisos de micrófono primero
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then((stream) => {
          // Liberar el stream inmediatamente, solo estábamos verificando permiso
          stream.getTracks().forEach((t) => t.stop());
          iniciarReconocimiento();
        })
        .catch((err) => {
          if (err.name === 'NotAllowedError') {
            setError('⛔ Permiso de micrófono denegado. Haz clic en el ícono de candado/cámara en la barra de direcciones → permite el micrófono → recarga la página.');
          } else if (err.name === 'NotFoundError') {
            setError('🎤 No se encontró micrófono en tu dispositivo.');
          } else {
            setError(`No pude acceder al micrófono: ${err.message}`);
          }
        });
    } else {
      iniciarReconocimiento();
    }
    function iniciarReconocimiento() {
      setError(null);
      setTranscript('');
      setInterimTranscript('');
      shouldListenRef.current = true;
      restartAttemptsRef.current = 0;
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e: any) {
        // ya está empezado o error
        if (e.message?.includes('already started')) {
          setIsListening(true);
        }
      }
    }
  }, []);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    setIsListening(false);
  }, []);

  const reset = useCallback(() => {
    setTranscript('');
    setInterimTranscript('');
    setError(null);
  }, []);

  return {
    isListening,
    transcript,
    interimTranscript,
    error,
    isSupported,
    browserInfo,
    start,
    stop,
    reset,
  };
}

/**
 * Hook MEJORADO para síntesis de voz (Text-to-Speech).
 *
 * Mejoras:
 * - Precarga de voces (algunos navegadores las cargan async)
 * - Selección automática de voz española mejorada
 * - Fallback a voz por defecto si no hay española
 * - Estado de carga de voces
 */
export function useSpeechSynthesis() {
  const [isSupported] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return 'speechSynthesis' in window;
  });

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voicesLoaded, setVoicesLoaded] = useState(false);
  const voicesLoadedRef = useRef(false);

  useEffect(() => {
    if (!isSupported) return;

    const loadVoices = () => {
      const v = window.speechSynthesis.getVoices();
      if (v.length > 0) {
        setVoices(v);
        if (!voicesLoadedRef.current) {
          voicesLoadedRef.current = true;
          setVoicesLoaded(true);
        }
      }
    };

    loadVoices();
    window.speechSynthesis.onvoiceschanged = loadVoices;
    // Algunos navegadores necesitan un pequeño delay
    const t = setTimeout(loadVoices, 250);
    const t2 = setTimeout(loadVoices, 1000);

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      clearTimeout(t);
      clearTimeout(t2);
    };
  }, [isSupported]);

  const seleccionarVozEspanola = useCallback(() => {
    if (!voices.length) return null;
    // Prioridad: es-MX, luego cualquier es-XX, luego es-ES
    const prioridad = [
      (v: SpeechSynthesisVoice) => v.lang === 'es-MX',
      (v: SpeechSynthesisVoice) => v.lang.startsWith('es-MX'),
      (v: SpeechSynthesisVoice) => v.lang.startsWith('es-419'),
      (v: SpeechSynthesisVoice) => v.lang === 'es-ES',
      (v: SpeechSynthesisVoice) => v.lang.startsWith('es'),
      (v: SpeechSynthesisVoice) => v.lang.startsWith('es-'),
    ];
    for (const pred of prioridad) {
      const found = voices.find(pred);
      if (found) return found;
    }
    return null;
  }, [voices]);

  const speak = useCallback(
    (text: string, opts: { lang?: string; rate?: number; pitch?: number; voice?: SpeechSynthesisVoice } = {}) => {
      if (!isSupported) return;
      // Cancelar cualquier síntesis previa
      window.speechSynthesis.cancel();

      // Si las voces no cargaron, reintentar
      if (!voicesLoadedRef.current) {
        const v = window.speechSynthesis.getVoices();
        if (v.length > 0) {
          setVoices(v);
          voicesLoadedRef.current = true;
          setVoicesLoaded(true);
        }
      }

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = opts.lang ?? 'es-MX';
      utter.rate = opts.rate ?? 1.05;
      utter.pitch = opts.pitch ?? 1.0;
      utter.volume = 1.0;

      const voz = opts.voice || seleccionarVozEspanola();
      if (voz) utter.voice = voz;

      utter.onstart = () => setIsSpeaking(true);
      utter.onend = () => setIsSpeaking(false);
      utter.onerror = (e: any) => {
        setIsSpeaking(false);
        console.warn('TTS error:', e.error);
      };

      // Pequeño delay para asegurar que cancel() terminó
      setTimeout(() => {
        try {
          window.speechSynthesis.speak(utter);
        } catch (e) {
          console.warn('TTS speak failed:', e);
        }
      }, 50);
    },
    [isSupported, seleccionarVozEspanola]
  );

  const cancel = useCallback(() => {
    if (!isSupported) return;
    window.speechSynthesis.cancel();
    setIsSpeaking(false);
  }, [isSupported]);

  return {
    speak,
    cancel,
    isSpeaking,
    isSupported,
    voices,
    voicesLoaded,
    vozEspanola: seleccionarVozEspanola(),
  };
}
