"""Docling import and real PDF conversion capability probe."""

import argparse
import hashlib
import json
import platform
import tempfile
from datetime import datetime, timezone
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Dict


EVIDENCE_PACKAGES = (
    "docling",
    "fastapi",
    "uvicorn",
    "python-multipart",
    "pydantic",
    "PyMuPDF",
    "Werkzeug",
    "pytesseract",
    "Pillow",
)


def _package_versions() -> Dict[str, str]:
    packages: Dict[str, str] = {}
    for package in EVIDENCE_PACKAGES:
        try:
            packages[package] = version(package)
        except PackageNotFoundError:
            packages[package] = "missing"
    return packages


def probe_docling_conversion() -> Dict[str, Any]:
    """Convert a generated one-page PDF and return reproducible probe evidence."""
    import fitz
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions
    from docling.document_converter import DocumentConverter, PdfFormatOption

    options = PdfPipelineOptions()
    options.do_ocr = False
    options.do_table_structure = False
    converter = DocumentConverter(
        format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=options)}
    )

    with tempfile.TemporaryDirectory(prefix="docling-self-test-") as temp_dir:
        pdf_path = Path(temp_dir) / "probe.pdf"
        document = fitz.open()
        page = document.new_page()
        page.insert_text((72, 72), "Docling readiness probe")
        document.save(pdf_path)
        document.close()

        result = converter.convert(str(pdf_path))
        markdown = result.document.export_to_markdown()
        if "Docling readiness probe" not in markdown:
            raise RuntimeError("Docling conversion completed without expected probe text")

    requirements_path = Path(__file__).with_name("requirements.txt")
    return {
        "status": "passed",
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "doclingVersion": version("docling"),
        "pythonVersion": platform.python_version(),
        "packages": _package_versions(),
        "requirementsSha256": (
            hashlib.sha256(requirements_path.read_bytes()).hexdigest()
            if requirements_path.exists()
            else None
        ),
        "probeTextSha256": hashlib.sha256(markdown.encode("utf-8")).hexdigest(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", help="Optional JSON evidence output path")
    args = parser.parse_args()

    try:
        evidence = probe_docling_conversion()
        exit_code = 0
    except Exception as error:
        evidence = {
            "status": "failed",
            "checkedAt": datetime.now(timezone.utc).isoformat(),
            "reason": f"{type(error).__name__}: {error}",
        }
        exit_code = 1

    if args.output:
        output = Path(args.output)
        output.write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
