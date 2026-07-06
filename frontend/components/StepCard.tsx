import React, { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { Step } from '@/types';

const CodeEditor = dynamic(() => import('@/components/CodeEditor'), {
  ssr: false,
});

interface StepCardProps {
  step: Step;
  onUpdate: (step: Step) => void;
  onDelete: () => void;
}

const ParamInput = ({ 
  value, 
  onChange 
}: { 
  value: string | number, 
  onChange: (val: string | number) => void 
}) => {
  const [localVal, setLocalVal] = useState(value.toString());

  useEffect(() => {
    setLocalVal(value.toString());
  }, [value]);

  const handleBlur = () => {
    if (localVal.trim() === '') {
      setLocalVal('0');
      onChange(0);
    } else {
      const num = Number(localVal);
      if (!isNaN(num)) {
        onChange(num);
        setLocalVal(num.toString()); 
      } else {
        onChange(localVal);
      }
    }
  };

  return (
    <input
      type="text"
      value={localVal}
      onChange={(e) => setLocalVal(e.target.value)}
      onBlur={handleBlur}
      className="w-24 shrink-0 px-2 py-1.5 text-sm bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded focus:outline-none focus:border-black dark:focus:border-white transition-colors"
    />
  );
};

export default function StepCard({ step, onUpdate, onDelete }: StepCardProps) {
  const [tab, setTab] = useState<'details' | 'code'>('details');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const updateParamValue = (key: string, val: string | number) => {
    onUpdate({
      ...step,
      parameters: { ...step.parameters, [key]: val }
    });
  };

  return (
    <div className={`bg-white dark:bg-zinc-900 rounded-lg border shadow-sm overflow-hidden z-20 relative transition-all ${step.isModified ? 'border-blue-400 dark:border-blue-600' : 'border-zinc-200 dark:border-zinc-700'}`}>
      
      <div className="flex justify-between items-center p-2 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
        
        <div className="flex-1 mr-4 flex items-center gap-2 overflow-hidden">
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-zinc-400 hover:text-black dark:hover:text-white hover:bg-zinc-200 dark:hover:bg-zinc-700 rounded transition-colors shrink-0"
          >
            {isExpanded ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
            )}
          </button>

          <input
            type="text"
            value={step.name}
            onChange={(e) => onUpdate({ ...step, name: e.target.value })}
            placeholder="Step Name..."
            className="w-full font-semibold text-zinc-900 dark:text-white bg-transparent border border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-black dark:focus:border-white focus:outline-none rounded px-2 py-1 truncate transition-colors"
          />
        </div>

        <div className="flex space-x-2 shrink-0 items-center">
          {isExpanded && (
            <div className="flex space-x-1 bg-zinc-200 dark:bg-zinc-950 p-1 rounded-md">
              <button
                type="button"
                onClick={() => setTab('details')}
                className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${tab === 'details' ? 'bg-white dark:bg-zinc-700 text-black dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'}`}
              >
                Details
              </button>
              <button
                type="button"
                onClick={() => setTab('code')}
                className={`px-3 py-1 text-xs font-medium rounded-sm transition-colors ${tab === 'code' ? 'bg-white dark:bg-zinc-700 text-black dark:text-white shadow-sm' : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-white'}`}
              >
                Code
              </button>
            </div>
          )}
          
          <button 
            onClick={onDelete}
            className="p-1.5 text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 rounded transition-colors"
            title="Delete Step"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 bg-white dark:bg-zinc-800">
          {tab === 'details' ? (
            <div className="space-y-4">
              <textarea
                value={step.description}
                onChange={(e) => onUpdate({ ...step, description: e.target.value })}
                placeholder="Step description..."
                rows={2}
                className="w-full text-sm text-zinc-700 dark:text-zinc-300 bg-transparent border border-transparent hover:border-zinc-300 dark:hover:border-zinc-600 focus:border-black dark:focus:border-white focus:outline-none rounded px-2 py-1 resize-y transition-colors"
              />
              
              <div className="space-y-3 pt-2 border-t border-zinc-100 dark:border-zinc-700/50">
                <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider px-2">Parameters</h4>
                
                {Object.keys(step.parameters).length > 0 ? (
                  <div className="grid grid-cols-1 gap-2 px-2">
                    {Object.entries(step.parameters).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2">
                        <span className="flex-1 text-sm font-medium text-zinc-700 dark:text-zinc-300 truncate pr-2">
                          {key}
                        </span>
                        <ParamInput 
                          value={value} 
                          onChange={(val) => updateParamValue(key, val)} 
                        />
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-400 italic px-2">No parameters defined.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="h-48 rounded-md overflow-hidden border border-zinc-200 dark:border-zinc-700 relative">
              <CodeEditor value={step.code} onChange={(val) => onUpdate({ ...step, code: val || '' })} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}