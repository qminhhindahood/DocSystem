import Link from 'next/link';
import { publicSiteDisplayConfig } from '@/lib/server/public-site-config';
import { PolicyLinks } from './PolicyLinks';

export function PolicyLayout({
  title,
  intro,
  children,
}: {
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  const config = publicSiteDisplayConfig();
  return (
    <div className="min-h-screen bg-canvas px-4 py-8 text-text-primary sm:px-6 sm:py-12">
      <article className="mx-auto max-w-3xl rounded-panel border border-hairline bg-surface p-6 sm:p-10">
        <Link href="/" className="text-control font-semibold text-action hover:text-action-hover">
          ← DocAI
        </Link>
        <header className="mt-6 border-b border-hairline pb-6">
          <h1 className="text-display-md">{title}</h1>
          <p className="mt-3 text-body text-text-secondary">{intro}</p>
          <dl className="mt-4 grid gap-1 text-metadata text-text-muted sm:grid-cols-2">
            <div><dt className="inline font-medium">Đơn vị vận hành: </dt><dd className="inline">{config.operatorName}</dd></div>
            <div><dt className="inline font-medium">Phạm vi pháp lý: </dt><dd className="inline">{config.operatorJurisdiction}</dd></div>
            <div><dt className="inline font-medium">Ngày hiệu lực: </dt><dd className="inline">{config.policyEffectiveDate}</dd></div>
            <div><dt className="inline font-medium">Hỗ trợ: </dt><dd className="inline"><a className="text-action" href={`mailto:${config.supportEmail}`}>{config.supportEmail}</a></dd></div>
          </dl>
        </header>
        <div className="policy-content mt-7 space-y-7 text-body text-text-secondary">{children}</div>
        <PolicyLinks className="mt-10 flex flex-wrap gap-x-5 gap-y-2 border-t border-hairline pt-6 text-control text-text-secondary" />
      </article>
    </div>
  );
}

export function PolicySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-section-title text-text-primary">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  );
}
