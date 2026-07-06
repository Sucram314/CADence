import React from 'react';

export default function InsertDivider({ onInsert }: { onInsert: () => void }) {
  return (
    <div 
      className="group flex items-center justify-center h-4 my-1 cursor-pointer relative"
      onClick={onInsert}
      title="Insert step here"
    >
      <div className="absolute inset-0 -top-2 -bottom-2 z-10"></div>
      <div className="absolute inset-x-0 h-0.5 bg-blue-500 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-full"></div>
      <div className="bg-blue-500 text-white rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-20 pointer-events-none shadow-sm">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </div>
    </div>
  );
}