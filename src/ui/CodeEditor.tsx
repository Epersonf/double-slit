import { useRef, useState } from "react";

interface CodeEditorProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly errorLine?: number;
}

const LINE_HEIGHT = 20;

export function CodeEditor({ value, onChange, errorLine }: CodeEditorProps) {
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const lineCount = value.split("\n").length;

  return (
    <div className="editor">
      <div className="editor__gutter" ref={gutterRef}>
        <div style={{ transform: `translateY(${-scrollTop}px)` }}>
          {Array.from({ length: lineCount }, (_, i) => {
            const n = i + 1;
            return (
              <div
                key={n}
                className={n === errorLine ? "editor__lineno editor__lineno--error" : "editor__lineno"}
                style={{ height: LINE_HEIGHT }}
              >
                {n}
              </div>
            );
          })}
        </div>
      </div>
      {errorLine !== undefined && (
        <div
          className="editor__error-stripe"
          style={{ top: (errorLine - 1) * LINE_HEIGHT - scrollTop, height: LINE_HEIGHT }}
        />
      )}
      <textarea
        className="editor__textarea"
        style={{ lineHeight: `${LINE_HEIGHT}px` }}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      />
    </div>
  );
}
