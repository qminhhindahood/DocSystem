import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import DocumentDetailModal from "@/components/DocumentDetailModal";
import TemplatePreviewModal from "@/components/TemplatePreviewModal";

// Stubs render aria-hidden like real lucide icons so they never leak into
// accessible names.
vi.mock("lucide-react", () => {
  const icon = (name: string) => {
    const Stub = () => <span aria-hidden="true" data-testid={`${name}-icon`}>{name}</span>;
    Stub.displayName = `${name}Icon`;
    return Stub;
  };
  return {
    X: icon("x"),
    Download: icon("download"),
    FileText: icon("file"),
    Calendar: icon("calendar"),
    AlertTriangle: icon("alert-triangle"),
    CheckCircle: icon("check-circle"),
    CheckCircle2: icon("check-circle-2"),
    XCircle: icon("x-circle"),
    Info: icon("info"),
    EyeOff: icon("eye-off"),
    Loader2: icon("loader"),
  };
});

// Mock the download function from api
vi.mock("@/lib/api", () => ({
  downloadDocumentAsDocx: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

const sampleDocument = {
  id: "doc-1",
  docType: "quyet-dinh",
  title: "Quyết định bổ nhiệm",
  content: "Nội dung quyết định bổ nhiệm ông Nguyễn Văn A...",
  status: "published",
  createdAt: "2025-06-15T10:00:00Z",
  updatedAt: "2025-06-15T10:00:00Z",
  _count: { chunks: 1, feedback: 0 },
  chunks: [
    { id: "chunk-1", content: "Điều 1: Bổ nhiệm...", level: 1 },
  ],
  feedback: [],
};

const sampleTemplate = {
  id: "tpl-1",
  name: "Mẫu quyết định chung",
  docType: "quyet-dinh",
  status: "READY" as const,
  updatedAt: "2025-06-10T08:00:00Z",
  createdAt: "2025-06-10T08:00:00Z",
  analysisConfidence: 1,
  rejectionCode: null,
  rejectionReason: null,
  fileSize: 1024,
  content: "Nội dung mẫu văn bản...",
};

describe("DocumentDetailModal", () => {
  it("renders document title and content when open", () => {
    render(
      <DocumentDetailModal
        document={sampleDocument}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Quyết định bổ nhiệm")).toBeDefined();
    expect(screen.getByText(/Nội dung quyết định/)).toBeDefined();
  });

  it("renders chunks section when chunks exist", () => {
    render(
      <DocumentDetailModal
        document={sampleDocument}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Đoạn 1/)).toBeDefined();
    expect(screen.getByText("Điều 1: Bổ nhiệm...")).toBeDefined();
  });

  it("does not render content when closed", () => {
    render(
      <DocumentDetailModal
        document={sampleDocument}
        open={false}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Quyết định bổ nhiệm")).toBeNull();
  });

  it("shows export button", () => {
    render(
      <DocumentDetailModal
        document={sampleDocument}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Xuất DOCX")).toBeDefined();
  });

  it("shows fallback title when document has no title", () => {
    const noTitle = { ...sampleDocument, title: "" };
    render(
      <DocumentDetailModal
        document={noTitle}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Văn bản chưa đặt tên")).toBeDefined();
  });

  it("calls onOpenChange when close button clicked", async () => {
    const onOpenChange = vi.fn();
    render(
      <DocumentDetailModal
        document={sampleDocument}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );
    const closeBtn = screen.getByLabelText("Đóng");
    await userEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalled();
  });

  it("requires explicit confirmation before exporting", async () => {
    const { downloadDocumentAsDocx } = await import("@/lib/api");
    render(
      <DocumentDetailModal
        document={sampleDocument}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Xuất DOCX" }));

    // The export has not started yet; the dialog names the file and format first.
    expect(downloadDocumentAsDocx).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog", { name: "Xuất tài liệu" });
    expect(dialog).toHaveTextContent("Quyết định bổ nhiệm.docx");
    expect(dialog).toHaveTextContent("DOCX");

    await userEvent.click(within(dialog).getByRole("button", { name: "Xuất DOCX" }));

    expect(downloadDocumentAsDocx).toHaveBeenCalledWith("doc-1", "Quyết định bổ nhiệm");
  });

  it("keeps the export dialog open and reports a failure in place", async () => {
    const { downloadDocumentAsDocx } = await import("@/lib/api");
    vi.mocked(downloadDocumentAsDocx).mockRejectedValueOnce(new Error("network"));
    render(
      <DocumentDetailModal
        document={sampleDocument}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Xuất DOCX" }));
    const dialog = screen.getByRole("dialog", { name: "Xuất tài liệu" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Xuất DOCX" }));

    expect(await screen.findByRole("dialog", { name: "Xuất tài liệu" })).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Không thể xuất tài liệu. Vui lòng thử lại.",
    );
  });

  it("does not claim a validation result the backend did not supply", () => {
    render(
      <DocumentDetailModal
        document={sampleDocument}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    // sampleDocument has no generation metadata, so no trust summary is shown.
    expect(screen.queryByLabelText("Thông tin tin cậy của tài liệu")).toBeNull();
    expect(screen.queryByText(/Đã đạt/)).toBeNull();
  });
});

describe("TemplatePreviewModal", () => {
  it("renders template name and content when open", () => {
    render(
      <TemplatePreviewModal
        template={sampleTemplate}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Mẫu quyết định chung")).toBeDefined();
    expect(screen.getByText("Nội dung mẫu văn bản...")).toBeDefined();
  });

  it("does not render when closed", () => {
    render(
      <TemplatePreviewModal
        template={sampleTemplate}
        open={false}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.queryByText("Mẫu quyết định chung")).toBeNull();
  });

  it("shows placeholder when template has no content", () => {
    const noContent = { ...sampleTemplate, content: undefined };
    render(
      <TemplatePreviewModal
        template={noContent}
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    expect(screen.getByText("Nội dung mẫu chưa được tải.")).toBeDefined();
  });

  it("calls onOpenChange when close button clicked", async () => {
    const onOpenChange = vi.fn();
    render(
      <TemplatePreviewModal
        template={sampleTemplate}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );
    const closeBtn = screen.getByLabelText("Đóng");
    await userEvent.click(closeBtn);
    expect(onOpenChange).toHaveBeenCalled();
  });
});
