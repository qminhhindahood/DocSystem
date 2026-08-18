# Phase 7: Self-Learning Feedback Loop

> Current backend note: Feedback concepts remain valid, but backend route and service snippets are legacy Python examples. Current feedback requires an authenticated user and a persisted `documentId`; see `../reference/CURRENT_BACKEND_CONTRACT.md`.

## 7.1 Feedback Capture System

When users edit and save generated documents, capture the changes to improve future outputs.

```python
# backend/services/feedback.py
from typing import Dict, List, Tuple
import difflib
from dataclasses import dataclass

@dataclass
class EditDiff:
    original: str
    edited: str
    added: List[str]
    removed: List[str]
    changed: List[Tuple[str, str]]
    similarity_score: float

class FeedbackCollector:
    """
    Capture user edits and transform them into training examples.
    """

    def __init__(self, rag_service, ollama_service):
        self.rag = rag_service
        self.ollama = ollama_service

    async def capture_feedback(
        self,
        session_id: str,
        generated_doc: Dict,
        edited_doc: str,
        user_id: str,
        metadata: Dict
    ) -> Dict:
        """
        Process user edits and store for self-learning.
        """

        # 1. Compute diff
        diff = self.compute_diff(generated_doc, edited_doc)

        # 2. Classify edit type
        edit_type = self.classify_edit_type(diff)

        # 3. Store feedback
        feedback_id = await self.store_feedback(
            session_id=session_id,
            generated=generated_doc,
            edited=edited_doc,
            diff=diff,
            edit_type=edit_type,
            user_id=user_id,
            metadata=metadata
        )

        # 4. Trigger RAG update (if significant changes)
        if edit_type in ['structural', 'legal', 'formatting']:
            await self._update_rag_with_approved_version(edited_doc, feedback_id)

        # 5. Schedule fine-tuning if enough examples accumulated
        await self._check_fine_tune_trigger()

        return {"feedback_id": feedback_id, "edit_type": edit_type}

    def compute_diff(self, generated: Dict, edited: str) -> EditDiff:
        """Compute textual differences between generated and edited."""
        gen_content = generated.get('content', '')

        # Normalize whitespace for comparison
        gen_norm = self._normalize(gen_content)
        edit_norm = self._normalize(edited)

        # Use difflib for change detection
        differ = difflib.Differ()
        diff_lines = list(differ.compare(gen_norm.splitlines(), edit_norm.splitlines()))

        added = [line[2:] for line in diff_lines if line.startswith('+ ')]
        removed = [line[2:] for line in diff_lines if line.startswith('- ')]
        changed = self._detect_changes(removed, added)

        # Calculate similarity
        similarity = difflib.SequenceMatcher(None, gen_norm, edit_norm).ratio()

        return EditDiff(
            original=gen_content,
            edited=edited,
            added=added,
            removed=removed,
            changed=changed,
            similarity_score=similarity
        )

    def _normalize(self, text: str) -> str:
        """Normalize Vietnamese text for diffing."""
        import re
        # Remove extra whitespace, normalize line breaks
        text = re.sub(r'\s+', ' ', text)
        text = re.sub(r'[ \t]*\n[ \t]*', '\n', text)
        return text.strip()

    def _detect_changes(self, removed: List[str], added: List[str]) -> List[Tuple[str, str]]:
        """Detect line-by-line changes."""
        changes = []
        for r in removed:
            for a in added:
                if self._similar(r, a) and len(r) > 10:
                    changes.append((r, a))
        return changes

    def _similar(self, a: str, b: str) -> bool:
        """Check if two lines are semantically similar (edit rather than add/remove)."""
        from difflib import SequenceMatcher
        return SequenceMatcher(None, a, b).ratio() > 0.7

    def classify_edit_type(self, diff: EditDiff) -> str:
        """
        Classify the nature of edits:
        - formatting: Minor whitespace, punctuation
        - wording: Word/phrase changes preserving meaning
        - structural: Reorganization of document
        - legal: Changes to legal references or binding text
        - correction: Fixing typos/errors
        """
        if diff.similarity_score > 0.95:
            return 'minor'

        # Check for legal pattern changes (Điều, Khoản references)
        legal_patterns = [r'Điều\s+\d+', r'Khoản\s+\d+', r'Nghị định', r'Luật']
        has_legal_change = any(
            re.search(p, removed) or re.search(p, added)
            for p in legal_patterns
            for removed, added in [(r, a) for r in diff.removed for a in diff.added]
        )

        if has_legal_change:
            return 'legal'

        # Check for structural changes (section reordering)
        if len(diff.removed) > 5 or len(diff.added) > 5:
            return 'structural'

        # Check for Decree 30/2020 format compliance
        format_patterns = [
            r'(Số:|Số\s+:)',
            r'(Hà Nội|TP\. HCM|Đà Nẵng),.*ngày.*tháng.*năm',
            r'(Ký tên|Chữ ký)'
        ]
        has_format_change = any(
            p in diff.edited for p in format_patterns
        ) if diff.added else False

        if has_format_change:
            return 'formatting'

        return 'wording'

    async def store_feedback(
        self,
        session_id: str,
        generated: Dict,
        edited: str,
        diff: EditDiff,
        edit_type: str,
        user_id: str,
        metadata: Dict
    ) -> str:
        """Store feedback in database."""
        # Save to feedback table
        feedback = await self.db.feedback.create(
            data={
                "sessionId": session_id,
                "generatedContent": json.dumps(generated),
                "editedContent": edited,
                "diff": json.dumps({
                    "added": diff.added,
                    "removed": diff.removed,
                    "similarity": diff.similarity_score
                }),
                "editType": edit_type,
                "metadata": {
                    "user_id": user_id,
                    **metadata
                }
            }
        )
        return feedback.id

    async def _update_rag_with_approved_version(self, edited_doc: str, feedback_id: str):
        """
        Add the user-approved edited version to RAG as a positive example.
        This is the self-learning component.
        """
        # Re-chunk the approved document
        chunks = await self._chunk_approved_doc(edited_doc, feedback_id)

        # Store in RAG with high weight/priority
        for chunk in chunks:
            chunk.metadata['source'] = 'user_approved'
            chunk.metadata['feedback_id'] = feedback_id
            chunk.metadata['priority'] = 1.5  # Boost in search

        await self.rag.store_chunk_embeddings(chunks)

    async def _check_fine_tune_trigger(self):
        """
        Check if we have enough feedback examples for fine-tuning.
        Trigger: 50+ examples of a specific edit type.
        """
        counts = await self.db.feedback.group_by({
            by: ['editType'],
            _count: { editType: true }
        })

        for count in counts:
            if count._count['editType'] >= 50:
                await self._queue_fine_tune_job(count.editType, count._count)

    async def _queue_fine_tune_job(self, edit_type: str, count: int):
        """Queue a LoRA fine-tuning job."""
        # Implementation in Phase 8
        pass
```

