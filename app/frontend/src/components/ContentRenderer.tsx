import React from 'react';
import { FileText } from 'lucide-react';
import { ExpandableContent } from './ExpandableContent';

export const renderContent = (content: any, isInsideTool = false): React.ReactNode => {
  if (!content) return null;

  if (typeof content === 'string') {
    const cleaned = content.trim();
    if (!cleaned) return null;

    return (
      <ExpandableContent maxHeight={400} initiallyExpanded={isInsideTool}>
        <div className="whitespace-pre-wrap text-gray-800 leading-relaxed break-words">{cleaned}</div>
      </ExpandableContent>
    );
  }

  if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
    if (content.type === 'file') {
      const fileContent = typeof content.content === 'object'
        ? (content.content.file?.content || content.content.content)
        : content.content;

      return (
        <div className="my-2 border border-gray-200 rounded-lg overflow-hidden shadow-sm">
          <div className="bg-gray-50 px-3 py-2 border-b border-gray-200 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs font-medium text-gray-700">
              <FileText size={14} className="text-gray-400 shrink-0" />
              <span className="break-all whitespace-pre-wrap">{content.displayPath || content.filename}</span>
            </div>
          </div>
          <ExpandableContent maxHeight={300}>
            <pre className="p-3 text-[11px] font-mono whitespace-pre-wrap bg-white overflow-x-auto text-gray-800 break-words">
              {fileContent}
            </pre>
          </ExpandableContent>
        </div>
      );
    }

    if (content.type === 'deferred_tools_delta') {
      const toolNames = Array.isArray(content.addedNames) ? content.addedNames : [];
      return (
        <div className="my-2 p-3 bg-blue-50/30 border border-blue-100 rounded-lg">
          <div className="text-[10px] font-bold text-blue-600 uppercase mb-2">Tools Available</div>
          <ExpandableContent maxHeight={84}>
            <div className="flex flex-wrap gap-1.5">
              {toolNames.map((n: string) => (
                <span key={n} className="px-2 py-0.5 bg-white border border-blue-100 text-blue-700 rounded text-[10px] font-mono break-all">{n}</span>
              ))}
            </div>
          </ExpandableContent>
        </div>
      );
    }
    if (content.type === 'skill_listing') {
      return (
        <div className="my-2 p-3 bg-purple-50/30 border border-purple-100 rounded-lg">
          <div className="text-[10px] font-bold text-purple-600 uppercase mb-2">Skills Available ({content.skillCount})</div>
          <ExpandableContent maxHeight={140}>
            <pre className="text-[11px] font-mono text-gray-700 whitespace-pre-wrap">{content.content}</pre>
          </ExpandableContent>
        </div>
      );
    }
    if (Array.isArray(content.content)) {
      return renderContent(content.content);
    }
  }

  if (Array.isArray(content)) {
    const rendered: React.ReactNode[] = content.map((part, i) => {
      if (typeof part === 'string') return renderContent(part);
      if (part.type === 'text') {
        return renderContent(part.text);
      }
      if (part.type === 'thinking') return null;
      if (part.type === 'tool_use') return null;
      if (part.type === 'tool_result') {
        return renderContent(part.content);
      }
      return <div key={i} className="text-xs text-gray-400 italic">[{part.type} content]</div>;
    }).filter(Boolean);

    return rendered.length > 0 ? <div className="space-y-4">{rendered}</div> : null;
  }
  return <div className="text-xs text-gray-400 italic font-mono">{JSON.stringify(content)}</div>;
};
