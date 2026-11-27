import { useRef } from "react";
import type { KeyboardEvent } from "react";

export function ProjectionTabs<T extends string>({
  prefix,
  label,
  tabs,
  active,
  onSelect,
}: {
  prefix: string;
  label: string;
  tabs: readonly { id: T; label: string }[];
  active: T;
  onSelect: (id: T) => void;
}) {
  const refs = useRef(new Map<T, HTMLButtonElement>());
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let next: number;
    switch (event.key) {
      case "ArrowRight":
        next = (index + 1) % tabs.length;
        break;
      case "ArrowLeft":
        next = (index - 1 + tabs.length) % tabs.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = tabs.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const { id } = tabs[next]!;
    onSelect(id);
    refs.current.get(id)?.focus();
  }

  return (
    <div className="projection-tablist no-print" role="tablist" aria-label={label}>
      {tabs.map(({ id, label }, index) => (
        <button
          key={id}
          ref={(button) => {
            if (button) refs.current.set(id, button);
            else refs.current.delete(id);
          }}
          type="button"
          role="tab"
          id={`${prefix}-tab-${id}`}
          aria-selected={active === id}
          aria-controls={`${prefix}-panel-${id}`}
          tabIndex={active === id ? 0 : -1}
          onClick={() => onSelect(id)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
