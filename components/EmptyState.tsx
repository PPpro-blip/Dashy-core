import type { DashyModelId } from "@/lib/ui/models";

interface EmptyStateProps {
  onSuggestion: (text: string) => void;
  modelId: DashyModelId;
}

const PROMPT_CARDS = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01" />
      </svg>
    ),
    title: "Explain a concept",
    desc: "Break down complex topics into clear, simple explanations.",
    prompt: "Explain how vector embeddings power semantic search, in simple terms.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2l8 4v6c0 5-3.5 8-8 10-4.5-2-8-5-8-10V6l8-4z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
    title: "Search my memory",
    desc: "Retrieve relevant knowledge from your RAG memory store.",
    prompt: "Search my knowledge for everything related to my current project.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    title: "Build something",
    desc: "Plan, scaffold, and iterate on real projects with you.",
    prompt: "Help me design the architecture for a realtime dashboard app.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    ),
    title: "Draft & refine",
    desc: "Write, edit, and polish any text — emails to essays.",
    prompt: "Draft a concise product update announcement for DashyCore v7.",
  },
];

export function EmptyState({ onSuggestion }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-mark anim-pulse-glow" aria-hidden="true">
        <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <rect width="32" height="32" rx="8" fill="currentColor" />
          <path d="M10 22V14l3.5 0 3.2 7 3.2-7H23v8h-3v-7l-3 6h-3l-3-6v7z" fill="#0a0a0f" />
        </svg>
      </div>
      <h1 className="empty-state-title">Welcome to DashyCore</h1>
      <p className="empty-state-subtitle">
        Your intelligent workspace companion. Ask anything — or start with a suggestion.
      </p>
      <div className="prompt-cards" role="list" aria-label="Suggested prompts">
        {PROMPT_CARDS.map((card) => (
          <button
            key={card.title}
            type="button"
            className="prompt-card"
            role="listitem"
            onClick={() => onSuggestion(card.prompt)}
          >
            <span className="prompt-card-icon" aria-hidden="true">{card.icon}</span>
            <span className="prompt-card-title">{card.title}</span>
            <span className="prompt-card-desc">{card.desc}</span>
          </button>
        ))}
      </div>
    </div>
  );
}