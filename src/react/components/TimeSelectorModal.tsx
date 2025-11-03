import { useState, useEffect, useRef, useCallback } from "react";
import { DAY_LABELS, toTimeSelection, type TimeSelection } from "../lib/timeFilters";

interface TimeSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTimeSelect: (selection: TimeSelection | null) => void;
  initialSelection?: TimeSelection | null;
  isMobile?: boolean;
}

interface CustomDropdownProps<T = number> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; key?: string }[];
  placeholder?: string;
  className?: string;
}

const CustomDropdown = <T,>({ value, onChange, options, placeholder, className = "" }: CustomDropdownProps<T>) => {
  const [isOpen, setIsOpen] = useState(false);
  const [dropUp, setDropUp] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  const selectedOption = options.find(opt => opt.value === value);
  const displayValue = selectedOption?.label || placeholder || "Select...";

  const handleToggle = useCallback(() => {
    if (!isOpen && buttonRef.current) {
      const buttonRect = buttonRef.current.getBoundingClientRect();
      const dropdownHeight = Math.min(options.length * 36, 144); // Estimate: 36px per option, max 144px (4 options)
      const spaceBelow = window.innerHeight - buttonRect.bottom - 8; // 8px for margin
      const spaceAbove = buttonRect.top - 8; // 8px for margin
      
      // Drop up if not enough space below but enough space above
      setDropUp(spaceBelow < dropdownHeight && spaceAbove > dropdownHeight);
    }
    setIsOpen(prev => !prev);
  }, [isOpen, options.length]);

  const handleSelect = useCallback((optionValue: T) => {
    onChange(optionValue);
    setIsOpen(false);
    setDropUp(false);
  }, [onChange]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setDropUp(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        setIsOpen(false);
        setDropUp(false);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen]);

  return (
    <div ref={dropdownRef} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 focus:border-brand-400 focus:ring-1 focus:ring-brand-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        aria-haspopup="listbox"
        aria-expanded={isOpen}
      >
        <span className="block truncate">{displayValue}</span>
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
          <svg 
            className={`h-4 w-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} 
            viewBox="0 0 20 20" 
            fill="none"
          >
            <path 
              stroke="currentColor" 
              strokeLinecap="round" 
              strokeLinejoin="round" 
              strokeWidth={1.5} 
              d="M6 8l4 4 4-4" 
            />
          </svg>
        </span>
      </button>

      {isOpen && (
        <div className={`absolute z-10 w-full overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800 ${
          dropUp ? 'bottom-full mb-1' : 'top-full mt-1'
        } max-h-36`}>
          <ul className="py-1" role="listbox">
            {options.map((option) => (
              <li key={option.key || String(option.value)}>
                <button
                  type="button"
                  onClick={() => handleSelect(option.value)}
                  className={`block w-full px-3 py-2 text-left text-sm hover:bg-slate-100 dark:hover:bg-slate-700 ${
                    option.value === value 
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-900/20 dark:text-brand-300" 
                      : "text-slate-900 dark:text-slate-100"
                  }`}
                  role="option"
                  aria-selected={option.value === value}
                >
                  {option.label}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export const TimeSelectorModal = ({
  isOpen,
  onClose,
  onTimeSelect,
  initialSelection,
  isMobile = false,
}: TimeSelectorModalProps) => {
  const initialNormalized = toTimeSelection(initialSelection);
  const [selectedDay, setSelectedDay] = useState<number>(() => initialNormalized?.day ?? new Date().getDay());
  const [selectedHour12, setSelectedHour12] = useState<number>(() => {
    const hour = initialNormalized?.hour ?? new Date().getHours();
    return (hour % 12 || 12) - 1;
  });
  const [selectedAmPm, setSelectedAmPm] = useState<"AM" | "PM">(() => {
    const hour = initialNormalized?.hour ?? new Date().getHours();
    return hour < 12 ? "AM" : "PM";
  });

  useEffect(() => {
    const normalized = toTimeSelection(initialSelection);
    if (normalized) {
      setSelectedDay(normalized.day);
      setSelectedHour12((normalized.hour % 12 || 12) - 1);
      setSelectedAmPm(normalized.hour < 12 ? "AM" : "PM");
      return;
    }
    const now = new Date();
    const hour = now.getHours();
    setSelectedDay(now.getDay());
    setSelectedHour12((hour % 12 || 12) - 1);
    setSelectedAmPm(hour < 12 ? "AM" : "PM");
  }, [initialSelection]);

  const handleNowClick = () => {
    const now = new Date();
    const selection: TimeSelection = {
      day: now.getDay(),
      hour: now.getHours(),
      minute: now.getMinutes(),
    };
    onTimeSelect(selection);
    onClose();
  };

  const handleApplyClick = () => {
    // Convert 12-hour format to 24-hour format
    let hour24 = selectedHour12 + 1; // Convert from 0-11 to 1-12
    if (selectedAmPm === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (selectedAmPm === 'AM' && hour24 === 12) {
      hour24 = 0;
    }
    
    const selection: TimeSelection = {
      day: selectedDay,
      hour: hour24,
      minute: 0, // Always use 0 for hour-only selection
    };
    onTimeSelect(selection);
    onClose();
  };
  // Close on escape key and click outside
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) {
        onClose();
      }
    };

    const handleClickOutside = (event: MouseEvent) => {
      // Check if the click is outside the modal content
      const target = event.target as HTMLElement;
      const modalElement = target.closest('[data-modal="time-selector"]');
      
      if (isOpen && !modalElement) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const dayOptions = DAY_LABELS.map((day, index) => ({
    value: index,
    label: day,
  }));

  const hourOptions = Array.from({ length: 12 }, (_, i) => {
  const hour = i + 1; // 1 through 12
  return {
    value: i,
    label: `${hour}:00`,
  };
});

  
  const amPmOptions = [
    { value: 'AM' as const, label: 'AM' },
    { value: 'PM' as const, label: 'PM' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div 
        data-modal="time-selector"
        className={`w-full ${
          isMobile 
            ? 'max-h-full overflow-y-auto my-4' 
            : 'max-w-md'
        } rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-700 dark:bg-slate-900`}
      >
        {/* Header */}
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
            Select Time
          </h2>
          <p className={`${isMobile ? 'text-xs' : 'text-sm'} text-slate-600 dark:text-slate-400`}>
            Choose a time to see which organizations are open
          </p>
        </div>

        {/* Quick "Now" button */}
        <div className="mb-6">
          <button
            onClick={handleNowClick}
            className="w-full rounded-lg border border-orange-200/60 bg-orange-50/50 px-4 py-2 text-sm font-medium text-orange-800 hover:border-orange-300/80 hover:bg-orange-50/80 hover:text-orange-900 transition-colors dark:border-orange-800/40 dark:bg-orange-950/30 dark:text-orange-300 dark:hover:border-orange-700/60 dark:hover:text-orange-200"
          >
            Right Now ({new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })})
          </button>
        </div>

        {/* Custom time selection */}
        <div className="space-y-4">
          {/* Day selection */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Day
            </label>
            <CustomDropdown
              value={selectedDay}
              onChange={setSelectedDay}
              options={dayOptions}
              placeholder="Select day"
            />
          </div>

          {/* Time selection */}
          <div>
            <label className="mb-2 block text-sm font-medium text-slate-700 dark:text-slate-300">
              Time
            </label>
            <div className="flex gap-2">
              <CustomDropdown
                value={selectedHour12}
                onChange={setSelectedHour12}
                options={hourOptions}
                placeholder="Hour"
                className="flex-1"
              />
              <CustomDropdown
                value={selectedAmPm}
                onChange={setSelectedAmPm}
                options={amPmOptions}
                className="w-20"
              />
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="mt-6 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            onClick={handleApplyClick}
            className="flex-1 rounded-lg bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 transition-colors dark:bg-brand-400 dark:hover:bg-brand-500"
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};
