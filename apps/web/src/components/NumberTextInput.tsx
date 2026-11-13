import { useLayoutEffect, useRef, useState, type InputHTMLAttributes } from "react";

/** Keep numeric drafts plain while displaying grouped integer digits. */
export function formatGroupedNumber(value: string): string {
  if (value === "" || value === "-" || value === "." || value === "-.") return value;
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const dot = unsigned.indexOf(".");
  const integer = dot < 0 ? unsigned : unsigned.slice(0, dot);
  const fraction = dot < 0 ? "" : unsigned.slice(dot);
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${fraction}`;
}

function cleanNumericDraft(value: string, allowNegative: boolean): string {
  const source = value.replace(/,/g, "");
  // Keep a typed/pasted sign even where it is not allowed. The owning field's
  // validation must reject it; removing it would silently turn -1000 into 1000.
  const negative = source.startsWith("-");
  let result = "";
  let decimal = false;
  for (const char of source) {
    if (char >= "0" && char <= "9") result += char;
    else if (char === "." && !decimal) { result += char; decimal = true; }
  }
  return `${negative ? "-" : ""}${result}`;
}

function semanticLength(value: string, end: number): number {
  return value.slice(0, end).replace(/,/g, "").length;
}

function caretForSemanticLength(value: string, length: number): number {
  if (length <= 0) return 0;
  let count = 0;
  for (let i = 0; i < value.length; i += 1) {
    if (value[i] !== ",") count += 1;
    if (count >= length) return i + 1;
  }
  return value.length;
}

export function NumberTextInput({
  value,
  onChange,
  allowNegative = true,
  group = true,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  allowNegative?: boolean;
  group?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [focused, setFocused] = useState(false);
  const display = group ? formatGroupedNumber(value) : value;
  useLayoutEffect(() => {
    if (focused && pendingCaret.current !== null && input.current) {
      const position = caretForSemanticLength(display, pendingCaret.current);
      input.current.setSelectionRange(position, position);
      pendingCaret.current = null;
    }
  }, [display, focused]);

  return <input
    {...props}
    ref={input}
    type="text"
    inputMode="decimal"
    value={display}
    onFocus={(event) => { setFocused(true); props.onFocus?.(event); }}
    onBlur={(event) => { setFocused(false); props.onBlur?.(event); }}
    onChange={(event) => {
      const element = event.currentTarget;
      const caret = semanticLength(element.value, element.selectionStart ?? element.value.length);
      const clean = cleanNumericDraft(element.value, allowNegative);
      pendingCaret.current = caret;
      onChange(clean);
    }}
  />;
}
