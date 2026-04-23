import React from 'react';
import { trimText } from '../utils/text';

interface Props {
  label: string;
  progress: number;
  onUndo: () => void;
}

export const HideToast = ({ label, progress, onUndo }: Props) => (
  <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[320px] rounded-lg border border-gray-200 bg-white shadow-lg">
    <button
      type="button"
      onClick={onUndo}
      className="w-full px-3 py-2 text-xs text-left text-gray-700 hover:text-gray-900"
    >
      Undo hide: {trimText(label, 38)}
    </button>
    <div className="h-1 bg-gray-100 rounded-b-lg overflow-hidden">
      <div
        className="h-full bg-blue-500 transition-[width] duration-75"
        style={{ width: `${progress}%` }}
      />
    </div>
  </div>
);
