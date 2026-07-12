'use client';

import { cn } from '@/lib/utils';

interface ArcReactorProps {
  /** Estado del reactor */
  state?: 'idle' | 'thinking' | 'speaking' | 'error';
  size?: number;
  className?: string;
}

/**
 * Reactor Arc animado estilo Iron Man / Tony Stark.
 *
 * Estados:
 * - idle: brillo suave estático
 * - thinking: anillos rotan lentamente (Abbax procesando)
 * - speaking: pulsa rápido (Abbax hablando)
 * - error: parpadea rojo
 */
export function ArcReactor({ state = 'idle', size = 48, className }: ArcReactorProps) {
  const colorByState = {
    idle: '#06b6d4',       // cyan
    thinking: '#a855f7',   // violeta
    speaking: '#10b981',   // verde esmeralda
    error: '#ef4444',      // rojo
  };
  const color = colorByState[state];

  return (
    <div
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      aria-label={`Abbax ${state}`}
      role="img"
    >
      <svg
        viewBox="0 0 100 100"
        className={cn(
          'transition-all duration-300',
          state === 'speaking' && 'animate-pulse',
          state === 'error' && 'animate-pulse'
        )}
        style={{
          width: '100%',
          height: '100%',
          filter: `drop-shadow(0 0 ${state === 'idle' ? 4 : 10}px ${color})`,
        }}
      >
        {/* Glow exterior */}
        <circle cx="50" cy="50" r="48" fill={color} opacity="0.08" />

        {/* Anillo exterior — rota cuando piensa */}
        <g
          style={{
            transformOrigin: '50px 50px',
            animation:
              state === 'thinking'
                ? 'abbax-spin 3s linear infinite'
                : state === 'speaking'
                ? 'abbax-spin 1.2s linear infinite'
                : 'none',
          }}
        >
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            opacity="0.4"
            strokeDasharray="8 4"
          />
        </g>

        {/* Anillo medio — rota en sentido contrario */}
        <g
          style={{
            transformOrigin: '50px 50px',
            animation:
              state === 'thinking'
                ? 'abbax-spin-reverse 4s linear infinite'
                : state === 'speaking'
                ? 'abbax-spin-reverse 1.5s linear infinite'
                : 'none',
          }}
        >
          <circle
            cx="50"
            cy="50"
            r="34"
            fill="none"
            stroke={color}
            strokeWidth="2"
            opacity="0.6"
            strokeDasharray="20 6"
          />
        </g>

        {/* Anillo interior con segmentos (estilo Iron Man) */}
        <g
          style={{
            transformOrigin: '50px 50px',
            animation:
              state === 'thinking'
                ? 'abbax-spin 2s linear infinite'
                : 'none',
          }}
        >
          {[0, 60, 120, 180, 240, 300].map((deg) => (
            <rect
              key={deg}
              x="48"
              y="14"
              width="4"
              height="10"
              fill={color}
              opacity="0.85"
              transform={`rotate(${deg} 50 50)`}
            />
          ))}
        </g>

        {/* Núcleo central — siempre brillante */}
        <circle
          cx="50"
          cy="50"
          r="14"
          fill={color}
          opacity="0.3"
        />
        <circle
          cx="50"
          cy="50"
          r="10"
          fill={color}
          opacity="0.6"
        />
        <circle
          cx="50"
          cy="50"
          r="6"
          fill={color}
          opacity="1"
        />

        {/* Highlight blanco del centro */}
        <circle cx="48" cy="48" r="2" fill="white" opacity="0.9" />
      </svg>

      <style jsx>{`
        @keyframes abbax-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes abbax-spin-reverse {
          from { transform: rotate(360deg); }
          to { transform: rotate(0deg); }
        }
      `}</style>
    </div>
  );
}
