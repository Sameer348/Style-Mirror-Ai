import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ClothesTryOn } from "@/components/ClothesTryOn";
import type { Health } from "@/lib/api";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const health = (over: Partial<Health> = {}): Health => ({
  status: "ok",
  provider: "replicate",
  provider_display_name: "Replicate (IDM-VTON model)",
  provider_note: "",
  tryon_configured: true,
  auth_enabled: false,
  history_enabled: false,
  require_auth: false,
  max_upload_mb: 12,
  history_retention_days: 30,
  job_result_ttl_seconds: 1800,
  ...over,
});

const img = (name: string) => new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText("Your photo"), img("me.jpg"));
  await user.upload(screen.getByLabelText("Clothing photo"), img("shirt.jpg"));
}

afterEach(() => vi.unstubAllGlobals());

describe("ClothesTryOn", () => {
  it("blocks generation and explains when the provider is not configured", () => {
    render(<ClothesTryOn health={health({ tryon_configured: false })} healthError={null} onRetryHealth={() => {}} />);
    expect(screen.getByText(/not configured on the server/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate/i })).toBeDisabled();
  });

  it("requires consent before generating", async () => {
    const user = userEvent.setup();
    render(<ClothesTryOn health={health()} healthError={null} onRetryHealth={() => {}} />);
    await fillForm(user);
    const button = screen.getByRole("button", { name: /generate/i });
    expect(button).toBeDisabled();
    expect(screen.getByText(/tick the consent box/i)).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox"));
    expect(button).toBeEnabled();
    expect(screen.getByText(/Replicate \(IDM-VTON model\)/)).toBeInTheDocument();
  });

  it("rejects unsupported file types client-side", async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ClothesTryOn health={health()} healthError={null} onRetryHealth={() => {}} />);
    await user.upload(screen.getByLabelText("Your photo"), new File(["x"], "doc.pdf", { type: "application/pdf" }));
    expect(screen.getByRole("alert")).toHaveTextContent(/JPG, PNG or WEBP/);
  });

  it("runs a job, shows the result and offers download", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.endsWith("/api/tryon/jobs")) return json({ id: "j1", status: "queued", progress: null, message: "Queued" }, 202);
      if (url.endsWith("/result")) return new Response(new Blob(["img"], { type: "image/png" }));
      return json({ id: "j1", status: "succeeded", progress: 100, message: "Done", result_url: "/api/tryon/jobs/j1/result" });
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<ClothesTryOn health={health()} healthError={null} onRetryHealth={() => {}} />);
    await fillForm(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /generate/i }));
    expect(await screen.findByRole("img", { name: /AI-generated try-on result/ }, { timeout: 4000 })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /download result/i })).toHaveAttribute("download");
    const body = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(body.get("consent")).toBe("true");
    expect(body.get("category")).toBe("upper_body");
  });

  it("shows provider failures with a retry button instead of a fake result", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.endsWith("/api/tryon/jobs")
          ? json({ id: "j1", status: "queued" }, 202)
          : json({ id: "j1", status: "failed", error: "Replicate rate limit reached.", retryable: true }),
      ),
    );
    const user = userEvent.setup();
    render(<ClothesTryOn health={health()} healthError={null} onRetryHealth={() => {}} />);
    await fillForm(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: /generate/i }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Replicate rate limit reached."), {
      timeout: 4000,
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /try-on result/ })).not.toBeInTheDocument();
  });

  it("surfaces backend outages", () => {
    render(<ClothesTryOn health={null} healthError="Could not reach the server" onRetryHealth={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Could not reach the server/);
  });
});
