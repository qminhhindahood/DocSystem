import { ResearcherAgent } from './orchestrator';
import { ragService } from './rag_service';
import type { AccessScope } from '../utils/document_access';

describe('ResearcherAgent access boundaries', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not attempt private document retrieval without an explicit access scope', async () => {
    const search = jest.spyOn(ragService, 'search').mockResolvedValue([]);
    const researcher = new ResearcherAgent(ragService);
    const events: any[] = [];

    for await (const event of researcher.research('Điều 1. Nội dung cần soạn', 'cong-van')) {
      events.push(event);
    }

    expect(search).not.toHaveBeenCalled();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ skipped: true }),
      expect.objectContaining({ count: 0, results: [] }),
    ]));
  });

  it('propagates the role-free user scope to every RAG search', async () => {
    const search = jest.spyOn(ragService, 'search').mockResolvedValue([]);
    const researcher = new ResearcherAgent(ragService);
    const access: AccessScope = { kind: 'user', userId: 'user-a' };

    for await (const _event of researcher.research(
      'Mở đầu\nĐiều 1. Nội dung thứ nhất\nĐiều 2. Nội dung thứ hai',
      'cong-van',
      'user-a',
      access,
    )) {
      // Drain the real async generator so every topic is searched.
    }

    expect(search).toHaveBeenCalled();
    for (const call of search.mock.calls) {
      expect(call[2]).toBe('cong-van');
      expect(call[3]).toBe(access);
    }
  });
});
