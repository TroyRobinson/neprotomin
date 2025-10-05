import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { db } from "../../lib/reactDb";

interface LoginModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LoginModal = ({ isOpen, onClose }: LoginModalProps) => {
  const [sentEmail, setSentEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");

  useEffect(() => {
    if (!isOpen) {
      // Reset state when modal closes
      setSentEmail("");
      setStep("email");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const modal = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {step === "email" ? (
          <EmailStep
            onSendEmail={(email) => {
              setSentEmail(email);
              setStep("code");
            }}
          />
        ) : (
          <CodeStep
            sentEmail={sentEmail}
            onSuccess={onClose}
            onBack={() => setStep("email")}
          />
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

function EmailStep({ onSendEmail }: { onSendEmail: (email: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const inputEl = inputRef.current!;
    const email = inputEl.value;

    setIsLoading(true);
    try {
      await db.auth.sendMagicCode({ email });
      onSendEmail(email);
    } catch (err: any) {
      alert("Uh oh: " + err.body?.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
        Let's log you in
      </h2>
      <p className="text-slate-600 dark:text-slate-400">
        Enter your email, and we'll send you a verification code. We'll create
        an account for you too if you don't already have one.
      </p>
      <input
        ref={inputRef}
        type="email"
        className="w-full rounded border border-slate-300 px-3 py-2 text-slate-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        placeholder="Enter your email"
        required
        autoFocus
        disabled={isLoading}
      />
      <button
        type="submit"
        disabled={isLoading}
        className="w-full rounded bg-brand-600 px-4 py-2 font-medium text-white transition hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading ? "Sending..." : "Send Code"}
      </button>
    </form>
  );
}

function CodeStep({
  sentEmail,
  onSuccess,
  onBack,
}: {
  sentEmail: string;
  onSuccess: () => void;
  onBack: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const inputEl = inputRef.current!;
    const code = inputEl.value;

    setIsLoading(true);
    try {
      await db.auth.signInWithMagicCode({ email: sentEmail, code });
      onSuccess();
    } catch (err: any) {
      inputEl.value = "";
      alert("Uh oh: " + err.body?.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col space-y-4">
      <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
        Enter your code
      </h2>
      <p className="text-slate-600 dark:text-slate-400">
        We sent an email to <strong>{sentEmail}</strong>. Check your email, and
        paste the code you see.
      </p>
      <input
        ref={inputRef}
        type="text"
        className="w-full rounded border border-slate-300 px-3 py-2 text-slate-900 transition focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-slate-600 dark:bg-slate-800 dark:text-white"
        placeholder="123456..."
        required
        autoFocus
        disabled={isLoading}
      />
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onBack}
          disabled={isLoading}
          className="flex-1 rounded border border-slate-300 px-4 py-2 font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          Back
        </button>
        <button
          type="submit"
          disabled={isLoading}
          className="flex-1 rounded bg-brand-600 px-4 py-2 font-medium text-white transition hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Verifying..." : "Verify Code"}
        </button>
      </div>
    </form>
  );
}
