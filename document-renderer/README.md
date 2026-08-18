# Private open-source DOCX renderer

This internal .NET service uses Open XML as the only authoritative DOCX editor. LibreOffice Writer exports disposable DOCX copies to PDF, Poppler rasterizes preview pages, and fontconfig reports substitutions. It contains no proprietary renderer, license, or font bundle.

Generated DOCX files are published only after package, locator, static-part, and floating-geometry verification. Visual checks are best effort: a structurally valid file remains downloadable when rendering is unavailable or page/font differences are detected, and the response includes machine-readable fidelity warnings.

Common free substitutions include Times New Roman → Liberation Serif, Arial → Liberation Sans, Calibri → Carlito, and Cambria → Caladea. LibreOffice plus these substitutes cannot guarantee Microsoft Word-identical layout for every arbitrary DOCX.

The service is not published to a host port in Compose. Internal analyze and render requests require the shared `X-Renderer-Token`.

`GET /ready` fails closed unless the token is safe, storage and temporary roots are writable, LibreOffice/Poppler are executable, required fonts resolve, and the bundled one-page smoke document renders successfully.

```powershell
dotnet test .\DocumentRenderer.sln
dotnet build .\DocumentRenderer.sln -c Release
```
