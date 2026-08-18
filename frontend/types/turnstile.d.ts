interface TurnstileRenderOptions {
  sitekey: string;
  action: string;
  theme?: 'auto' | 'light' | 'dark';
  size?: 'normal' | 'compact' | 'flexible';
  callback(token: string): void;
  'expired-callback'(): void;
  'error-callback'(): void;
}

interface TurnstileApi {
  render(element: HTMLElement, options: TurnstileRenderOptions): string;
  remove(widgetId: string): void;
}

interface Window {
  turnstile?: TurnstileApi;
}
