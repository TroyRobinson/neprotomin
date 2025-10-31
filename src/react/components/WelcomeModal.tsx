import { useEffect, useRef } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";

interface WelcomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onNeedFood: () => void;
  onShareFood: () => void;
}

export const WelcomeModal = ({
  isOpen,
  onClose,
  onNeedFood,
  onShareFood,
}: WelcomeModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Handle ESC key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Handle click outside
  const handleBackdropClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.target === backdropRef.current) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div
        ref={modalRef}
        className="relative flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900"
      >
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 z-10 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          aria-label="Close"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        {/* Content - scrollable */}
        <div className="overflow-y-auto px-6 py-8 pr-12">
          <h2 className="mb-4 text-xl font-bold font-display text-slate-900 dark:text-slate-100">
            Welcome to Neighborhood Explorer
          </h2>
          <p className="mb-8 text-sm text-slate-600 dark:text-slate-400">
            Discover food resources and community organizations in your area. Explore interactive maps and statistics to learn how we can come together to make a difference.
          </p>

          {/* CTA Buttons */}
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={onNeedFood}
              className="w-full rounded-full bg-brand-500 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
            >
              I need food
            </button>
            <button
              type="button"
              onClick={onShareFood}
              className="w-full rounded-full border-2 border-brand-500 bg-white px-6 py-3 text-base font-semibold text-brand-600 shadow-sm transition hover:bg-brand-50 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:border-brand-400 dark:bg-slate-900 dark:text-brand-400 dark:hover:bg-slate-800 dark:focus:ring-offset-slate-900"
            >
              We share food
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