## 7.2 Document Re-chunking for RAG

```python
# backend/services/feedback_rechunker.py
class FeedbackRechunker(LegalDocumentChunker):
    """
    Re-chunk user-approved documents for RAG.
    Preserves the edits as high-quality examples.
    """

    async def chunk_for_feedback(self, content: str, feedback_id: str) -> List[Chunk]:
        """
        Chunk approved document with metadata linking back to original generation.
        """
        # Parse to extract structure
        elements = self._parse_vietnamese_doc(content)

        chunks = []
        for elem in elements:
            chunk = Chunk(
                content=elem['text'],
                doc_id=f"feedback_{feedback_id}",
                chunk_type=elem['type'],
                level=elem['level'],
                metadata={
                    'source': 'user_approved',
                    'feedback_id': feedback_id,
                    'created_at': datetime.now().isoformat(),
                    'priority': 1.5,  # Higher weight in search
                    'user_approved': True
                }
            )
            chunks.append(chunk)

        return chunks
```

## 7.3 Webhook for Frontend Callback

```python
# backend/routes/feedback.py
from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/feedback", tags=["feedback"])

@router.post("/capture")
async def capture_feedback(request: Request):
    """
    Frontend calls this when user saves edited document.
    """
    data = await request.json()

    collector = FeedbackCollector(rag_service, ollama_service)

    result = await collector.capture_feedback(
        session_id=data['session_id'],
        generated_doc=data['generated_doc'],
        edited_doc=data['edited_doc'],
        user_id=data.get('user_id'),
        metadata=data.get('metadata', {})
    )

    return {"success": True, **result}

@router.get("/stats")
async def get_feedback_stats():
    """Get feedback statistics for dashboard."""
    stats = await db.feedback.group_by({
        by: ['editType'],
        _count: { editType: true },
        _avg: { similarity: true }
    })

    return {"stats": stats}
```

