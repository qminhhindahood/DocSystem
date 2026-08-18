# Phase 2: PDF Parsing Microservice

## 2.1 Docling Service Setup

Docling by IBM is the best choice for Vietnamese legal/educational PDFs with complex layouts.

```bash
# Create separate microservice directory
cd ~
mkdir docling-service
cd docling-service

# Python environment
python -m venv venv
source venv/bin/activate

# Install Docling and dependencies
pip install docling[full] fastapi uvicorn[standard]
pip install "docling[models]"  # Download ML models
```

### `docling-service/main.py`
```python
from fastapi import FastAPI, UploadFile, File, HTTPException
from docling.document_converter import DocumentConverter, PdfFormatOption
from docling.datamodel.base_models import InputFormat
from docling.datamodel.pipeline_options import PdfPipelineOptions
from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
import tempfile
import os
import json
from typing import List, Dict, Any
import logging

app = FastAPI(title="Docling PDF Parser Service")
logger = logging.getLogger(__name__)

@app.post("/parse")
async def parse_pdf(file: UploadFile = File(...)) -> Dict[str, Any]:
    """Parse PDF and return structured Markdown with metadata."""
    if not file.filename.endswith('.pdf'):
        raise HTTPException(400, "Only PDF files supported")

    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Configure Docling for optimal Vietnamese text extraction
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = True
        pipeline_options.do_table_structure = True
        pipeline_options.table_structure_options.do_cell_matching = True

        converter = DocumentConverter(
            allowed_formats=[InputFormat.PDF],
            format_options={
                InputFormat.PDF: PdfFormatOption(
                    pipeline_options=pipeline_options,
                    backend=PyPdfiumDocumentBackend
                )
            }
        )

        result = converter.convert(tmp_path)

        # Extract structured document
        document = {
            "filename": file.filename,
            "metadata": {
                "num_pages": result.document.num_pages(),
                "language": result.document.metadata.language,
            },
            "content": result.document.export_to_markdown(),
            "elements": extract_elements(result.document),
            "tables": extract_tables(result.document),
        }

        return document

    finally:
        os.unlink(tmp_path)

def extract_elements(document) -> List[Dict]:
    """Extract hierarchical elements (articles, clauses, points)."""
    elements = []

    for item in document.texts:
        element = {
            "text": item.text,
            "page": item.page,
            "bbox": item.bbox.as_tuple() if item.bbox else None,
            "type": infer_element_type(item.text),
            "level": infer_level(item.text)
        }
        elements.append(element)

    return elements

def infer_element_type(text: str) -> str:
    """Infer legal document structure from Vietnamese text patterns."""
    patterns = {
        'article': r'^(Điều|Đ\.)\s*\d+',
        'clause': r'^\(\d+\)\s+',
        'point': r'^[a-z]\)\s+',
        'chapter': r'^(Chương|Ch\.)\s+',
        'section': r'^(Mục|M\.)\s+',
    }

    text_lower = text.lower().strip()
    for elem_type, pattern in patterns.items():
        if re.match(pattern, text_lower):
            return elem_type
    return 'content'

def infer_level(text: str) -> int:
    """Infer hierarchy level (0=doc, 1=chapter, 2=section, 3=article, 4=clause, 5=point)."""
    text_lower = text.lower().strip()
    if re.match(r'^(chương|ch\.)\s+', text_lower):
        return 1
    if re.match(r'^(mục|m\.)\s+', text_lower):
        return 2
    if re.match(r'^(điều|đ\.)\s+\d+', text_lower):
        return 3
    if re.match(r'^\(\d+\)\s+', text_lower):
        return 4
    if re.match(r'^[a-z]\)\s+', text_lower):
        return 5
    return 0

def extract_tables(document) -> List[Dict]:
    """Extract table data preserving structure."""
    tables = []
    for table in document.tables:
        table_data = {
            "page": table.page,
            "rows": len(table.data),
            "cols": len(table.data[0]) if table.data else 0,
            "data": table.data,
            "caption": table.caption if hasattr(table, 'caption') else None
        }
        tables.append(table_data)
    return tables

@app.get("/health")
async def health():
    return {"status": "healthy", "service": "docling-parser"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
```

### Dockerfile for Docling Service
```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies for PDF rendering
RUN apt-get update && apt-get install -y \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
```

### Docker Compose Integration
```yaml
services:
  docling:
    build: ./docling-service
    ports:
      - "8001:8001"
    volumes:
      - ./uploads:/app/uploads
    deploy:
      resources:
        limits:
          memory: 4G
```
