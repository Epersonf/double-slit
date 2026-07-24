import { EXAMPLES } from "../core/examples";

interface ExamplePickerProps {
  readonly activeId: string | null;
  readonly onSelect: (id: string) => void;
}

export function ExamplePicker({ activeId, onSelect }: ExamplePickerProps) {
  return (
    <div className="examples">
      {EXAMPLES.map((ex) => (
        <button
          key={ex.id}
          type="button"
          className={ex.id === activeId ? "examples__btn examples__btn--active" : "examples__btn"}
          onClick={() => onSelect(ex.id)}
          title={ex.description}
        >
          {ex.title}
        </button>
      ))}
    </div>
  );
}
