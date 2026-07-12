'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, AlertTriangle, CheckCircle2, RefreshCw, Play, Square, Volume2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface AudioDevice {
  deviceId: string;
  label: string;
  kind: string;
}

interface Props {
  onErrorResolved?: () => void;
  onDeviceSelected?: (deviceId: string) => void;
}

/**
 * Diagnóstico completo de micrófono:
 * 1. Lista todos los dispositivos de entrada disponibles
 * 2. Medidor de volumen en vivo (visualizador)
 * 3. Grabación de prueba de 3 segundos con playback
 * 4. Guía específica según el tipo de error
 */
export function MicrophoneDiagnostic({ onErrorResolved, onDeviceSelected }: Props) {
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string>('');
  const [permissionState, setPermissionState] = useState<'unknown' | 'granted' | 'denied' | 'prompt'>('unknown');
  const [audioLevel, setAudioLevel] = useState(0);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [testStatus, setTestStatus] = useState<'idle' | 'recording' | 'recorded' | 'playing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [liveStream, setLiveStream] = useState<MediaStream | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioPlaybackRef = useRef<HTMLAudioElement | null>(null);

  // Verificar estado de permisos
  useEffect(() => {
    async function checkPermissions() {
      if (!navigator.permissions || !navigator.permissions.query) {
        setPermissionState('unknown');
        return;
      }
      try {
        const result = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        setPermissionState(result.state as any);
        result.onchange = () => setPermissionState(result.state as any);
      } catch {
        setPermissionState('unknown');
      }
    }
    checkPermissions();
  }, []);

  // Listar dispositivos cuando haya permiso
  useEffect(() => {
    async function listDevices() {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const inputs = list
          .filter((d) => d.kind === 'audioinput')
          .map((d) => ({
            deviceId: d.deviceId,
            label: d.label || `Micrófono sin nombre (${d.deviceId.slice(0, 8)})`,
            kind: d.kind,
          }));
        setDevices(inputs);
        if (inputs.length > 0 && !selectedDevice) {
          setSelectedDevice(inputs[0].deviceId);
        }
      } catch (e: any) {
        setError(`No pude listar dispositivos: ${e.message}`);
      }
    }
    listDevices();
    // Re-listar cuando cambien los permisos
    navigator.mediaDevices.addEventListener('devicechange', listDevices);
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', listDevices);
    };
  }, [permissionState, selectedDevice]);

  // Iniciar medidor de volumen en vivo
  const startLiveMeter = async () => {
    try {
      setError(null);
      const constraints: MediaStreamConstraints = {
        audio: selectedDevice
          ? { deviceId: { exact: selectedDevice } }
          : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      setLiveStream(stream);

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const update = () => {
        if (!analyserRef.current) return;
        analyser.getByteFrequencyData(dataArray);
        // Promedio simple
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        setAudioLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animationFrameRef.current = requestAnimationFrame(update);
      };
      update();
    } catch (e: any) {
      console.error('Error en startLiveMeter:', e);
      if (e.name === 'NotAllowedError') {
        setError('⛔ Permiso de micrófono denegado. Mira abajo cómo permitirlo.');
        setPermissionState('denied');
      } else if (e.name === 'NotFoundError') {
        setError('🎤 No se encontró ningún micrófono. Conecta uno y recarga.');
      } else if (e.name === 'NotReadableError') {
        setError('🔒 El micrófono está siendo usado por otra aplicación (Zoom, Teams, Discord). Ciérrala e intenta de nuevo.');
      } else {
        setError(`Error: ${e.message}`);
      }
    }
  };

  const stopLiveMeter = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    if (liveStream) {
      liveStream.getTracks().forEach((t) => t.stop());
      setLiveStream(null);
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setAudioLevel(0);
  };

  // Grabar 3 segundos de prueba
  const recordTest = async () => {
    try {
      setError(null);
      setTestStatus('recording');
      stopLiveMeter();

      const constraints: MediaStreamConstraints = {
        audio: selectedDevice ? { deviceId: { exact: selectedDevice } } : true,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setRecordedBlob(blob);
        setTestStatus('recorded');
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorderRef.current = recorder;
      recorder.start();

      setTimeout(() => {
        if (recorder.state === 'recording') {
          recorder.stop();
        }
      }, 3000);
    } catch (e: any) {
      setTestStatus('idle');
      if (e.name === 'NotAllowedError') {
        setError('⛔ Permiso denegado. Revisa la guía de abajo.');
        setPermissionState('denied');
      } else if (e.name === 'NotFoundError') {
        setError('🎤 No se encontró micrófono.');
      } else if (e.name === 'NotReadableError') {
        setError('🔒 Micrófono ocupado por otra app. Cierra Zoom/Teams/Discord.');
      } else {
        setError(`Error al grabar: ${e.message}`);
      }
    }
  };

  const playRecording = () => {
    if (!recordedBlob) return;
    const url = URL.createObjectURL(recordedBlob);
    const audio = new Audio(url);
    audioPlaybackRef.current = audio;
    audio.onplay = () => {
      setIsPlaying(true);
      setTestStatus('playing');
    };
    audio.onended = () => {
      setIsPlaying(false);
      setTestStatus('recorded');
      URL.revokeObjectURL(url);
    };
    audio.play();
  };

  const stopPlayback = () => {
    if (audioPlaybackRef.current) {
      audioPlaybackRef.current.pause();
      audioPlaybackRef.current = null;
    }
    setIsPlaying(false);
    setTestStatus('recorded');
  };

  useEffect(() => {
    return () => {
      stopLiveMeter();
      if (audioPlaybackRef.current) audioPlaybackRef.current.pause();
    };
  }, []);

  const handleDeviceChange = (deviceId: string) => {
    setSelectedDevice(deviceId);
    onDeviceSelected?.(deviceId);
    // Reiniciar medidor si estaba activo
    if (liveStream) {
      stopLiveMeter();
      setTimeout(startLiveMeter, 200);
    }
  };

  return (
    <div className="space-y-4">
      {/* Estado de permisos */}
      <div className="bg-muted/30 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            <Mic size={16} /> Estado del permiso
          </h3>
          {permissionState === 'granted' && (
            <span className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 size={14} /> Permitido
            </span>
          )}
          {permissionState === 'denied' && (
            <span className="text-xs text-red-600 flex items-center gap-1">
              <AlertTriangle size={14} /> Denegado
            </span>
          )}
          {permissionState === 'prompt' && (
            <span className="text-xs text-amber-600">Pendiente</span>
          )}
          {permissionState === 'unknown' && (
            <span className="text-xs text-muted-foreground">Desconocido</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {permissionState === 'denied'
            ? 'Tienes que revocar el bloqueo. Mira las instrucciones abajo.'
            : permissionState === 'granted'
            ? 'El sitio tiene permiso para usar el micrófono.'
            : 'El navegador te preguntará al primer uso.'}
        </p>
      </div>

      {/* Selector de dispositivo */}
      <div>
        <label className="text-sm font-semibold mb-2 block">
          🎤 Micrófono detectado{devices.length > 0 ? ` (${devices.length})` : ''}
        </label>
        {devices.length === 0 ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            <AlertTriangle size={16} className="inline mr-2" />
            <strong>No se detectó ningún micrófono</strong> en tu dispositivo.
            <ol className="list-decimal list-inside mt-2 space-y-1 text-xs">
              <li>Verifica que tengas un micrófono conectado (USB, jack, o integrado)</li>
              <li>En Windows: clic derecho en el ícono de sonido → Sonido → Grabación</li>
              <li>Si aparece "No hay dispositivos", instala drivers o conecta uno</li>
              <li>Recarga esta página después de conectarlo</li>
            </ol>
          </div>
        ) : (
          <select
            value={selectedDevice}
            onChange={(e) => handleDeviceChange(e.target.value)}
            className="w-full p-2 border rounded-lg text-sm bg-background"
          >
            {devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Medidor de volumen en vivo */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="font-semibold text-sm">📊 Medidor de volumen en vivo</h3>
          {!liveStream ? (
            <Button size="sm" variant="outline" onClick={startLiveMeter} disabled={devices.length === 0}>
              <Mic size={14} className="mr-1" /> Activar
            </Button>
          ) : (
            <Button size="sm" variant="destructive" onClick={stopLiveMeter}>
              <MicOff size={14} className="mr-1" /> Detener
            </Button>
          )}
        </div>
        <div className="bg-muted/30 rounded-lg p-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 bg-muted rounded-full h-6 overflow-hidden relative">
              <div
                className={cn(
                  'h-full transition-all duration-75 rounded-full',
                  audioLevel > 60
                    ? 'bg-red-500'
                    : audioLevel > 30
                    ? 'bg-amber-500'
                    : audioLevel > 5
                    ? 'bg-green-500'
                    : 'bg-muted-foreground/30'
                )}
                style={{ width: `${Math.max(2, audioLevel)}%` }}
              />
              <span className="absolute inset-0 flex items-center justify-center text-xs font-bold mix-blend-difference text-white">
                {audioLevel}%
              </span>
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            {liveStream
              ? audioLevel > 5
                ? '✅ Tu micrófono está captando audio. Habla y mira la barra subir.'
                : 'Habla cerca del micrófono. Si no se mueve, prueba otro dispositivo arriba.'
              : 'Activa el medidor y habla. La barra debe subir.'}
          </p>
        </div>
      </div>

      {/* Grabación de prueba */}
      <div>
        <h3 className="font-semibold text-sm mb-2">🎬 Grabación de prueba (3 segundos)</h3>
        <div className="bg-muted/30 rounded-lg p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Grábate 3 segundos y reprodúcelo para verificar que el audio funciona.
          </p>
          <div className="flex gap-2 flex-wrap">
            {testStatus !== 'recording' && (
              <Button size="sm" onClick={recordTest} disabled={devices.length === 0}>
                <Mic size={14} className="mr-1" /> Grabar 3s
              </Button>
            )}
            {testStatus === 'recording' && (
              <Button size="sm" variant="destructive" disabled>
                <Square size={14} className="mr-1 animate-pulse" /> Grabando...
              </Button>
            )}
            {testStatus === 'recorded' && !isPlaying && recordedBlob && (
              <Button size="sm" variant="default" onClick={playRecording}>
                <Play size={14} className="mr-1" /> Reproducir
              </Button>
            )}
            {isPlaying && (
              <Button size="sm" variant="destructive" onClick={stopPlayback}>
                <Square size={14} className="mr-1" /> Detener
              </Button>
            )}
            {recordedBlob && (
              <Button size="sm" variant="outline" onClick={recordTest}>
                <RefreshCw size={14} className="mr-1" /> Re-grabar
              </Button>
            )}
          </div>
          {testStatus === 'recorded' && (
            <p className="text-xs text-green-600 flex items-center gap-1">
              <CheckCircle2 size={12} /> Grabación lista. Toca Reproducir para escucharla.
            </p>
          )}
        </div>
      </div>

      {/* Error actual */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          <AlertTriangle size={16} className="inline mr-2" />
          {error}
        </div>
      )}

      {/* Guía paso a paso según el problema */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm">
        <h3 className="font-bold mb-3 flex items-center gap-2">
          <Volume2 size={16} /> Solución de problemas
        </h3>

        {permissionState === 'denied' && (
          <div className="mb-4">
            <h4 className="font-semibold mb-2 text-red-700">🔓 Tu navegador bloqueó el micrófono</h4>
            <p className="mb-2 text-xs">Para permitirlo:</p>
            <ol className="list-decimal list-inside space-y-1 text-xs">
              <li>Mira la barra de direcciones arriba</li>
              <li>Haz clic en el ícono entre "←" y "🔒" (puede ser un ícono de cámara o candado)</li>
              <li>Busca "Micrófono" en la lista de permisos</li>
              <li>Cámbialo a "Permitir"</li>
              <li>Recarga la página (F5)</li>
            </ol>
          </div>
        )}

        <h4 className="font-semibold mb-2">🖥️ Windows 10/11 (lo más común)</h4>
        <ol className="list-decimal list-inside space-y-1 text-xs mb-3">
          <li><strong>Configuración</strong> → <strong>Privacidad y seguridad</strong> → <strong>Micrófono</strong></li>
          <li>Verifica que "Acceso al micrófono" esté <strong>Activado</strong></li>
          <li>Verifica que "Permitir que las aplicaciones accedan al micrófono" esté <strong>Activado</strong></li>
          <li>Verifica que tu navegador (Chrome/Edge) esté en la lista de permitidos</li>
          <li>Si no aparece nada, el problema es de hardware (sigue abajo)</li>
        </ol>

        <h4 className="font-semibold mb-2">🔌 Verificar hardware del micrófono</h4>
        <ol className="list-decimal list-inside space-y-1 text-xs mb-3">
          <li>Clic derecho en el ícono de altavoz (esquina inferior derecha) → <strong>Configuración de sonido</strong></li>
          <li>En "Entrada" debe aparecer tu micrófono</li>
          <li>Si dice "No se encontraron dispositivos":
            <ul className="list-disc list-inside ml-4 mt-1">
              <li>Si es USB: prueba otro puerto</li>
              <li>Si es jack: prueba el conector rosa (no verde)</li>
              <li>Si es laptop: puede estar dañado</li>
            </ul>
          </li>
          <li>Habla y mira la barra de "Nivel de entrada" — debe moverse</li>
        </ol>

        <h4 className="font-semibold mb-2">🔒 Si otra app está bloqueando el micrófono</h4>
        <p className="text-xs mb-2">Solo una app puede usar el micrófono a la vez. Cierra:</p>
        <ul className="list-disc list-inside text-xs space-y-1 mb-3">
          <li>Zoom, Microsoft Teams, Google Meet, Discord, Skype</li>
          <li>Otras pestañas del navegador con cámara/micrófono activo</li>
          <li>Software de streaming (OBS)</li>
        </ul>

        <h4 className="font-semibold mb-2">🍎 Mac</h4>
        <ol className="list-decimal list-inside space-y-1 text-xs mb-3">
          <li><strong>Preferencias del Sistema</strong> → <strong>Seguridad y Privacidad</strong> → <strong>Micrófono</strong></li>
          <li>Verifica que tu navegador esté en la lista con check ✅</li>
          <li>Si no aparece, abre el navegador y vuelve a esta página</li>
        </ol>

        <h4 className="font-semibold mb-2">📱 Android / iOS</h4>
        <ol className="list-decimal list-inside space-y-1 text-xs">
          <li><strong>Configuración</strong> → <strong>Aplicaciones</strong> → tu navegador → <strong>Permisos</strong> → <strong>Micrófono</strong> → Permitir</li>
          <li>En iOS Safari, la voz no funciona bien — usa Chrome</li>
        </ol>
      </div>

      {/* Botón reintentar */}
      <Button
        className="w-full"
        onClick={() => {
          setError(null);
          stopLiveMeter();
          setRecordedBlob(null);
          setTestStatus('idle');
          if (navigator.permissions) {
            navigator.permissions.query({ name: 'microphone' as PermissionName })
              .then((r) => setPermissionState(r.state as any))
              .catch(() => {});
          }
          onErrorResolved?.();
        }}
      >
        <RefreshCw size={14} className="mr-2" /> Reintentar diagnóstico
      </Button>
    </div>
  );
}
