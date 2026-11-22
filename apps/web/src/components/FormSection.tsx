import type { ReactNode, Ref } from "react";
import "./formSection.css";

type FormSectionProps = {
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  detailsRef?: Ref<HTMLDetailsElement>;
  onToggle?: () => void;
};

/** Shared card and disclosure framing for settings and scenario forms. */
export function FormSection({
  title,
  description,
  children,
  className = "",
  collapsible = false,
  defaultOpen = false,
  detailsRef,
  onToggle,
}: FormSectionProps) {
  const classes = `form-section${className ? ` ${className}` : ""}`;
  const heading = (
    <>
      <span className="form-section-title">{title}</span>
      <span className="form-section-description">{description}</span>
    </>
  );
  const content = <div className="form-section-content">{children}</div>;

  if (collapsible) {
    return (
      <details
        ref={detailsRef}
        className={`${classes} form-section-disclosure`}
        aria-label={title}
        open={defaultOpen ? true : undefined}
        onToggle={onToggle}
      >
        <summary>
          {heading}
          <span className="form-section-chevron" aria-hidden="true">
            ›
          </span>
        </summary>
        {content}
      </details>
    );
  }

  return (
    <section className={classes} aria-label={title}>
      <header className="form-section-heading">
        <h3 className="form-section-title">{title}</h3>
        <p className="form-section-description">{description}</p>
      </header>
      {content}
    </section>
  );
}
