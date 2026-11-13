import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { NumberTextInput } from "./NumberTextInput";

function ControlledNumberInput() {
  const [value, setValue] = useState("-1000");
  return <NumberTextInput aria-label="Amount" value={value} onChange={setValue} />;
}

describe("NumberTextInput caret handling", () => {
  it("keeps the caret at the start after deleting a leading minus", () => {
    render(<ControlledNumberInput />);
    const input = screen.getByRole("textbox", { name: "Amount" }) as HTMLInputElement;
    input.focus();

    fireEvent.change(input, { target: { value: "1000", selectionStart: 0 } });

    expect(input.value).toBe("1,000");
    expect(input.selectionStart).toBe(0);
  });
});
