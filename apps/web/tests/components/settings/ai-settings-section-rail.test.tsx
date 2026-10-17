/**
 * @file ai-settings-section-rail.test.tsx
 * @description Unit tests for the AI Assistant settings section navigation rail.
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AISettingsSectionRail } from "@/app/settings/components/ai-settings/AISettingsSectionRail";

describe("AISettingsSectionRail", () => {
  it("renders every AI settings section with metrics", () => {
    render(
      <AISettingsSectionRail
        activeSection="gateway"
        onSectionChange={vi.fn()}
        metrics={{
          gateway: "key",
          models: "4",
          routing: "8",
          terms: "db",
          rag: "local",
        }}
      />,
    );

    expect(screen.getByRole("tab", { name: /gateway/i })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: /models/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /task routing/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /router terms/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /rag index/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /knowledge base/i })).toBeInTheDocument();
  });

  it("notifies parent when a section is selected", async () => {
    const user = userEvent.setup();
    const onSectionChange = vi.fn();

    render(
      <AISettingsSectionRail
        activeSection="gateway"
        onSectionChange={onSectionChange}
        metrics={{}}
      />,
    );

    await user.click(screen.getByRole("tab", { name: /router terms/i }));

    expect(onSectionChange).toHaveBeenCalledWith("terms");
  });
});