## 7.4 Frontend Feedback Component

```tsx
// frontend/components/FeedbackPanel.tsx
'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

interface FeedbackPanelProps {
  sessionId: string;
  generatedDoc: any;
  onFeedbackSaved: () => void;
}

export default function FeedbackPanel({
  sessionId,
  generatedDoc,
  onFeedbackSaved,
}: FeedbackPanelProps) {
  const [editedContent, setEditedContent] = useState(JSON.stringify(generatedDoc, null, 2));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [satisfaction, setSatisfaction] = useState<number>(3); // 1-5

  const handleSaveFeedback = async () => {
    setIsSubmitting(true);

    try {
      await api.post('/api/feedback/capture', {
        session_id: sessionId,
        generated_doc: generatedDoc,
        edited_doc: editedContent,
        satisfaction_score: satisfaction,
        user_id: 'current_user', // From auth context
      });

      alert('Cảm ơn phản hồi! Hệ thống sẽ học hỏi từ chỉnh sửa của bạn.');
      onFeedbackSaved();
    } catch (error) {
      console.error('Feedback submission failed:', error);
      alert('Gửi phản hồi thất bại. Vui lòng thử lại.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-6">
      <h3 className="font-semibold mb-4">Phản hồi & Cải tiến hệ thống</h3>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">
          Mức độ hài lòng với văn bản (1-5)
        </label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              onClick={() => setSatisfaction(n)}
              className={`w-10 h-10 rounded-full ${
                satisfaction >= n ? 'bg-yellow-400' : 'bg-gray-200'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">
          Chỉnh sửa của bạn (so sánh với bản gốc)
        </label>
        <textarea
          value={editedContent}
          onChange={(e) => setEditedContent(e.target.value)}
          className="w-full h-64 p-2 border rounded font-mono text-sm"
          placeholder="Chỉnh sửa văn bản..."
        />
      </div>

      <button
        onClick={handleSaveFeedback}
        disabled={isSubmitting}
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
      >
        {isSubmitting ? 'Đang lưu...' : 'Lưu & Học hỏi'}
      </button>

      <p className="text-xs text-gray-500 mt-2">
        Hệ thống sẽ học từ chỉnh sửa của bạn để cải thiện kết quả trong tương lai.
      </p>
    </div>
  );
}
```

## 7.5 Feedback Dashboard (Admin)

```typescript
// frontend/app/admin/feedback/page.tsx
import { useQuery } from '@tanstack/react-query';

export default function FeedbackDashboard() {
  const { data: stats } = useQuery({
    queryKey: ['feedback', 'stats'],
    queryFn: async () => {
      const res = await api.get('/api/feedback/stats');
      return res.data;
    },
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Phản hồi người dùng</h1>

      <div className="grid grid-cols-4 gap-4 mb-8">
        {stats?.stats?.map((s: any) => (
          <div key={s.editType} className="bg-white p-4 rounded shadow">
            <h3 className="text-sm text-gray-600">{s.editType}</h3>
            <p className="text-3xl font-bold">{s._count.editType}</p>
            <p className="text-sm text-gray-500">
              Similarity: {(s._avg.similarity * 100).toFixed(1)}%
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
```
