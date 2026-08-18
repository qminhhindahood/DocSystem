'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const SCRIPT_ID = 'cloudflare-turnstile-script';
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileWidgetProps {
  siteKey: string;
  action: 'signup';
  resetKey: number;
  onToken(token: string | null): void;
  onError(message: string): void;
}

export function TurnstileWidget({ siteKey, action, resetKey, onToken, onError }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [loading, setLoading] = useState(true);

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile) return;
    if (widgetIdRef.current) window.turnstile.remove(widgetIdRef.current);
    containerRef.current.replaceChildren();
    onToken(null);
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      action,
      theme: 'auto',
      size: 'flexible',
      callback: token => { setLoading(false); onToken(token); },
      'expired-callback': () => { onToken(null); onError('Phiên xác minh đã hết hạn. Vui lòng xác minh lại.'); },
      'error-callback': () => { onToken(null); onError('Không thể tải bước xác minh. Vui lòng thử lại.'); },
    });
    setLoading(false);
  }, [action, onError, onToken, siteKey]);

  useEffect(() => {
    if (window.turnstile) {
      renderWidget();
      return () => { if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current); };
    }
    let script = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement('script');
      script.id = SCRIPT_ID;
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    const handleLoad = () => renderWidget();
    const handleError = () => { setLoading(false); onError('Không thể tải bước xác minh. Vui lòng thử lại.'); };
    script.addEventListener('load', handleLoad);
    script.addEventListener('error', handleError);
    return () => {
      script?.removeEventListener('load', handleLoad);
      script?.removeEventListener('error', handleError);
      if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
    };
  }, [onError, renderWidget, resetKey]);

  return (
    <div>
      <div ref={containerRef} aria-label="Xác minh chống bot" />
      <p className="mt-2 text-metadata text-text-secondary" role="status" aria-live="polite">
        {loading ? 'Đang tải bước xác minh…' : 'Hoàn tất bước xác minh để tạo tài khoản.'}
      </p>
    </div>
  );
}
