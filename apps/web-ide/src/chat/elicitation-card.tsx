import { useState } from 'react';
import type { ChatElicitation } from './conversation-types';

interface ElicitationCardProps {
  elicitation: ChatElicitation;
  onRespond: (requestId: string, answers: string[][]) => Promise<void>;
  onReject: (requestId: string) => Promise<void>;
}

/**
 * Inline card for an agent ask (plan-mode question or permission prompt).
 * Single-select questions submit on click; multi-select collects toggles
 * behind a Submit button; a free-text answer is offered when allowed.
 */
export function ElicitationCard({ elicitation, onRespond, onReject }: ElicitationCardProps) {
  const [selections, setSelections] = useState<string[][]>(
    () => elicitation.questions.map(() => []),
  );
  const [customText, setCustomText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pending = elicitation.status === 'pending';
  const multiQuestion = elicitation.questions.length > 1;
  const needsSubmit =
    multiQuestion || elicitation.questions.some((question) => question.multiple);

  const submit = async (answers: string[][]) => {
    setSubmitting(true);
    setError(null);
    try {
      await onRespond(elicitation.requestId, answers);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const reject = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onReject(elicitation.requestId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const toggle = (questionIndex: number, label: string, multiple: boolean) => {
    setSelections((previous) =>
      previous.map((selected, index) => {
        if (index !== questionIndex) return selected;
        if (!multiple) return [label];
        return selected.includes(label)
          ? selected.filter((value) => value !== label)
          : [...selected, label];
      }),
    );
  };

  const canSubmit =
    !submitting &&
    selections.every((selected, index) =>
      selected.length > 0 ||
      // The custom text can stand in for the (single) unanswered question.
      (!multiQuestion && elicitation.questions[index]?.custom !== false && customText.trim().length > 0),
    );

  return (
    <div
      className={`webide-chat-elicitation is-${elicitation.status}`}
      data-testid="chat-elicitation"
    >
      {elicitation.questions.map((question, questionIndex) => (
        <div className="webide-chat-elicitation-question" key={questionIndex}>
          {question.header ? (
            <span className="webide-chat-elicitation-header">{question.header}</span>
          ) : null}
          <div className="webide-chat-elicitation-text">{question.question}</div>
          <div className="webide-chat-elicitation-options">
            {question.options.map((option) => {
              const selected =
                selections[questionIndex]?.includes(option.label) ||
                (!pending && elicitation.answers?.[questionIndex]?.includes(option.label));
              return (
                <button
                  key={option.label}
                  type="button"
                  className={`webide-chat-elicitation-option${selected ? ' is-selected' : ''}`}
                  disabled={!pending || submitting}
                  title={option.description || undefined}
                  onClick={() => {
                    if (needsSubmit) {
                      toggle(questionIndex, option.label, Boolean(question.multiple));
                    } else {
                      void submit([[option.label]]);
                    }
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {pending && !multiQuestion && elicitation.questions[0]?.custom !== false ? (
        <form
          className="webide-chat-elicitation-custom"
          onSubmit={(event) => {
            event.preventDefault();
            const text = customText.trim();
            if (text) {
              void submit([[text]]);
            }
          }}
        >
          <input
            type="text"
            value={customText}
            placeholder="Or type a custom answer…"
            disabled={submitting}
            onChange={(event) => setCustomText(event.target.value)}
          />
        </form>
      ) : null}
      {pending ? (
        <div className="webide-chat-elicitation-actions">
          {needsSubmit ? (
            <button
              type="button"
              className="webide-chat-elicitation-submit"
              disabled={!canSubmit}
              onClick={() => {
                const answers = selections.map((selected) =>
                  selected.length > 0 ? selected : [customText.trim()],
                );
                void submit(answers);
              }}
            >
              Submit
            </button>
          ) : null}
          <button
            type="button"
            className="webide-chat-elicitation-reject"
            disabled={submitting}
            onClick={() => void reject()}
          >
            Dismiss
          </button>
        </div>
      ) : (
        <div className="webide-chat-elicitation-resolution">
          {elicitation.status === 'answered'
            ? `Answered${elicitation.answers ? `: ${elicitation.answers.map((answer) => answer.join(', ')).join(' · ')}` : ''}`
            : 'Dismissed'}
        </div>
      )}
      {error ? <div className="webide-chat-elicitation-error">{error}</div> : null}
    </div>
  );
}
