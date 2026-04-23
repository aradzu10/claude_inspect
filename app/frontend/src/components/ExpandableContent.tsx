import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  children: React.ReactNode;
  maxHeight?: number;
  initiallyExpanded?: boolean;
}

export const ExpandableContent = ({ children, maxHeight = 300, initiallyExpanded = false }: Props) => {
  const [isExpanded, setIsExpanded] = useState(initiallyExpanded);
  const contentRef = useRef<HTMLDivElement>(null);
  const [showButton, setShowButton] = useState(false);

  useEffect(() => {
    if (contentRef.current && contentRef.current.scrollHeight > maxHeight) {
      setShowButton(true);
    }
  }, [children, maxHeight]);

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-[600px] overflow-y-auto' : ''}`}
        style={{ maxHeight: isExpanded ? '600px' : maxHeight }}
      >
        {children}
      </div>
      {showButton && (
        <button
          onClick={() => {
            if (isExpanded && contentRef.current) {
              contentRef.current.scrollTop = 0;
            }
            setIsExpanded(!isExpanded);
          }}
          className="w-full py-2 mt-1 text-xs font-semibold text-gray-500 hover:text-gray-800 bg-gray-50/80 backdrop-blur-sm border border-gray-100 rounded-lg flex items-center justify-center gap-1 transition-colors sticky bottom-0 z-10"
        >
          {isExpanded ? (
            <><ChevronUp size={14} /> Show Less</>
          ) : (
            <><ChevronDown size={14} /> Show More ({contentRef.current?.scrollHeight}px)</>
          )}
        </button>
      )}
    </div>
  );
};
