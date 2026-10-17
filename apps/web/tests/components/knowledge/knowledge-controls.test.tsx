/** @file knowledge-controls.test.tsx @description Regression tests for ShadCN-backed Knowledge Base controls. */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, Select } from "@/app/knowledge/controls";

describe("Knowledge Base controls", () => {
  it("renders the selected option label instead of its internal id", () => {
    render(
      <Field label="Connection">
        <Select value="db-1" onChange={() => undefined}>
          <option value="">Tất cả connection</option>
          <option value="db-1">Sales database</option>
        </Select>
      </Field>,
    );

    expect(screen.getByRole("combobox", { name: "Connection" })).toHaveTextContent(
      "Sales database",
    );
    expect(screen.getByRole("combobox", { name: "Connection" })).not.toHaveTextContent(
      "db-1",
    );
  });
});
