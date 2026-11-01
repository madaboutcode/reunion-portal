import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { FileUpload } from "./FileUpload";

afterEach(cleanup);

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFile(name: string, type: string, size = 1024): File {
  const content = new Uint8Array(size);
  return new File([content], name, { type });
}

function uploadFile(file: File) {
  const input = screen.getByTestId("file-input");
  act(() => {
    fireEvent.change(input, { target: { files: [file] } });
  });
}

// ── Interaction: click, drag, keyboard (R7, R8, R12, R15) ────────────────────

describe("FileUpload — click and keyboard (R7, R15)", () => {
  // R7: clicking the drop zone delegates to the hidden file input
  it("R7 — clicking the drop zone triggers a click on the hidden file input", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);

    const input = screen.getByTestId("file-input");
    const inputClickSpy = vi.spyOn(input, "click");

    const dropZone = screen.getByRole("button");
    act(() => {
      fireEvent.click(dropZone);
    });

    expect(inputClickSpy).toHaveBeenCalledTimes(1);
  });

  it("R7 — does not open file picker when disabled", () => {
    render(<FileUpload onFileSelect={vi.fn()} disabled={true} />);

    const input = screen.getByTestId("file-input");
    const inputClickSpy = vi.spyOn(input, "click");

    const dropZone = screen.getByRole("button");
    act(() => {
      fireEvent.click(dropZone);
    });

    expect(inputClickSpy).not.toHaveBeenCalled();
  });

  // R15: Enter key opens file picker
  it("R15 — Enter key on the drop zone triggers a click on the hidden file input", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);

    const input = screen.getByTestId("file-input");
    const inputClickSpy = vi.spyOn(input, "click");

    const dropZone = screen.getByRole("button");
    act(() => {
      fireEvent.keyDown(dropZone, { key: "Enter" });
    });

    expect(inputClickSpy).toHaveBeenCalledTimes(1);
  });

  // R15: Space key opens file picker
  it("R15 — Space key on the drop zone triggers a click on the hidden file input", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);

    const input = screen.getByTestId("file-input");
    const inputClickSpy = vi.spyOn(input, "click");

    const dropZone = screen.getByRole("button");
    act(() => {
      fireEvent.keyDown(dropZone, { key: " " });
    });

    expect(inputClickSpy).toHaveBeenCalledTimes(1);
  });

  // R15: Other keys do NOT open file picker
  it("R15 — other keys do not trigger the file picker", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);

    const input = screen.getByTestId("file-input");
    const inputClickSpy = vi.spyOn(input, "click");

    const dropZone = screen.getByRole("button");
    act(() => {
      fireEvent.keyDown(dropZone, { key: "Tab" });
    });

    expect(inputClickSpy).not.toHaveBeenCalled();
  });

  // R15: drop zone is keyboard focusable (tabIndex=0 when not disabled)
  it("R15 — drop zone has tabIndex=0 when not disabled", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);
    const dropZone = screen.getByRole("button");
    expect(dropZone).toHaveAttribute("tabIndex", "0");
  });

  it("R15 — drop zone has tabIndex=-1 when disabled", () => {
    render(<FileUpload onFileSelect={vi.fn()} disabled={true} />);
    const dropZone = screen.getByRole("button");
    expect(dropZone).toHaveAttribute("tabIndex", "-1");
  });
});

describe("FileUpload — drag-over visual feedback (R8)", () => {
  // R8: dragenter adds aqua border highlight class
  it("R8 — dragenter adds border-soft-aqua class to the drop zone", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);

    const dropZone = screen.getByRole("button");
    expect(dropZone.className).not.toContain("border-soft-aqua");

    act(() => {
      fireEvent.dragEnter(dropZone, {
        dataTransfer: { files: [] },
      });
    });

    expect(dropZone.className).toContain("border-soft-aqua");
  });

  // R8: dragleave removes the highlight
  it("R8 — dragleave removes the border-soft-aqua highlight", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);

    const dropZone = screen.getByRole("button");

    act(() => {
      fireEvent.dragEnter(dropZone, { dataTransfer: { files: [] } });
    });
    expect(dropZone.className).toContain("border-soft-aqua");

    act(() => {
      fireEvent.dragLeave(dropZone, { dataTransfer: { files: [] } });
    });
    expect(dropZone.className).not.toContain("border-soft-aqua");
  });

  // R8: dragover keeps highlight active (does not remove it)
  it("R8 — dragover does not clear the border-soft-aqua highlight", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);

    const dropZone = screen.getByRole("button");

    act(() => {
      fireEvent.dragEnter(dropZone, { dataTransfer: { files: [] } });
    });
    act(() => {
      fireEvent.dragOver(dropZone, { dataTransfer: { files: [] } });
    });

    expect(dropZone.className).toContain("border-soft-aqua");
  });

  // R8: drag highlight is NOT applied when disabled
  it("R8 — drag highlight is suppressed when disabled", () => {
    render(<FileUpload onFileSelect={vi.fn()} disabled={true} />);

    const dropZone = screen.getByRole("button");

    act(() => {
      fireEvent.dragEnter(dropZone, { dataTransfer: { files: [] } });
    });

    expect(dropZone.className).not.toContain("border-soft-aqua");
  });
});

