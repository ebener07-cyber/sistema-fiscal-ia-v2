'use client';

import { useEffect, useRef, useState } from 'react';
import { useSpeechRecognition, useSpeechSynthesis } from '@/hooks/use-speech';
import { Mic, MicOff, Volume2, VolumeX, Loader2, Send, Settings, X, AlertTriangle, Wrench, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { MicrophoneDiagnostic } from './microphone-diagnostic';
import { ArcReactor } from '@/components/abbax/arc-reactor';
import { useAbbaxVoice } from '@/hooks/use-abbax-voice';

interface Mensaje {
  id: string;
  rol: 'usuario' | 'asistente' | 'sistema';
  contenido: string;
  herramientas?: Array<{ name: string; args: any; resultado?: any }>;
  isStreaming?: boolean;
}

interface Props {
  onDatosActualizados?: () => void;
}

export function AssistantPanel({ onDatosActualizados }: Props) {
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [input, setInput] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [ttsActivado, setTtsActivado] = useState(false);
  const [notificacion, setNotificacion] = useState<string | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [diagnosticOpen, setDiagnosticOpen] = useState(false);
  const [selectedMicDevice, setSelectedMicDevice] = useState<string>('');

  const scrollRef = useRef<HTMLDivElement>(null);
  const historialRef = useRef<Array<{ rol: string; contenido: string }>>([]);

  const {
    speak: speakAbbax,
    cancel: cancelAbbax,
    isSpeaking: abbaxSpeaking,
    isLoading: abbaxLoading,
    isSupported: abbaxVoiceSupported,
    backend: abbaxBackend,
    error: abbaxVoiceError,
  } = useAbbaxVoice();

  useEffect(() => {
    fetch('/api/conversaciones')
      .then((r) => r.json())
      .then((d) => {
        if (d.conversaciones?.length) {
          const msgs: Mensaje[] = d.conversaciones.map((c: any, i: number) => ({
            id: c.id || `prev-${i}`,
            rol: c.rol,
            contenido: c.contenido,
          }));
          setMensajes(msgs);
          historialRef.current = d.conversaciones.map((c: any) => ({
            rol: c.rol,
            contenido: c.contenido,
          }));
        } else {
          setMensajes([
            {
              id: 'welcome',
              rol: 'asistente',
              contenido:
                '⚡ Abbax en línea. A ver, Jefe, qué desastre tenemos hoy. Yo puedo calcular la órbita de un satélite mientras reviso tus pendientes, así que dime rápido qué necesitas. Tareas, notas, recordatorios, cálculos, conversión de moneda, ideas — todo cubierto.',
            },
          ]);
        }
      })
      .catch(() => {
        setMensajes([
          {
            id: 'welcome',
            rol: 'asistente',
            contenido: '👋 ¡Hola! Soy Abbax. Toca el micrófono o escribe.',
          },
        ]);
      });
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [mensajes]);

  const manejarFinalVoz = async (texto: string) => {
    if (!texto.trim()) return;
    await enviarMensaje(texto.trim());
  };

  const {
    isListening,
    transcript,
    interimTranscript,
    error: voiceError,
    isSupported: voiceSupported,
    browserInfo,
    start,
    stop,
  } = useSpeechRecognition({
    lang: 'es-MX',
    continuous: false,
    interimResults: true,
    onFinalResult: manejarFinalVoz,
    onError: (err) => {
      // Si el error es de micrófono, abrir diagnóstico automáticamente
      if (
        err.includes('micrófono') ||
        err.includes('Permiso') ||
        err.includes('denegado') ||
        err.includes('No se detectó')
      ) {
        setDiagnosticOpen(true);
      }
    },
  });

  const toggleEscucha = () => {
    if (isListening) {
      stop();
    } else {
      if (ttsActivado) cancelAbbax();
      start();
    }
  };

  const enviarMensaje = async (texto: string) => {
    if (!texto.trim() || procesando) return;

    const userMsg: Mensaje = {
      id: `u-${Date.now()}`,
      rol: 'usuario',
      contenido: texto,
    };
    const assistantMsgId = `a-${Date.now()}`;
    const assistantMsg: Mensaje = {
      id: assistantMsgId,
      rol: 'asistente',
      contenido: '',
      herramientas: [],
      isStreaming: true,
    };

    setMensajes((prev) => [...prev, userMsg, assistantMsg]);
    setInput('');
    setProcesando(true);

    const nuevoHistorial = [...historialRef.current, { rol: 'usuario', contenido: texto }];
    historialRef.current = nuevoHistorial;

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mensaje: texto, historial: nuevoHistorial.slice(-10) }),
      });

      if (!res.ok || !res.body) throw new Error('Respuesta inválida del servidor');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let textoAcumulado = '';
      let herramientasEjecutadas = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lineas = buffer.split('\n\n');
        buffer = lineas.pop() || '';

        for (const linea of lineas) {
          if (!linea.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(linea.slice(6));
            if (evt.type === 'token') {
              textoAcumulado += evt.content;
              setMensajes((prev) =>
                prev.map((m) => (m.id === assistantMsgId ? { ...m, contenido: textoAcumulado } : m))
              );
            } else if (evt.type === 'tool_call') {
              herramientasEjecutadas = true;
              setMensajes((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        herramientas: [...(m.herramientas || []), { name: evt.name, args: evt.args }],
                      }
                    : m
                )
              );
            } else if (evt.type === 'tool_result') {
              setMensajes((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        herramientas: (m.herramientas || []).map((h, i, arr) =>
                          i === arr.length - 1 ? { ...h, resultado: evt.result } : h
                        ),
                      }
                    : m
                )
              );
            } else if (evt.type === 'done') {
              setMensajes((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, contenido: evt.full, isStreaming: false }
                    : m
                )
              );
              historialRef.current = [...historialRef.current, { rol: 'asistente', contenido: evt.full }];
              if (ttsActivado && evt.full) {
                speakAbbax(evt.full);
              }
              if (herramientasEjecutadas) {
                setNotificacion('Datos actualizados');
                setTimeout(() => setNotificacion(null), 2500);
                onDatosActualizados?.();
              }
            } else if (evt.type === 'error') {
              setMensajes((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? { ...m, contenido: `⚠️ Error: ${evt.content}`, isStreaming: false }
                    : m
                )
              );
            }
          } catch {}
        }
      }
    } catch (e: any) {
      setMensajes((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
                ...m,
                contenido: `⚠️ No pude conectar con el servidor: ${e.message}`,
                isStreaming: false,
              }
            : m
        )
      );
    } finally {
      setProcesando(false);
    }
  };

  const limpiarChat = async () => {
    if (!confirm('¿Borrar toda la conversación?')) return;
    await fetch('/api/conversaciones', { method: 'DELETE' });
    setMensajes([
      {
        id: 'welcome',
        rol: 'asistente',
        contenido: '👋 Conversación borrada. ¿En qué te ayudo?',
      },
    ]);
    historialRef.current = [];
  };

  const ejemplos = [
    'Crea una tarea urgente: Llamar al contador',
    'Anota: comprar leche y pan',
    'Recuérdame pagar la luz mañana a las 10am',
    'Calcula 15% de 2500',
    'Convierte 100 dólares a pesos',
    'Qué día es hoy',
    'Dame 5 ideas para un regalo',
    'Crea lista de compras: pan, leche, huevos',
    'Muéstrame mis tareas',
    'Hazme un resumen',
  ];

  return (
    <div className="flex flex-col h-full bg-card border rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b bg-gradient-to-r from-violet-700 via-violet-600 to-fuchsia-700 text-white">
        <div className="flex items-center gap-3">
          <div className="bg-slate-950/40 rounded-full p-1.5 backdrop-blur-sm border border-cyan-400/30">
            <ArcReactor
              size={40}
              state={
                abbaxSpeaking
                  ? 'speaking'
                  : abbaxLoading
                  ? 'thinking'
                  : isListening
                  ? 'thinking'
                  : procesando
                  ? 'thinking'
                  : abbaxVoiceError
                  ? 'error'
                  : 'idle'
              }
            />
          </div>
          <div>
            <h2 className="font-bold flex items-center gap-2">
              ABBAX
              <span className="text-[10px] font-normal bg-white/20 px-2 py-0.5 rounded-full">
                {abbaxBackend === 'elevenlabs' ? '⚡ ELEVEN' : abbaxBackend === 'web-speech' ? '🔊 TTS' : '—'}
              </span>
            </h2>
            <p className="text-xs text-white/80">
              {isListening
                ? 'Escuchando...'
                : abbaxLoading
                ? 'Sintetizando voz...'
                : abbaxSpeaking
                ? '🔊 Hablando...'
                : procesando
                ? 'Procesando...'
                : 'En línea · Listo para trabajar'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {abbaxVoiceSupported && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (ttsActivado) {
                  cancelAbbax();
                  setTtsActivado(false);
                } else {
                  setTtsActivado(true);
                }
              }}
              className={cn('text-white hover:bg-white/20', ttsActivado && 'bg-white/20')}
              title={ttsActivado ? 'Silenciar voz Stark' : 'Activar voz Stark'}
            >
              {ttsActivado ? <Volume2 size={16} /> : <VolumeX size={16} />}
            </Button>
          )}
          <Dialog open={configOpen} onOpenChange={setConfigOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="ghost" className="text-white hover:bg-white/20" title="Configuración de voz">
                <Settings size={16} />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Configuración de voz</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div>
                  <h3 className="font-semibold mb-1">🌐 Navegador detectado</h3>
                  <p className="text-muted-foreground">{browserInfo || 'Detectando...'}</p>
                </div>
                <div>
                  <h3 className="font-semibold mb-1">🎤 Reconocimiento de voz</h3>
                  {voiceSupported ? (
                    <p className="text-green-600">✅ Soportado en este navegador</p>
                  ) : (
                    <div className="text-red-600 space-y-2">
                      <p className="flex items-center gap-1">
                        <AlertTriangle size={14} /> No soportado en este navegador
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Para usar voz necesitas <strong>Chrome</strong> o <strong>Edge</strong> de
                        escritorio (no funciona en Firefox ni Safari iOS). Mientras tanto, puedes
                        escribir tus comandos en la caja de texto.
                      </p>
                    </div>
                  )}
                </div>
                <div>
                  <h3 className="font-semibold mb-1">🔊 Voz de Abbax (Stark)</h3>
                  {abbaxVoiceSupported ? (
                    <>
                      <p className="text-green-600">✅ Soportado</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Backend activo: <strong>{abbaxBackend === 'elevenlabs' ? 'ElevenLabs (voz grave Stark)' : 'Web Speech API (fallback)'}</strong>
                      </p>
                      {abbaxBackend === 'web-speech' && (
                        <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800">
                          <strong>💡 Para voz Stark real:</strong>
                          <ol className="list-decimal list-inside mt-1 space-y-0.5">
                            <li>Crea cuenta en <a href="https://elevenlabs.io" target="_blank" rel="noreferrer" className="underline">elevenlabs.io</a> (gratis)</li>
                            <li>Copia tu API key</li>
                            <li>Agrégala al archivo <code className="bg-amber-100 px-1">.env</code> como <code className="bg-amber-100 px-1">ELEVENLABS_API_KEY=tu_key</code></li>
                            <li>Recarga la página</li>
                          </ol>
                        </div>
                      )}
                      {abbaxBackend === 'elevenlabs' && (
                        <p className="text-xs text-green-600 mt-1">
                          ⚡ Voz Stark activa · Configuración: stability 0.75 · similarity 0.85 · style 0.4
                        </p>
                      )}
                      {abbaxVoiceError && (
                        <p className="text-xs text-red-600 mt-1">⚠️ {abbaxVoiceError}</p>
                      )}
                    </>
                  ) : (
                    <p className="text-red-600">❌ No soportado en este navegador</p>
                  )}
                </div>
                <div className="bg-muted/50 p-3 rounded-lg text-xs">
                  <h4 className="font-semibold mb-1">💡 Si la voz no funciona</h4>
                  <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                    <li>Verifica que tu navegador sea Chrome o Edge (de escritorio)</li>
                    <li>Haz clic en el ícono de candado 🔒 en la barra de direcciones</li>
                    <li>Ve a Permisos → Micrófono → Permitir</li>
                    <li>Recarga la página</li>
                    <li>Verifica que tu micrófono funcione en otras apps</li>
                  </ol>
                </div>
                <Button onClick={() => setConfigOpen(false)} className="w-full">
                  Cerrar
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button size="sm" variant="ghost" onClick={limpiarChat} className="text-white hover:bg-white/20">
            Limpiar
          </Button>
        </div>
      </div>

      {/* Mensajes */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[480px]">
        {mensajes.map((m) => (
          <div
            key={m.id}
            className={cn('flex flex-col gap-2', m.rol === 'usuario' ? 'items-end' : 'items-start')}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-2xl px-4 py-2.5 text-sm',
                m.rol === 'usuario'
                  ? 'bg-violet-600 text-white rounded-br-md'
                  : m.rol === 'sistema'
                  ? 'bg-amber-100 text-amber-900'
                  : 'bg-muted rounded-bl-md'
              )}
            >
              {m.contenido || (m.isStreaming ? '...' : '')}
              {m.isStreaming && m.contenido && (
                <span className="inline-block w-1.5 h-3.5 bg-violet-500 ml-1 animate-pulse" />
              )}
            </div>
            {m.herramientas && m.herramientas.length > 0 && (
              <div className="flex flex-wrap gap-1.5 max-w-[85%]">
                {m.herramientas.map((h, i) => (
                  <span
                    key={i}
                    className={cn(
                      'text-xs gap-1 py-1 px-2 rounded-full border',
                      h.resultado?.success
                        ? 'border-green-500 text-green-700 bg-green-50'
                        : h.resultado
                        ? 'border-red-500 text-red-700 bg-red-50'
                        : 'border-violet-500 text-violet-700 bg-violet-50 animate-pulse'
                    )}
                  >
                    {h.resultado?.success ? '✓' : h.resultado ? '✕' : '⏳'}
                    <span className="font-mono">{h.name}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
        {notificacion && (
          <div className="mx-auto bg-green-100 text-green-800 text-xs px-3 py-1.5 rounded-full animate-pulse w-fit">
            {notificacion}
          </div>
        )}
      </div>

      {/* Aviso si voz no soportada */}
      {!voiceSupported && (
        <div className="px-4 py-2 bg-amber-50 border-t border-amber-200 text-xs text-amber-800 flex items-center gap-2">
          <AlertTriangle size={14} />
          <span>
            Voz no soportada en este navegador. Usa <strong>Chrome</strong> o <strong>Edge</strong> de
            escritorio, o escribe tus comandos abajo.
          </span>
        </div>
      )}

      {/* Diagnóstico de micrófono — botón siempre visible */}
      {voiceSupported && (
        <div className="px-3 pt-2">
          <button
            onClick={() => setDiagnosticOpen(true)}
            className="text-xs text-violet-700 hover:text-violet-900 flex items-center gap-1"
          >
            <Wrench size={12} /> Diagnosticar micrófono
          </button>
        </div>
      )}

      {/* Sugerencias si está vacío */}
      {mensajes.length <= 1 && (
        <div className="px-4 pb-2 flex flex-wrap gap-1.5">
          {ejemplos.map((e) => (
            <button
              key={e}
              onClick={() => enviarMensaje(e)}
              className="text-xs px-2.5 py-1 rounded-full bg-violet-50 hover:bg-violet-100 text-violet-700 border border-violet-200 transition"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Input + micrófono */}
      <div className="p-3 border-t bg-background space-y-2">
        {voiceError && (
          <div className="text-xs text-red-600 bg-red-50 px-2 py-2 rounded flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
            <div className="flex-1">
              <p>{voiceError}</p>
              <div className="flex gap-2 mt-1.5">
                <button
                  onClick={() => setDiagnosticOpen(true)}
                  className="text-red-700 underline flex items-center gap-1 font-semibold"
                >
                  <Wrench size={11} /> Diagnosticar
                </button>
                <button
                  onClick={() => {
                    if (typeof window !== 'undefined') window.location.reload();
                  }}
                  className="text-red-700 underline"
                >
                  Recargar
                </button>
              </div>
            </div>
          </div>
        )}
        {transcript && (
          <div className="text-xs text-muted-foreground italic px-2">
            {transcript}
            <span className="text-violet-500">{interimTranscript}</span>
          </div>
        )}
        <div className="flex items-center gap-2">
          <Button
            onClick={toggleEscucha}
            disabled={!voiceSupported || procesando}
            size="icon"
            className={cn(
              'rounded-full flex-shrink-0 transition-all',
              isListening
                ? 'bg-red-500 hover:bg-red-600 animate-pulse'
                : 'bg-violet-600 hover:bg-violet-700'
            )}
            title={voiceSupported ? 'Hablar' : 'Voz no soportada'}
          >
            {isListening ? <MicOff size={18} /> : <Mic size={18} />}
          </Button>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                enviarMensaje(input);
              }
            }}
            placeholder={isListening ? 'Escuchando tu voz...' : 'Escribe o toca el micrófono'}
            disabled={procesando}
            className="flex-1 px-3 py-2 text-sm bg-background border rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500"
          />
          <Button
            onClick={() => enviarMensaje(input)}
            disabled={!input.trim() || procesando}
            size="icon"
            className="rounded-full bg-violet-600 hover:bg-violet-700"
          >
            {procesando ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </Button>
        </div>
      </div>

      {/* Diálogo de diagnóstico de micrófono */}
      <Dialog open={diagnosticOpen} onOpenChange={setDiagnosticOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>🎤 Diagnóstico de micrófono</DialogTitle>
          </DialogHeader>
          <MicrophoneDiagnostic
            onErrorResolved={() => {
              // Cerrar el diagnóstico después de reintentar exitosamente
              setTimeout(() => setDiagnosticOpen(false), 1500);
            }}
            onDeviceSelected={(deviceId) => {
              setSelectedMicDevice(deviceId);
            }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
