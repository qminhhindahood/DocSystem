from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import shutil
import tempfile
import logging
from pathlib import Path
from werkzeug.utils import secure_filename
from self_test import probe_docling_conversion
import asyncio

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Docling PDF Parser Service", version="2.0.0")

UPLOAD_DIR = os.environ.get("DOCLING_UPLOAD_DIR", "/app/uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# ─── File validation helpers ─────────────────────────────────────────────────

MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB; keep aligned with the API upload limit

def _validate_and_save(file: UploadFile) -> str:
    """Validate upload, save to disk with a unique tempfile path, return absolute path."""
    if not file.filename or not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    # Enforce file size limit
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File size exceeds maximum limit of {MAX_FILE_SIZE // (1024*1024)}MB")

    # Derive suffix from original filename (keep extension for downstream parsers)
    from werkzeug.utils import secure_filename
    suffix = Path(secure_filename(file.filename or "upload.pdf")).suffix.lower() or ".pdf"
    if suffix != ".pdf":
        suffix = ".pdf"

    # Use a unique tempfile per call — two simultaneous "same.pdf" get different paths
    with tempfile.NamedTemporaryFile(
        prefix="docling_", suffix=suffix, dir=UPLOAD_DIR, delete=False,
    ) as target:
        shutil.copyfileobj(file.file, target)
        file_path = target.name

    # Path traversal guard: realpath must live inside UPLOAD_DIR
    real_path = os.path.realpath(file_path)
    real_upload = os.path.realpath(UPLOAD_DIR)
    if not real_path.startswith(real_upload + os.sep) and real_path != real_upload:
        os.remove(file_path)
        raise HTTPException(status_code=400, detail="Invalid file path")

    try:
        with open(file_path, "rb") as saved_file:
            if saved_file.read(5) != b"%PDF-":
                raise HTTPException(status_code=400, detail="Invalid PDF file")
    except HTTPException:
        _cleanup(file_path)
        raise
    except OSError as error:
        _cleanup(file_path)
        raise HTTPException(status_code=400, detail="Unable to validate PDF file") from error

    return file_path


def _cleanup(file_path: Optional[str]) -> None:
    """Remove uploaded file from disk (best-effort)."""
    if file_path and os.path.exists(file_path):
        try:
            os.remove(file_path)
            logger.debug(f"Cleaned up uploaded file: {file_path}")
        except Exception as e:
            logger.warning(f"Failed to clean up file {file_path}: {e}")


# ─── Docling availability probe ──────────────────────────────────────────────

_DOCLING_AVAILABLE: Optional[bool] = None
_DOCLING_PROBE: Dict[str, Any] = {}
_PARSE_LOCK = asyncio.Lock()

def _check_docling() -> bool:
    """Run one real conversion to prove Docling is usable, then cache the result."""
    global _DOCLING_AVAILABLE, _DOCLING_PROBE
    if _DOCLING_AVAILABLE is None:
        try:
            _DOCLING_PROBE = probe_docling_conversion()
            _DOCLING_AVAILABLE = True
            logger.info(
                "Docling conversion probe passed (version=%s)",
                _DOCLING_PROBE.get("doclingVersion", "unknown"),
            )
        except Exception as error:
            _DOCLING_AVAILABLE = False
            _DOCLING_PROBE = {"status": "failed", "errorType": type(error).__name__}
            logger.exception("Docling conversion probe failed; service is not ready")
    return _DOCLING_AVAILABLE


# ─── Parsing strategies ──────────────────────────────────────────────────────

class ParseResult(BaseModel):
    success: bool
    filename: str
    text: str
    tables: Optional[List[Dict[str, Any]]]
    metadata: Dict[str, Any]


def _parse_with_docling(file_path: str, safe_filename: str, do_ocr: bool = True) -> ParseResult:
    """Parse PDF using Docling's DocumentConverter for layout-aware markdown output."""
    from docling.document_converter import DocumentConverter, PdfFormatOption
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions

    pipeline_options = PdfPipelineOptions()
    pipeline_options.do_ocr = do_ocr
    pipeline_options.do_table_structure = True

    # docling API: PdfFormatOption pre-wires the PDF backend + StandardPdfPipeline;
    # we only override pipeline_options on top.
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)}
    )
    result = converter.convert(file_path)

    # Export as Markdown — preserves headings, tables, lists
    text = result.document.export_to_markdown()

    # Extract tables separately as structured dicts
    tables = []
    try:
        for table in result.document.tables:
            tables.append({"data": table.export_to_dataframe().to_dict()})
    except Exception as e:
        logger.warning(f"Table extraction failed (non-fatal): {e}")

    page_count = 0
    try:
        page_count = result.document.num_pages()
    except Exception:
        pass

    return ParseResult(
        success=True,
        filename=safe_filename,
        text=text,
        tables=tables if tables else None,
        metadata={
            "pages": page_count,
            "parser": "Docling",
            "output_format": "markdown",
            "ocr_used": pipeline_options.do_ocr,
            "table_count": len(tables),
        },
    )


