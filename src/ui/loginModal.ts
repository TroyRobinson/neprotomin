import { db } from "../lib/db";

export interface LoginModalController {
  element: HTMLElement;
  open: () => void;
  close: () => void;
  destroy: () => void;
}

interface LoginModalOptions {
  onSignedIn?: (user: { email: string }) => void;
}

export const createLoginModal = (opts?: LoginModalOptions): LoginModalController => {
  const overlay = document.createElement("div");
  overlay.className =
    "fixed inset-0 z-50 hidden items-center justify-center bg-black/40 p-4";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const container = document.createElement("div");
  container.className =
    "w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900";

  const title = document.createElement("h2");
  title.className = "text-base font-semibold text-slate-800 dark:text-slate-100";
  title.textContent = "Sign in";

  const description = document.createElement("p");
  description.className = "mt-1 text-sm text-slate-500 dark:text-slate-400";
  description.textContent = "Use your email. We'll send you a one-time code.";

  const form = document.createElement("form");
  form.className = "mt-4 space-y-3";

  const emailGroup = document.createElement("div");
  const emailLabel = document.createElement("label");
  emailLabel.className = "block text-sm font-medium text-slate-700 dark:text-slate-300";
  emailLabel.textContent = "Email";
  emailLabel.htmlFor = "login-email";
  const emailInput = document.createElement("input");
  emailInput.id = "login-email";
  emailInput.type = "email";
  emailInput.required = true;
  emailInput.placeholder = "you@example.com";
  emailInput.className =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 outline-none ring-0 focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
  emailGroup.appendChild(emailLabel);
  emailGroup.appendChild(emailInput);

  const codeGroup = document.createElement("div");
  codeGroup.className = "hidden";
  const codeLabel = document.createElement("label");
  codeLabel.className = "block text-sm font-medium text-slate-700 dark:text-slate-300";
  codeLabel.textContent = "Verification code";
  codeLabel.htmlFor = "login-code";
  const codeInput = document.createElement("input");
  codeInput.id = "login-code";
  codeInput.type = "text";
  codeInput.inputMode = "numeric";
  codeInput.placeholder = "123456";
  codeInput.className =
    "mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 placeholder-slate-400 outline-none ring-0 focus:border-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100";
  codeGroup.appendChild(codeLabel);
  codeGroup.appendChild(codeInput);

  const errorBox = document.createElement("div");
  errorBox.className = "hidden rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300";

  const actions = document.createElement("div");
  actions.className = "mt-2 flex items-center justify-between gap-3";

  const cancelBtn = document.createElement("button");
  cancelBtn.type = "button";
  cancelBtn.className =
    "inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700";
  cancelBtn.textContent = "Cancel";

  const submitBtn = document.createElement("button");
  submitBtn.type = "submit";
  submitBtn.className =
    "inline-flex items-center justify-center rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50";
  submitBtn.textContent = "Send code";

  actions.appendChild(cancelBtn);
  actions.appendChild(submitBtn);

  form.appendChild(emailGroup);
  form.appendChild(codeGroup);
  form.appendChild(errorBox);
  form.appendChild(actions);

  container.appendChild(title);
  container.appendChild(description);
  container.appendChild(form);
  overlay.appendChild(container);

  let step: "email" | "code" = "email";
  let currentEmail: string | null = null;
  let isSubmitting = false;

  const setError = (msg: string | null) => {
    if (!msg) {
      errorBox.className = "hidden rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300";
      errorBox.textContent = "";
      return;
    }
    errorBox.textContent = msg;
    errorBox.className = "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300";
  };

  const setSubmitting = (submitting: boolean) => {
    isSubmitting = submitting;
    submitBtn.disabled = submitting;
    cancelBtn.disabled = submitting;
  };

  const toCodeStep = () => {
    step = "code";
    emailInput.readOnly = true;
    codeGroup.className = "";
    submitBtn.textContent = "Verify";
    description.textContent = "Enter the code we emailed you.";
    setError(null);
    setTimeout(() => codeInput.focus(), 0);
  };

  const open = () => {
    overlay.classList.remove("hidden");
    setError(null);
    setSubmitting(false);
    step = "email";
    currentEmail = null;
    emailInput.readOnly = false;
    codeGroup.className = "hidden";
    submitBtn.textContent = "Send code";
    description.textContent = "Use your email. We'll send you a one-time code.";
    emailInput.value = "";
    codeInput.value = "";
    setTimeout(() => emailInput.focus(), 0);
  };

  const close = () => {
    overlay.classList.add("hidden");
  };

  const onCancel = () => {
    if (isSubmitting) return;
    close();
  };

  const onSubmit = async (e: Event) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    try {
      if (step === "email") {
        const email = emailInput.value.trim();
        if (!email) {
          setError("Please enter your email");
          return;
        }
        setSubmitting(true);
        await db.auth.sendMagicCode({ email });
        currentEmail = email;
        toCodeStep();
      } else {
        const code = codeInput.value.trim();
        const email = currentEmail || emailInput.value.trim();
        if (!email || !code) {
          setError("Enter the email and the verification code");
          return;
        }
        setSubmitting(true);
        await db.auth.signInWithMagicCode({ email, code });
        setSubmitting(false);
        close();
        try {
          const user = await db.getAuth();
          const emailNow = (user as any)?.email as string | undefined;
          if (emailNow) opts?.onSignedIn?.({ email: emailNow });
        } catch (_) {
          // ignore
        }
      }
    } catch (err: any) {
      const msg = err?.body?.message || err?.message || "Something went wrong";
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const onOverlayClick = (e: MouseEvent) => {
    if (e.target === overlay) {
      onCancel();
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onCancel();
    }
  };

  cancelBtn.addEventListener("click", onCancel);
  form.addEventListener("submit", onSubmit);
  overlay.addEventListener("mousedown", onOverlayClick);
  window.addEventListener("keydown", onKeyDown);

  document.body.appendChild(overlay);

  return {
    element: overlay,
    open,
    close,
    destroy: () => {
      cancelBtn.removeEventListener("click", onCancel);
      form.removeEventListener("submit", onSubmit);
      overlay.removeEventListener("mousedown", onOverlayClick);
      window.removeEventListener("keydown", onKeyDown);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    },
  };
};


