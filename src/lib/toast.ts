'use client';

// Wrapper simple sobre el sistema de toasts de shadcn
// Uso: import { toast } from '@/lib/toast'
// toast.success('Mensaje'), toast.error('Error'), toast.info('Info')

import { useToast } from '@/hooks/use-toast';

let _toast: any = null;

// Hook que debe llamarse en el componente raíz para registrar el toast
export function useToastBridge() {
  const t = useToast();
  _toast = t.toast;
  return t;
}

function push(variant: 'default' | 'destructive', title: string, description?: string) {
  if (!_toast) {
    // Fallback a alert si no está inicializado
    if (description) alert(`${title}\n\n${description}`);
    else alert(title);
    return;
  }
  _toast({
    title,
    description,
    variant,
  });
}

export const toast = {
  success: (msg: string, desc?: string) => push('default', `✅ ${msg}`, desc),
  error: (msg: string, desc?: string) => push('destructive', `❌ ${msg}`, desc),
  info: (msg: string, desc?: string) => push('default', `ℹ️ ${msg}`, desc),
  warning: (msg: string, desc?: string) => push('default', `⚠️ ${msg}`, desc),
};
