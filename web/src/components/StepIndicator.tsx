interface StepIndicatorProps {
  steps: number;
  current: number; // 1-based
  labels?: string[];
}

export default function StepIndicator({ steps, current, labels }: StepIndicatorProps) {
  return (
    <div className="flex items-center justify-center gap-0">
      {Array.from({ length: steps }, (_, i) => {
        const stepNum = i + 1;
        const isCompleted = stepNum < current;
        const isActive = stepNum === current;

        return (
          <div key={stepNum} className="flex items-center">
            {/* Connector line before (skip for first) */}
            {stepNum > 1 && (
              <div
                className={`h-0.5 w-8 sm:w-12 transition-colors duration-300 ${
                  isCompleted ? "bg-deliivo-orange" : "bg-gray-200"
                }`}
              />
            )}

            {/* Step dot */}
            <div className="flex flex-col items-center gap-1.5">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all duration-300 ${
                  isActive
                    ? "bg-deliivo-orange text-white shadow-md shadow-deliivo-orange/30 scale-110"
                    : isCompleted
                    ? "bg-deliivo-orange text-white"
                    : "bg-gray-100 text-deliivo-gray"
                }`}
              >
                {isCompleted ? (
                  <svg
                    className="h-4 w-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  stepNum
                )}
              </div>

              {labels && labels[i] && (
                <span
                  className={`hidden sm:block text-[10px] font-medium leading-none transition-colors duration-300 ${
                    isActive
                      ? "text-deliivo-orange"
                      : isCompleted
                      ? "text-deliivo-orange"
                      : "text-deliivo-gray"
                  }`}
                >
                  {labels[i]}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
