import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import type { Organization } from "../../types/organization";

interface IssueReportModalProps {
  org: Organization | null;
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (text: string) => Promise<void>;
}

const MAX_LENGTH = 1000;

export const IssueReportModal = ({ org, isOpen, onClose, onSubmit }: IssueReportModalProps) => {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const remaining = useMemo(() => MAX_LENGTH - text.length, [text.length]);

  useEffect(() => {
    if (!isOpen) {
      setText("");
      setError(null);
      setSuccessMessage(null);
      setIsSubmitting(false);
      return;
    }
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !org) {
    return null;
  }

  const handleOverlayClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    const trimmed = text.trim();
    if (!trimmed) {
      setError("Please share a brief note about the issue.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccessMessage(null);
    try {
      await onSubmit(trimmed);
      setSuccessMessage("Thanks for flagging this location. We'll review it shortly.");
      setText("");
      setTimeout(() => {
        onClose();
      }, 1400);
    } catch (submissionError) {
      const message =
        submissionError instanceof Error && submissionError.message
          ? submissionError.message
          : "We couldn't send that right now. Please try again.";
      setError(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          aria-label="Close"
          onClick={onClose}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden>
            <path
              d="M6 6l12 12M18 6L6 18"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              What went wrong?
            </h2>
            <p className="mt-1 text-sm text-slate-400 dark:text-slate-500">
              Closed location? Out of food? Not a food provider? …
            </p>
            <p className="mt-2 text-xs text-slate-400 dark:text-slate-500">
              Reporting: <span className="font-medium text-slate-600 dark:text-slate-300">{org.name}</span>
            </p>
          </div>

          <div>
            <label htmlFor="issue-details" className="sr-only">
              Describe the issue
            </label>
            <textarea
              id="issue-details"
              ref={textareaRef}
              value={text}
              onChange={(event) => setText(event.target.value.slice(0, MAX_LENGTH))}
              className="min-h-[60px] md:min-h-[120px] w-full resize-y rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 shadow-sm focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              placeholder="Share a brief note…"
              maxLength={MAX_LENGTH}
              disabled={isSubmitting}
              aria-describedby="issue-details-help"
            />
            <div className="hidden md:flex mt-1 items-center justify-between text-xs text-slate-400 dark:text-slate-500">
              <span id="issue-details-help">We send these to our moderation team.</span>
              <span>{remaining} characters left</span>
            </div>
          </div>

          {error ? (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-200">
              {error}
            </div>
          ) : null}

          {successMessage ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
              {successMessage}
            </div>
          ) : null}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-70 dark:bg-brand-500 dark:hover:bg-brand-400"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Submitting…" : "Submit"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