describe("FileUpload — validation failure clears selection (R12)", () => {
  // R12: invalid file type — no file state retained
  it("R12 — invalid file type shows error and does not retain the file", () => {
    const onFileSelect = vi.fn();
    render(<FileUpload onFileSelect={onFileSelect} />);

    const input = screen.getByTestId("file-input");
    const invalidFile = makeFile("script.exe", "application/octet-stream");

    act(() => {
      fireEvent.change(input, { target: { files: [invalidFile] } });
    });

    // Error message rendered (appears in both visible <p> and sr-only live region)
    const errorMessages = screen.getAllByText(/Invalid file type/i);
    expect(errorMessages.length).toBeGreaterThan(0);
    // onFileSelect called with null (not the file)
    expect(onFileSelect).toHaveBeenCalledWith(null);
    // Filename is NOT shown
    expect(screen.queryByText("script.exe")).not.toBeInTheDocument();
  });

  // R12: oversized file — no file state retained
  it("R12 — oversized file shows error and does not retain the file", () => {
    const onFileSelect = vi.fn();
    render(<FileUpload onFileSelect={onFileSelect} maxSizeMB={1} />);

    const input = screen.getByTestId("file-input");
    // 2 MB file — exceeds 1 MB limit
    const bigFile = makeFile("photo.jpg", "image/jpeg", 2 * 1024 * 1024);

    act(() => {
      fireEvent.change(input, { target: { files: [bigFile] } });
    });

    const errorMessages = screen.getAllByText(/File too large/i);
    expect(errorMessages.length).toBeGreaterThan(0);
    expect(onFileSelect).toHaveBeenCalledWith(null);
    expect(screen.queryByText("photo.jpg")).not.toBeInTheDocument();
  });

  // R12: 0-byte file — no file state retained
  it("R12 — zero-byte file shows error and does not retain the file", () => {
    const onFileSelect = vi.fn();
    render(<FileUpload onFileSelect={onFileSelect} />);

    const input = screen.getByTestId("file-input");
    const emptyFile = makeFile("photo.jpg", "image/jpeg", 0);

    act(() => {
      fireEvent.change(input, { target: { files: [emptyFile] } });
    });

    const errorMessages = screen.getAllByText(/File is empty/i);
    expect(errorMessages.length).toBeGreaterThan(0);
    expect(onFileSelect).toHaveBeenCalledWith(null);
  });
});

// ── Accessibility (R16, R17) ──────────────────────────────────────────────────

describe("FileUpload — accessibility (R16, R17)", () => {
  // R16: aria-live="polite" on error container
  it("R16 — error container has aria-live=\"polite\" when an internal error is shown", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);

    const input = screen.getByTestId("file-input");
    const invalidFile = makeFile("script.exe", "application/octet-stream");

    act(() => {
      fireEvent.change(input, { target: { files: [invalidFile] } });
    });

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
  });

  it("R16 — error container has aria-live=\"polite\" when an external error prop is provided", () => {
    render(<FileUpload onFileSelect={vi.fn()} error="Required field" />);

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion).toHaveTextContent("Required field");
  });

  it("R16 — aria-live region is not present when there is no error", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).not.toBeInTheDocument();
  });

  // R17: screen-reader-only error announcement is visually hidden (sr-only)
  it("R17 — error announcement element has sr-only class to visually hide it", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);

    const input = screen.getByTestId("file-input");
    const invalidFile = makeFile("script.exe", "application/octet-stream");

    act(() => {
      fireEvent.change(input, { target: { files: [invalidFile] } });
    });

    const liveRegion = document.querySelector('[aria-live="polite"]');
    expect(liveRegion).toHaveClass("sr-only");
  });

  // R17: visible upload icon SVG is hidden from assistive technology (aria-hidden)
  it("R17 — upload icon SVG is aria-hidden so screen readers skip the drag instruction", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);
    // The upload SVG in empty state has aria-hidden="true"
    const svgs = document.querySelectorAll('svg[aria-hidden="true"]');
    expect(svgs.length).toBeGreaterThan(0);
  });
});

// ── MIME pattern acceptance (R12 extension) ───────────────────────────────────

