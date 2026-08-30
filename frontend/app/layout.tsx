import type { Metadata } from 'next';
import { Be_Vietnam_Pro, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { MotionProvider } from '@/components/providers/MotionProvider';
import { QueryProvider } from '@/components/providers/QueryProvider';
import { ThemeProvider } from '@/components/providers/ThemeProvider';

const beVietnam = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-be-vietnam',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin', 'vietnamese'],
  weight: ['400', '500'],
  display: 'swap',
  variable: '--font-jetbrains',
});

export const metadata: Metadata = {
  title: 'DocAI — Chuyển đổi PDF sang DOCX',
  description:
    'Chuyển đổi PDF sang DOCX theo Nghị định 30, kèm báo cáo độ tin cậy và độ bao phủ.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="vi"
      suppressHydrationWarning
      className={`${beVietnam.variable} ${jetbrains.variable}`}
    >
      <body>
        <QueryProvider>
          <ThemeProvider>
            <MotionProvider>
              <AuthProvider>{children}</AuthProvider>
            </MotionProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
