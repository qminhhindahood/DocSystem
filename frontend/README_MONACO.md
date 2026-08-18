# Monaco Editor Integration for Vietnamese Government Documents

This document explains the Monaco Editor integration for the AI-powered Vietnamese government document generation system.

## Overview

The Monaco Editor is the same editor that powers Visual Studio Code in the browser. This integration provides a professional, Word-like interface for editing administrative documents compliant with **Decree 30/2020/NĐ-CP**.

## Components Created

### 1. `DocumentEditor.tsx` - Core Monaco Integration

The main editor component with:
- **Custom Vietnamese language support** (`vndocument`)
- **Syntax highlighting** for document structure elements:
  - `Điều` (Article)
  - `Khoản` (Clause)
  - `Điểm` (Point)
  - Document headers (CỘNG HÒA, QUYẾT ĐỊNH, CHI THỊ, etc.)
- **Auto-completion** for Vietnamese administrative terms
- **Template insertion** for common document types
- **Change tracking** for the self-learning feedback loop

**Key Features:**
```typescript
- Word wrap enabled for document formatting
- Minimap for navigation
- IntelliSense with Vietnamese keywords
- Custom tokenization for legal document structure
- Real-time change capture
```

### 2. `StreamingDocumentEditor.tsx` - AI Streaming Support

Enhanced editor with real-time AI content streaming:
- **Real-time streaming** as AI generates content
- **Status indicators** (streaming, complete, ready)
- **Accept/Reject** suggestion functionality
- **Document statistics** (characters, words, lines)
- **Progress bar** during generation
- **Edit feedback capture** for self-learning loop

**Usage:**
```tsx
<StreamingDocumentEditor
  initialValue={generatedContent}
  isStreaming={isGenerating}
  onUserEdit={handleUserEdit}
  onEditFeedback={handleEditFeedback}
  documentType="quyet-dinh"
/>
```

### 3. `DocumentDiffViewer.tsx` - Side-by-Side Comparison

Diff viewer for comparing document versions:
- **Side-by-side comparison** (original vs. modified)
- **Color-coded changes**:
  - Green: Additions
  - Red: Deletions
  - Yellow: Modifications
- **Accept/Reject** diff actions
- **Change statistics**

## Custom Language Configuration

### Vietnamese Document Language (`vndocument`)

The custom language provider includes:

**Tokenization Rules:**
- `Điều/Khoản/Điểm` → Keywords
- Document headers → Titles
- Administrative terms → Keywords
- Dates → Numbers
- Roles/Positions → Types

**Auto-Completion:**
```typescript
VIETNAMESE_COMPLETIONS = [
  "Điều", "Khoản", "Điểm",
  "Căn cứ", "Theo đó", "Vì vậy",
  "Ủy ban nhân dân", "Chủ tịch",
  "Quyết định", "Chỉ thị", "Báo cáo",
  // ... 30+ administrative terms
]
```

**Document Templates:**
- Quyết định (Decision)
- Chỉ thị (Directive)
- Báo cáo (Report)

## Integration with Self-Learning Loop

The editor captures edit feedback for the LoRA fine-tuning pipeline:

```
User edits document
    ↓
Diff computed (original vs. edited)
    ↓
Feedback sent to /api/feedback
    ↓
Stored in PostgreSQL for training
    ↓
Accumulate 50+ examples
    ↓
Trigger LoRA training
```

## Component Hierarchy

```
GenerationPage (page.tsx)
├── Control Panel
│   ├── Document Type Selector
│   ├── File Upload
│   ├── Prompt Input
│   └── Generate Button
└── Editor Area
    ├── StreamingDocumentEditor
    │   └── DocumentEditor (Monaco)
    └── DocumentDiffViewer
        └── Monaco Diff Editor
```

## Styling

### Tailwind CSS Integration
- Custom animations (pulse, spin)
- Gradient backgrounds
- Responsive grid layouts
- Custom scrollbars for Monaco

### Monaco Custom Styles
```css
/* Custom editor colors */
.monaco-editor {
  --vscode-editor-background: #ffffff;
  --vscode-editor-foreground: #1e1e1e;
}

/* Diff editor colors */
.deltaInsertLine { background-color: rgba(180, 240, 180, 0.3); }
.deltaRemoveLine { background-color: rgba(240, 180, 180, 0.3); }
```

## File Structure

```
frontend/
├── app/
│   ├── generate/
│   │   └── page.tsx          # Main generation page
│   └── globals.css            # Global styles + Monaco CSS
├── components/
│   ├── DocumentEditor.tsx     # Core Monaco integration
│   ├── StreamingDocumentEditor.tsx  # Streaming wrapper
│   └── DocumentDiffViewer.tsx       # Diff comparison
├── package.json
├── tailwind.config.js
├── tsconfig.json
└── postcss.config.js
```

## API Integration

### Edit Feedback Endpoint
```typescript
POST /api/feedback
{
  "original": "Original document text",
  "edited": "User-edited text",
  "documentType": "quyet-dinh"
}
```

### Document Generation Endpoint (Future)
```typescript
POST /api/workflow/generate
{
  "prompt": "User request",
  "documentType": "quyet-dinh",
  "referencePdf": "base64-encoded PDF"
}
```

## Installation & Setup

```bash
cd frontend
npm install
npm run dev
```

**Dependencies:**
- `@monaco-editor/react` ^4.6.0
- `monaco-editor` ^0.49.0
- `next` 14.0.4+
- `react` 18.2.0+
- `tailwindcss` 3.4.0+

## Usage Example

```tsx
import StreamingDocumentEditor from '@/components/StreamingDocumentEditor';

export default function MyComponent() {
  const [content, setContent] = useState("");
  
  return (
    <StreamingDocumentEditor
      initialValue={content}
      isStreaming={false}
      documentType="quyet-dinh"
      onUserEdit={(value) => setContent(value)}
      onEditFeedback={(original, edited) => {
        console.log("User made changes!");
      }}
    />
  );
}
```

## Performance Considerations

- **Lazy loading** via `dynamic()` import with `ssr: false`
- **Debounced** change events to reduce API calls
- **Virtualized** rendering for large documents
- **GPU-accelerated** rendering via Monaco's canvas backend

## Future Enhancements

1. **Collaborative Editing** - Real-time multi-user editing via WebSockets
2. **Version History** - Track and restore previous versions
3. **Export to PDF** - Print-ready document generation
4. **Validation** - Decree 30/2020 compliance checking
5. **Spell Check** - Vietnamese language support
6. **Accessibility** - ARIA labels and keyboard navigation

## References

- [Monaco Editor Documentation](https://microsoft.github.io/monaco-editor/)
- [@monaco-editor/react](https://www.npmjs.com/package/@monaco-editor/react)
- [Decree 30/2020/NĐ-CP](https://thuvienphapluat.vn/)

---

**Created:** 2026-05-14  
**For:** AI Document System for Vietnamese Government  
**Compliance:** Decree 30/2020/NĐ-CP