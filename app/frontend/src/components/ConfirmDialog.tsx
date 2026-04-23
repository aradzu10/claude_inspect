import React from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmDialog = ({ message, onConfirm, onCancel }: Props) => (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    onClick={onCancel}
  >
    <div
      className="w-[420px] bg-white rounded-xl shadow-2xl border border-gray-100 animate-in fade-in zoom-in-95 duration-150"
      onClick={e => e.stopPropagation()}
    >
      <div className="px-6 pt-6 pb-4 flex gap-4">
        <div className="shrink-0 bg-amber-50 p-2.5 rounded-lg h-fit">
          <AlertTriangle size={20} className="text-amber-500" />
        </div>
        <div>
          <h2 className="font-semibold text-gray-900 mb-1">File already exists</h2>
          <p className="text-sm text-gray-500 leading-relaxed">{message}</p>
        </div>
      </div>
      <div className="px-6 pb-5 flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors shadow-sm shadow-blue-200"
        >
          Override
        </button>
      </div>
    </div>
  </div>
);