describe("FileUpload — MIME glob and full MIME type acceptance", () => {
  it("accepts a JPEG when accept='image/*'", () => {
    const onFileSelect = vi.fn();
    render(<FileUpload onFileSelect={onFileSelect} accept="image/*" />);

    uploadFile(makeFile("photo.jpg", "image/jpeg"));

    expect(onFileSelect).toHaveBeenCalledWith(expect.any(File));
    expect(onFileSelect).not.toHaveBeenCalledWith(null);
  });

  it("accepts a PNG when accept='image/*'", () => {
    const onFileSelect = vi.fn();
    render(<FileUpload onFileSelect={onFileSelect} accept="image/*" />);

    uploadFile(makeFile("image.png", "image/png"));

    expect(onFileSelect).toHaveBeenCalledWith(expect.any(File));
  });

  it("rejects a PDF when accept='image/*'", () => {
    const onFileSelect = vi.fn();
    render(<FileUpload onFileSelect={onFileSelect} accept="image/*" />);

    uploadFile(makeFile("doc.pdf", "application/pdf"));

    expect(onFileSelect).toHaveBeenCalledWith(null);
    const errorMessages = screen.getAllByText(/Invalid file type/i);
    expect(errorMessages.length).toBeGreaterThan(0);
  });

  it("accepts a PDF when accept='application/pdf'", () => {
    const onFileSelect = vi.fn();
    render(<FileUpload onFileSelect={onFileSelect} accept="application/pdf" />);

    uploadFile(makeFile("doc.pdf", "application/pdf"));

    expect(onFileSelect).toHaveBeenCalledWith(expect.any(File));
  });

  it("rejects a JPEG when accept='application/pdf'", () => {
    const onFileSelect = vi.fn();
    render(<FileUpload onFileSelect={onFileSelect} accept="application/pdf" />);

    uploadFile(makeFile("photo.jpg", "image/jpeg"));

    expect(onFileSelect).toHaveBeenCalledWith(null);
  });

  it("shows 'Images' hint for accept='image/*'", () => {
    render(<FileUpload onFileSelect={vi.fn()} accept="image/*" />);
    expect(screen.getByText(/Images up to/i)).toBeInTheDocument();
  });

  it("shows 'PDF' hint for accept='application/pdf'", () => {
    render(<FileUpload onFileSelect={vi.fn()} accept="application/pdf" />);
    expect(screen.getByText(/PDF up to/i)).toBeInTheDocument();
  });
});

// ── Preview feature (R18–R21) ─────────────────────────────────────────────────

describe("FileUpload — preview prop", () => {
  const FAKE_OBJECT_URL = "blob:http://localhost/fake-uuid";

  beforeEach(() => {
    // jsdom does not implement URL.createObjectURL — define stubs before spying
    URL.createObjectURL = vi.fn().mockReturnValue(FAKE_OBJECT_URL);
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  // R18: image preview
  it("shows an img thumbnail for a JPEG file when preview=true", () => {
    const onFileSelect = vi.fn();
    render(<FileUpload onFileSelect={onFileSelect} preview={true} />);

    const file = makeFile("photo.jpg", "image/jpeg");
    uploadFile(file);

    const img = screen.getByTestId("file-preview-image");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", FAKE_OBJECT_URL);
    // R20: createObjectURL called with the file
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
  });

  it("shows an img thumbnail for a PNG file when preview=true", () => {
    render(<FileUpload onFileSelect={vi.fn()} preview={true} />);
    uploadFile(makeFile("image.png", "image/png"));

    expect(screen.getByTestId("file-preview-image")).toBeInTheDocument();
  });

  // R19: PDF icon
  it("shows a PDF icon placeholder for a PDF file when preview=true", () => {
    render(<FileUpload onFileSelect={vi.fn()} preview={true} />);
    uploadFile(makeFile("document.pdf", "application/pdf"));

    expect(screen.getByTestId("file-preview-pdf")).toBeInTheDocument();
    // No img element for PDFs
    expect(screen.queryByTestId("file-preview-image")).not.toBeInTheDocument();
    // createObjectURL should NOT be called for PDFs (no object URL needed)
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  // R21: preview absent — behavior unchanged
  it("shows no preview when preview prop is absent", () => {
    render(<FileUpload onFileSelect={vi.fn()} />);
    uploadFile(makeFile("photo.jpg", "image/jpeg"));

    expect(screen.queryByTestId("file-preview-image")).not.toBeInTheDocument();
    expect(screen.queryByTestId("file-preview-pdf")).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("shows no preview when preview=false", () => {
    render(<FileUpload onFileSelect={vi.fn()} preview={false} />);
    uploadFile(makeFile("photo.jpg", "image/jpeg"));

    expect(screen.queryByTestId("file-preview-image")).not.toBeInTheDocument();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  // R20: URL revocation on file removal
  it("revokes the object URL when the file is removed", () => {
    render(<FileUpload onFileSelect={vi.fn()} preview={true} />);
    uploadFile(makeFile("photo.jpg", "image/jpeg"));

    expect(screen.getByTestId("file-preview-image")).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByLabelText("Remove file"));
    });

    expect(screen.queryByTestId("file-preview-image")).not.toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(FAKE_OBJECT_URL);
  });
});
