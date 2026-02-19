import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';

interface SelectOption {
  value: string;
  label: string;
}

interface CustomSelectProps {
  id?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  className?: string;
  buttonClassName?: string;
  disabled?: boolean;
  compact?: boolean; // If true, shrinks to fit content width instead of filling container
  fitContent?: boolean; // If true, keeps default size while shrinking width to content
  selectedPrefix?: string;
  ariaLabel?: string;
  placeholder?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  id,
  value,
  options,
  onChange,
  className = "",
  buttonClassName = "",
  disabled = false,
  compact = false,
  fitContent = false,
  selectedPrefix = "",
  ariaLabel,
  placeholder = "Select an option",
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [dropdownPosition, setDropdownPosition] = useState<'bottom' | 'top'>('bottom');
  const selectRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find(option => option.value === value);
  const longestLabel = [placeholder, ...options.map((opt) => opt.label)].reduce(
    (longest, label) => (label.length > longest.length ? label : longest),
    "",
  );

  // Calculate dropdown position to stay within viewport
  useLayoutEffect(() => {
    if (isOpen && selectRef.current && dropdownRef.current) {
      const selectRect = selectRef.current.getBoundingClientRect();
      const dropdownRect = dropdownRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      
      // Check vertical space
      const spaceBelow = viewportHeight - selectRect.bottom;
      const spaceAbove = selectRect.top;
      
      // Position dropdown above if there's more space above and not enough below
      if (spaceBelow < dropdownRect.height && spaceAbove > spaceBelow) {
        setDropdownPosition('top');
      } else {
        setDropdownPosition('bottom');
      }
      
      // Check horizontal space and adjust if needed
      const spaceRight = viewportWidth - selectRect.left;
      if (spaceRight < dropdownRect.width) {
        // Not enough space on the right, align to right edge
        dropdownRef.current.style.left = 'auto';
        dropdownRef.current.style.right = '0';
      } else {
        // Enough space, align to left
        dropdownRef.current.style.left = '0';
        dropdownRef.current.style.right = 'auto';
      }
    }
  }, [isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle keyboard navigation
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setFocusedIndex(prev => (prev + 1) % options.length);
        }
        break;
      case 'ArrowUp':
        event.preventDefault();
        if (!isOpen) {
          setIsOpen(true);
        } else {
          setFocusedIndex(prev => (prev - 1 + options.length) % options.length);
        }
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (isOpen && focusedIndex >= 0) {
          onChange(options[focusedIndex].value);
          setIsOpen(false);
          setFocusedIndex(-1);
        } else {
          setIsOpen(!isOpen);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        setFocusedIndex(-1);
        buttonRef.current?.focus();
        break;
    }
  };

  const handleOptionClick = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setFocusedIndex(-1);
  };

  const toggleDropdown = () => {
    if (!disabled) {
      setIsOpen(!isOpen);
      setFocusedIndex(-1);
    }
  };

  return (
    <div ref={selectRef} className={`relative ${compact || fitContent ? 'inline-block' : 'w-full'} ${className}`}>
      {/* Select Button */}
      <button
        ref={buttonRef}
        id={id}
        type="button"
        onClick={toggleDropdown}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        className={`
          ${compact ? 'h-[21px] text-[10px]' : 'h-7 text-xs'} ${compact || fitContent ? 'w-auto' : 'w-full'} ${compact || fitContent ? '' : 'min-w-32'} rounded border border-slate-200 bg-white pl-2 pr-7 text-slate-700 shadow-sm transition 
          focus:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-200 
          dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:focus:border-brand-300 dark:focus:ring-brand-800/50
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          ${isOpen ? 'border-brand-400 ring-1 ring-brand-200 dark:border-brand-300 dark:ring-brand-800/50' : ''}
          flex items-center
          ${buttonClassName}
        `}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={ariaLabel}
        aria-labelledby={id ? `${id}-label` : undefined}
      >
        <span className={`block truncate text-left w-full`}>
          {selectedPrefix}{selectedOption?.label || placeholder || 'Select an option'}
        </span>
        {compact && (
          <span className="sr-only">
            {longestLabel}
          </span>
        )}
      </button>

      {/* Custom dropdown arrow */}
      <div className={`absolute ${compact ? 'right-1.5' : 'right-2'} top-1/2 h-3 w-3 -translate-y-1/2 mt-px pointer-events-none text-slate-400 dark:text-slate-500`}>
        <svg 
          viewBox="0 0 20 20" 
          fill="currentColor" 
          aria-hidden="true"
          className={`transition-transform ${isOpen ? 'rotate-180' : ''} ${compact ? 'h-2.5 w-2.5' : 'h-3 w-3'}`}
        >
          <path 
            fillRule="evenodd" 
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" 
            clipRule="evenodd" 
          />
        </svg>
      </div>

      {/* Dropdown Options */}
      {isOpen && (
        <div 
          ref={dropdownRef}
          className={`absolute z-50 w-full min-w-40 rounded border border-slate-200 bg-white shadow-lg dark:border-slate-600 dark:bg-slate-800 ${
            dropdownPosition === 'top' ? 'bottom-full mb-1' : 'top-full mt-1'
          }`}
        >
          <ul
            role="listbox"
            aria-labelledby={id ? `${id}-label` : undefined}
            className="max-h-60 overflow-auto py-1"
          >
            {options.map((option, index) => (
              <li
                key={option.value}
                role="option"
                aria-selected={option.value === value}
                className={`
                  relative cursor-pointer select-none py-2 pl-3 pr-9 text-xs
                  ${option.value === value 
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-400/15 dark:text-brand-300' 
                    : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-800'
                  }
                  ${focusedIndex === index ? 'bg-slate-50 dark:bg-slate-800' : ''}
                `}
                onClick={() => handleOptionClick(option.value)}
                onMouseEnter={() => setFocusedIndex(index)}
              >
                <span className="block truncate">{option.label}</span>
                {option.value === value && (
                  <span className="absolute inset-y-0 right-0 flex items-center pr-4">
                    <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
