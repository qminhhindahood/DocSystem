import { prisma } from '../utils/prisma';
import { fuseTemplate } from './template_compiler';

interface PendingTemplate {
  id: string;
  ownerId: string;
  originalPath: string | null;
  originalSha256: string | null;
}

interface TemplateCompilationStore {
  recoverStale(staleBefore: Date): Promise<void>;
  next(): Promise<PendingTemplate | null>;
  failInvalid(template: PendingTemplate): Promise<void>;
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultStore(): TemplateCompilationStore {
  return {
    async recoverStale(staleBefore) {
      await prisma.template.updateMany({
        where: { status: 'ANALYZING', updatedAt: { lt: staleBefore } },
        data: { status: 'UPLOADED', rejectionCode: null, rejectionReason: null },
      });
    },
    next: () => prisma.template.findFirst({
      where: { status: 'UPLOADED' },
      orderBy: { createdAt: 'asc' },
      select: { id: true, ownerId: true, originalPath: true, originalSha256: true },
    }),
    async failInvalid(template) {
      await prisma.template.updateMany({
        where: { id: template.id, ownerId: template.ownerId, status: 'UPLOADED' },
        data: { status: 'FAILED', rejectionCode: 'ORIGINAL_UNAVAILABLE' },
      });
    },
  };
}

export class TemplateCompilationWorker {
  private stopping = true;
  private ready = false;
  private loopPromise: Promise<void> | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private wakePoll: (() => void) | null = null;

  constructor(
    private readonly store: TemplateCompilationStore = defaultStore(),
    private readonly pollMs = positiveInteger(process.env.TEMPLATE_WORKER_POLL_MS, 1_000),
    private readonly staleMs = 15 * 60_000,
  ) {}

  get state(): 'starting' | 'running' | 'stopping' | 'stopped' {
    if (!this.loopPromise) return 'stopped';
    if (this.stopping) return 'stopping';
    return this.ready ? 'running' : 'starting';
  }

  start(): void {
    if (!this.stopping) return;
    this.stopping = false;
    this.ready = false;
    this.loopPromise = this.runLoop();
  }

  async stop(graceMs = 30_000): Promise<void> {
    this.stopping = true;
    this.ready = false;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.wakePoll?.();
    const loop = this.loopPromise;
    if (!loop) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        loop,
        new Promise<void>(resolve => { timer = setTimeout(resolve, graceMs); }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      if (this.loopPromise === loop) this.loopPromise = null;
    }
  }

  async runOnce(): Promise<'idle' | 'processed'> {
    const template = await this.store.next();
    if (!template) return 'idle';
    if (!template.originalPath || !template.originalSha256) {
      await this.store.failInvalid(template);
      return 'processed';
    }
    try {
      await fuseTemplate(template.id, template.ownerId, {
        templateId: template.id,
        relativePath: template.originalPath,
        sha256: template.originalSha256,
      });
    } catch (error: any) {
      // A second process may have won the atomic UPLOADED -> ANALYZING claim.
      if (error?.statusCode !== 409) {
        console.error(`[TemplateCompilationWorker] Compilation failed for ${template.id}`);
      }
    }
    return 'processed';
  }

  private async runLoop(): Promise<void> {
    try {
      await this.store.recoverStale(new Date(Date.now() - this.staleMs));
      this.ready = true;
      while (!this.stopping) {
        try {
          if (await this.runOnce() === 'idle') await this.waitForPoll();
        } catch (error) {
          console.error('[TemplateCompilationWorker] Poll failed:', error);
          await this.waitForPoll();
        }
      }
    } finally {
      this.ready = false;
    }
  }

  private waitForPoll(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    return new Promise(resolve => {
      const finish = () => {
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.pollTimer = null;
        this.wakePoll = null;
        resolve();
      };
      this.wakePoll = finish;
      this.pollTimer = setTimeout(finish, this.pollMs);
    });
  }
}

export function createDefaultTemplateCompilationWorker(): TemplateCompilationWorker {
  return new TemplateCompilationWorker();
}
