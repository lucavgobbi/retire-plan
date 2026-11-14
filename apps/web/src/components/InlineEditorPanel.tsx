import { useLayoutEffect, useRef, type ReactNode } from "react";
import "./inlineEditorPanel.css";

/** Shared, in-place editor frame used by plan rows and scenario cards. */
export function InlineEditorPanel({
  title,
  children,
  onClose,
  onRemove,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  onRemove?: () => void;
  className?: string;
}) {
  const panelRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), select, textarea")?.focus();
  }, []);

  const close = () => {
    const row = panelRef.current?.closest<HTMLElement>("[data-inline-edit-row]");
    onClose();
    window.requestAnimationFrame(() => row?.querySelector<HTMLElement>("[data-inline-edit-trigger]")?.focus());
  };

  return (
    <section ref={panelRef} className={`inline-editor-panel ${className}`.trim()} aria-label={title}>
      <div className="inline-editor-heading">
        <h3>{title}</h3>
        <div className="inline-editor-actions">
          {onRemove && <button type="button" className="plan-remove" onClick={onRemove}>Remove</button>}
          <button type="button" aria-label="Close editor" onClick={close}>Close editor</button>
        </div>
      </div>
      {children}
    </section>
  );
}
