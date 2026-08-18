/**
 * Global loading skeleton shown during page transitions.
 * Next.js 14 App Router convention.
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div
        role="status"
        aria-live="polite"
        aria-label="Đang tải"
        className="w-full max-w-md space-y-4"
      >
        <div aria-hidden="true" className="skeleton h-8 w-2/3" />
        <div aria-hidden="true" className="skeleton h-4 w-full" />
        <div aria-hidden="true" className="skeleton h-4 w-5/6" />
        <span className="sr-only">Đang tải</span>
      </div>
    </div>
  );
}
