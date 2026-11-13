import { useId, useState } from "react";

/**
 * Accessible per-chart explanation control. One coherent visibility model drives
 * every channel, so the body visibility and `aria-expanded` NEVER disagree:
 *  - pointer hover (mouse pointer only) → reveals, expanded=true;
 *  - keyboard focus → reveals, expanded=true; Escape dismisses for real (even
 *    under hover/focus) until the pointer re-enters or focus returns;
 *  - click/tap/Enter/Space → persistent toggle (touch never sets hover).
 * The body is always in the DOM and linked to the button via aria-describedby;
 * visibility is the actual `hidden` attribute — no CSS/JS disagreement.
 * No external dependencies.
 */
export function ChartHelp({ children }: { children: string }) {
  const [open, setOpen] = useState(false); // persistent toggle (click/touch/keyboard)
  const [hover, setHover] = useState(false); // mouse-pointer hover only
  const [focus, setFocus] = useState(false); // keyboard focus inside the control
  // Escape sets this: real dismissal even while the pointer hovers or focus remains.
  const [suppressed, setSuppressed] = useState(false);
  const bodyId = useId();
  const visible = (open || hover || focus) && !suppressed;
  return (
    <span
      className={"chart-help" + (visible ? " chart-help-open" : "")}
      onPointerEnter={(event) => {
        // pointerType is "mouse" | "touch" | "pen"; undefined = synthetic/legacy
        // event (no PointerEvent class) — treated as the mouse default. Real
        // touch always reports "touch" and never hover-reveals.
        if ((event.pointerType ?? "mouse") === "mouse") { setHover(true); setSuppressed(false); }
      }}
      onPointerLeave={(event) => {
        if ((event.pointerType ?? "mouse") === "mouse") setHover(false);
      }}
      onFocus={() => { setFocus(true); setSuppressed(false); }}
      onBlur={() => setFocus(false)}
      onKeyDown={(event) => {
        if (event.key === "Escape") { setOpen(false); setSuppressed(true); }
      }}
    >
      <button
        type="button"
        className="chart-help-toggle"
        aria-expanded={visible}
        aria-controls={bodyId}
        aria-describedby={bodyId}
        aria-label="How to read this chart"
        onClick={() => {
          // Activation semantics: OPENING always clears any Escape suppression
          // (reopening works while focus remains on the button); CLOSING sets it,
          // so the body actually hides even if the pointer still hovers or focus
          // remains. aria-expanded tracks the resulting visibility either way.
          if (open && !suppressed) { setOpen(false); setSuppressed(true); }
          else { setOpen(true); setSuppressed(false); }
        }}
      >
        ⓘ How to read this chart
      </button>
      <span id={bodyId} className="chart-help-body" role="note" aria-label="About this chart" hidden={!visible}>
        {children}
      </span>
    </span>
  );
}
