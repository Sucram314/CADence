'use strict';
'use client';

import { useState, useRef, useEffect } from 'react';
import dynamic from 'next/dynamic';

const CodeEditor = dynamic(() => import('@/components/CodeEditor'), {
  ssr: false,
});

const ModelViewer = dynamic(() => import('@/components/ModelViewer'), {
  ssr: false,
});

const REFRESH_TIME = 2000;
const DEFAULT_CODE = "import cadquery as cq\n\nresult = cq.Workplane('XY').box(10, 10, 10)\nshow_object(result)";

export default function Home() {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  
  const [glbURL, setGlbURL] = useState<string>('');
  const [code, setCode] = useState<string>(DEFAULT_CODE);
  const [chatInput, setChatInput] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  useEffect(() => {
    update(DEFAULT_CODE);
    
    return () => {
      setGlbURL((currentUrl) => {
        if (currentUrl) URL.revokeObjectURL(currentUrl);
        return '';
      });
    };
  }, []);

  const update = async (currentCode: string) => {
    try {
      const response = await fetch('http://127.0.0.1:8000/update', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({code: currentCode}),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Unknown error');
      }

      const glbBlob = await response.blob();
      const newURL = URL.createObjectURL(glbBlob);

      setGlbURL((prevUrl) => {
        if (prevUrl) URL.revokeObjectURL(prevUrl);
        return newURL;
      });

    } catch(error) {
      console.error('Update error:', error);
    }
  }

  const handleEditorChange = (value: string | undefined) => {
    const newValue = value || '';
    setCode(newValue); 

    if(timeout.current) clearTimeout(timeout.current);

    timeout.current = setTimeout(async ()=>{
      await update(newValue);
    }, REFRESH_TIME);
  };

  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    setIsGenerating(true);
    try {
      const response = await fetch('http://127.0.0.1:8000/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: chatInput, current_code: code }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate code');
      }

      const data = await response.json();
      const newCode = data.code;
      
      setCode(newCode);
      await update(newCode);
      setChatInput('');
    } catch (error) {
      console.error(error);
      alert('Error generating.');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <main className="flex flex-col min-h-screen p-4 md:p-6 bg-zinc-50 dark:bg-zinc-900 font-sans">
      <header className="mb-6">
        <h1 className="text-3xl font-extrabold text-zinc-900 dark:text-white tracking-tight">
          CADQuery Agent
        </h1>
      </header>
      
      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-[80vh]">
        
        <div className="flex flex-col w-full lg:w-1/2 bg-white dark:bg-zinc-800 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-700 overflow-hidden">
          <div className="flex-1 overflow-hidden relative border-b border-zinc-200 dark:border-zinc-700">
            <CodeEditor value={code} onChange={handleEditorChange} />
          </div>

          <div className="p-4 bg-zinc-50 dark:bg-zinc-800/50">
            <form onSubmit={handleChatSubmit} className="flex gap-3">
              <input 
                type="text" 
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                disabled={isGenerating}
                placeholder="Ask AI to modify the model..."
                className="flex-1 px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white focus:border-transparent transition-all text-zinc-900 dark:text-white disabled:opacity-50"
              />
              <button 
                type="submit" 
                disabled={isGenerating || !chatInput.trim()} 
                className="px-6 py-3 bg-black hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black font-medium rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white focus:ring-offset-2 dark:focus:ring-offset-zinc-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center min-w-[140px]"
              >
                {isGenerating ? (
                  <span className="flex items-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Thinking...
                  </span>
                ) : 'Ask AI'}
              </button>
            </form>
          </div>
        </div>

        <div className="flex flex-col w-full lg:w-1/2 bg-zinc-100 dark:bg-black rounded-xl shadow-inner border border-zinc-200 dark:border-zinc-800 overflow-hidden relative flex items-center justify-center">
          {glbURL && <ModelViewer src={glbURL} />}
        </div>
      </div>
    </main>
  );
}