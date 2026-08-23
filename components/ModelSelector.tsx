"use client";

import { useEffect, useRef, useState } from "react";
import { DASHY_MODELS, getModel, type DashyModelId } from "@/lib/ui/models";

interface ModelSelectorProps {
  selected: DashyModelId;
  onSelect: (id: DashyModelId) => void;
  disabled?: boolean;
}

export function ModelSelector({
  selected,
  onSelect,
  disabled = false,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const current = getModel(selected);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div className="model-selector" ref={ref}>
      <button
        type="button"
        className="model-selector-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Model: ${current.name}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="model-dot" aria-hidden="true" />
        <span className="model-selector-label">{current.name}</span>
        <svg className="model-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="model-dropdown" role="listbox" aria-label="Available models">
          <div className="model-dropdown-header">Select model</div>
          {DASHY_MODELS.map((model) => {
            const isSelected = model.id === selected;
            return (
              <button
                key={model.id}
                type="button"
                className="model-option"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onSelect(model.id);
                  setOpen(false);
                }}
              >
                <div className="model-option-info">
                  <span className="model-option-name">{model.name}</span>
                  <span className="model-option-desc">{model.description}</span>
                </div>
                <span className="model-option-check" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}