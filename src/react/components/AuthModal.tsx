import React from "react";
import { db } from "../../lib/reactDb";

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const [sentEmail, setSentEmail] = React.useState("");

  React.useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center"
      aria-modal="true"
      role="dialog"
    >
      <div className="absolute inset-0 bg-slate-900/60" onClick={onClose} />
      <div
        className="relative z-10 w-[min(92vw,440px)] max-w-lg rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
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

        <div className="mt-2">
          {!sentEmail ? (
            <EmailStep onSendEmail={setSentEmail} />
          ) : (
            <CodeStep sentEmail={sentEmail} onSuccess={onClose} />
          )}
        </div>
      </div>
    </div>
  );
};

function EmailStep({ onSendEmail }: { onSendEmail: (email: string) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const inputEl = inputRef.current!;
    const email = inputEl.value;
    onSendEmail(email);
    db.auth.sendMagicCode({ email }).catch((err) => {
      alert("Uh oh :" + (err.body?.message || "Failed to send code"));
      onSendEmail("");
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
      <h2 className="text-xl font-bold">Let's log you in</h2>
      <p className="text-slate-600 dark:text-slate-300">
        Enter your email, and we'll send you a verification code. We'll create an account for you if you don't already have one.
      </p>
      <input
        ref={inputRef}
        type="email"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-300 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
        placeholder="Enter your email"
        required
        autoFocus
      />
      <button
        type="submit"
        className="inline-flex w-full items-center justify-center rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
      >
        Send Code
      </button>
    </form>
  );
}

function CodeStep({ sentEmail, onSuccess }: { sentEmail: string; onSuccess: () => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const inputEl = inputRef.current!;
    const code = inputEl.value;
    db.auth
      .signInWithMagicCode({ email: sentEmail, code })
      .then(() => onSuccess())
      .catch((err) => {
        inputEl.value = "";
        alert("Uh oh :" + (err.body?.message || "Invalid code"));
      });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
      <h2 className="text-xl font-bold">Enter your code</h2>
      <p className="text-slate-600 dark:text-slate-300">
        We sent an email to <strong>{sentEmail}</strong>. Check your inbox and paste the code.
      </p>
      <input
        ref={inputRef}
        type="text"
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-300 focus:outline-none dark:border-slate-700 dark:bg-slate-800"
        placeholder="123456..."
        required
        autoFocus
      />
      <button
        type="submit"
        className="inline-flex w-full items-center justify-center rounded-md bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700"
      >
        Verify Code
      </button>
    </form>
  );
}


