import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConsentDialog } from "@/components/ConsentDialog";

describe("ConsentDialog", () => {
  it("renders nothing when closed", () => {
    render(<ConsentDialog open={false} title="T" confirmLabel="OK" onConfirm={() => {}} onCancel={() => {}}>x</ConsentDialog>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("confirms, cancels and closes on Escape", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConsentDialog open title="Allow camera?" confirmLabel="Allow camera" onConfirm={onConfirm} onCancel={onCancel}>
        body
      </ConsentDialog>,
    );
    expect(screen.getByRole("dialog", { name: "Allow camera?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow camera" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Allow camera" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
