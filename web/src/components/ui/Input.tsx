import { InputHTMLAttributes, forwardRef, ReactNode } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  hint?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  (
    {
      label,
      error,
      hint,
      leadingIcon,
      trailingIcon,
      id,
      className = "",
      ...props
    },
    ref
  ) => {
    const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, "-") : undefined);

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="text-sm font-medium text-deliivo-dark"
          >
            {label}
          </label>
        )}

        <div className="relative">
          {leadingIcon && (
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-deliivo-gray">
              {leadingIcon}
            </span>
          )}

          <input
            ref={ref}
            id={inputId}
            className={[
              "block w-full rounded-2xl border bg-white px-4 py-3 text-sm text-deliivo-dark placeholder-deliivo-gray shadow-sm transition-colors",
              "focus:outline-none focus:ring-2",
              error
                ? "border-red-400 focus:border-red-400 focus:ring-red-400/20"
                : "border-gray-200 focus:border-primary-500 focus:ring-primary-500/20",
              leadingIcon ? "pl-10" : "",
              trailingIcon ? "pr-10" : "",
              className,
            ]
              .filter(Boolean)
              .join(" ")}
            aria-invalid={!!error}
            aria-describedby={
              error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined
            }
            {...props}
          />

          {trailingIcon && (
            <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-deliivo-gray">
              {trailingIcon}
            </span>
          )}
        </div>

        {error && (
          <p id={`${inputId}-error`} className="text-xs text-red-500">
            {error}
          </p>
        )}

        {!error && hint && (
          <p id={`${inputId}-hint`} className="text-xs text-deliivo-gray">
            {hint}
          </p>
        )}
      </div>
    );
  }
);

Input.displayName = "Input";

export default Input;
