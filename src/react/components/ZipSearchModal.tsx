import { useState, useRef, useEffect } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";

interface ZipSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSearch: (query: string) => void;
}

const SearchIcon = () => (
  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4 text-slate-400 dark:text-slate-500">
    <path
      fillRule="evenodd"
      d="M9 3.5a5.5 5.5 0 013.894 9.394l3.703 3.703a.75.75 0 11-1.06 1.06l-3.703-3.703A5.5 5.5 0 119 3.5zm0 1.5a4 4 0 100 8 4 4 0 000-8z"
      clipRule="evenodd"
    />
  </svg>
);

export const ZipSearchModal = ({
  isOpen,
  onClose,
  onSearch,
}: ZipSearchModalProps) => {
  const [searchValue, setSearchValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = searchValue.trim();
    if (!trimmed) return;
    onSearch(trimmed);
    setSearchValue("");
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div
      ref={backdropRef}
      onClick={handleBackdropClick}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
    >
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-900">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-300"
          aria-label="Close"
        >
          <XMarkIcon className="h-5 w-5" />
        </button>

        {/* Content */}
        <div className="px-6 py-8 pr-12">
          <h2 className="mb-4 text-xl font-bold text-slate-900 dark:text-slate-100">
            Find your area
          </h2>
          <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
            Enter a ZIP code or county name to zoom to that area on the map.
          </p>

          {/* Search form */}
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-3 shadow-sm transition focus-within:border-brand-300 focus-within:ring-2 focus-within:ring-brand-200 dark:border-slate-700 dark:bg-slate-900 dark:focus-within:border-slate-500">
              <SearchIcon />
              <input
                ref={inputRef}
                type="search"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                placeholder="Enter ZIP or county name"
                className="w-full min-w-0 bg-transparent text-base text-slate-700 outline-none placeholder:text-slate-400 dark:text-slate-200 dark:placeholder:text-slate-500"
                enterKeyHint="search"
              />
            </div>
            <button
              type="submit"
              className="w-full rounded-full bg-brand-500 px-6 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
            >
              Search
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