def _parse_with_pymupdf(file_path: str, safe_filename: str) -> ParseResult:
    """Fallback parser using PyMuPDF (fitz) — basic text extraction only."""
    import fitz  # PyMuPDF

    TESSERACT_AVAILABLE = False
    try:
        import pytesseract
        from PIL import Image
        import io as _io
        TESSERACT_AVAILABLE = True
    except ImportError:
        pass

    doc = fitz.open(file_path)
    text = ""
    page_count = len(doc)
    ocr_used = False

    for page_num, page in enumerate(doc):
        page_text = page.get_text()
        if page_text.strip():
            text += page_text
        elif TESSERACT_AVAILABLE:
            # Fallback to OCR only for this specific page
            logger.info(f"Page {page_num + 1} has no text, attempting OCR...")
            pix = page.get_pixmap(dpi=300)
            img_data = pix.tobytes("png")
            img = Image.open(_io.BytesIO(img_data))
            ocr_text = pytesseract.image_to_string(img, lang="vie+eng")
            text += f"\n--- Page {page_num + 1} ---\n{ocr_text}"
            ocr_used = True
        else:
            logger.warning(f"Page {page_num + 1} has no text and Tesseract not available")

    doc.close()

    parser_label = "PyMuPDF + Tesseract OCR" if ocr_used else "PyMuPDF"

    return ParseResult(
        success=True,
        filename=safe_filename,
        text=text,
        tables=None,  # Table extraction requires Docling
        metadata={
            "pages": page_count,
            "parser": parser_label,
            "output_format": "plaintext",
            "ocr_used": ocr_used,
        },
    )


# ─── Endpoints ───────────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "docling",
        "version": "2.0.0",
        "docling_available": _check_docling(),
    }


@app.get("/live")
async def live():
    """Process-level liveness probe — always 200 if the server is running."""
    return {"status": "alive"}


@app.get("/ready")
async def ready():
    """Return 200 only after Docling has successfully converted a real PDF."""
    if not os.path.isdir(UPLOAD_DIR):
        return JSONResponse(status_code=503, content={"status": "not ready", "detail": "upload directory missing"})
    if not os.access(UPLOAD_DIR, os.W_OK):
        return JSONResponse(status_code=503, content={"status": "not ready", "detail": "upload directory is not writable"})
    if not _check_docling():
        return JSONResponse(
            status_code=503,
            content={"status": "not ready", "detail": "Docling conversion capability unavailable"},
        )
    return {
        "status": "ready",
        "docling_available": True,
        "docling_version": _DOCLING_PROBE.get("doclingVersion"),
        "conversion_probe": "passed",
    }


@app.post("/parse", response_model=ParseResult)
async def parse_pdf(file: UploadFile = File(...), do_ocr: bool = True):
    """
    Parse a PDF file and extract text, tables, and layout information.

    Parser Selection:
    -----------------
    1. Primary: Docling DocumentConverter (layout-aware, structured Markdown output,
       table extraction, OCR support).
    2. Fallback: PyMuPDF (fitz) for basic text extraction when Docling is unavailable.

    Returns:
        ParseResult with extracted text (Markdown if Docling, plaintext if PyMuPDF)
        and metadata including the parser used.
    """
    file_path = None
    try:
        safe_filename = secure_filename(file.filename or "upload.pdf")
        if not safe_filename.endswith('.pdf'):
            safe_filename += '.pdf'
        file_path = _validate_and_save(file)

        # Strategy 1: Docling (preferred)
        if _check_docling():
            try:
                async with _PARSE_LOCK:
                    return await asyncio.to_thread(
                        _parse_with_docling,
                        file_path,
                        safe_filename,
                        do_ocr,
                    )
            except Exception as e:
                logger.warning(f"Docling parse failed, falling back to PyMuPDF: {e}")

        # Strategy 2: PyMuPDF fallback
        try:
            async with _PARSE_LOCK:
                return await asyncio.to_thread(_parse_with_pymupdf, file_path, safe_filename)
        except ImportError:
            return ParseResult(
                success=True,
                filename=safe_filename,
                text="[PDF parsing available after PyMuPDF/Docling installation]",
                tables=None,
                metadata={
                    "pages": 0,
                    "parser": "placeholder",
                    "note": "Install PyMuPDF (pip install pymupdf) or Docling for full PDF parsing",
                },
            )
        except Exception as e:
            logger.error(f"PyMuPDF parse error: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=str(e))

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PDF parsing error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _cleanup(file_path)


@app.post("/parse/table")
async def parse_tables_only(file: UploadFile = File(...)):
    """
    Parse only tables from a PDF file.
    Requires Docling with table structure enabled.
    """
    file_path = None
    try:
        file_path = _validate_and_save(file)
        safe_filename = secure_filename(file.filename or "upload.pdf")
        if not safe_filename.endswith('.pdf'):
            safe_filename += '.pdf'

        if not _check_docling():
            return JSONResponse(content={
                "success": False,
                "error": "Docling not installed. Install with: pip install docling",
            })

        def _extract_tables():
            from docling.document_converter import DocumentConverter
            from docling.datamodel.pipeline_options import PdfPipelineOptions

            pipeline_options = PdfPipelineOptions()
            pipeline_options.do_ocr = False
            pipeline_options.do_table_structure = True
            pipeline_options.table_structure_options.do_cell_matching = True

            converter = DocumentConverter(pipeline_options=pipeline_options)
            result = converter.convert(file_path)
            return [
                {"data": table.export_to_dataframe().to_dict()}
                for table in result.document.tables
            ]

        async with _PARSE_LOCK:
            tables = await asyncio.to_thread(_extract_tables)

        return JSONResponse(content={
            "success": True,
            "filename": safe_filename,
            "tables": tables,
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Table parsing error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _cleanup(file_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
