'use strict';
'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Step } from '@/types';
import StepCard from '@/components/StepCard';
import InsertDivider from '@/components/InsertDivider';
import { ModelViewerRef } from '@/components/ModelViewer';

const ModelViewer = dynamic(() => import('@/components/ModelViewer'), { ssr: false });

const REFRESH_TIME = 2000;
const generateId = () => Math.random().toString(36).substring(2, 10);

const MOCK_STEPS: Step[] = [
  {
    id: generateId(),
    name: "Base Box",
    description: "Creates a foundational parametrized box.",
    parameters: { "length": 15, "width": 15, "height": 5 },
    code: "def make_base(self):\n    shape = cq.Workplane('XY').box(self.length, self.width, self.height)\n    self.model = shape",
    isModified: false,
    isExecuted: true
  }
];

export default function Home() {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerRef = useRef<ModelViewerRef>(null);
  
  const [history, setHistory] = useState<Step[][]>([MOCK_STEPS]);
  const [historyIndex, setHistoryIndex] = useState(0);

  const [glbURL, setGlbURL] = useState<string>('');
  const [steps, setSteps] = useState<Step[]>(MOCK_STEPS);
  const [chatInput, setChatInput] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isDrawMode, setIsDrawMode] = useState<boolean>(false);
  
  const [hasSketch, setHasSketch] = useState<boolean>(false);

  const stepsRef = useRef(steps);
  const historyRef = useRef(history);
  const historyIndexRef = useRef(historyIndex);

  useEffect(() => { stepsRef.current = steps; }, [steps]);
  useEffect(() => { historyRef.current = history; }, [history]);
  useEffect(() => { historyIndexRef.current = historyIndex; }, [historyIndex]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isZ = e.key.toLowerCase() === 'z';
      const isY = e.key.toLowerCase() === 'y';
      
      if ((e.ctrlKey || e.metaKey) && isZ) {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && isY) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUndo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      const newIdx = historyIndexRef.current - 1;
      setHistoryIndex(newIdx);
      const prevSteps = historyRef.current[newIdx];
      setSteps(prevSteps);
      update3DModel(prevSteps, false);
    }
  }, []);

  const handleRedo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      const newIdx = historyIndexRef.current + 1;
      setHistoryIndex(newIdx);
      const nextSteps = historyRef.current[newIdx];
      setSteps(nextSteps);
      update3DModel(nextSteps, false);
    }
  }, []);

  useEffect(() => {
    update3DModel(steps, false);
    return () => {
      setGlbURL(curr => { 
        if(curr) setTimeout(() => URL.revokeObjectURL(curr), 10000); 
        return ''; 
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update3DModel = async (currentSteps: Step[], saveToHistory = true) => {
    try {
      const response = await fetch('http://127.0.0.1:8000/update', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ steps: currentSteps }), 
      });

      if (!response.ok) throw new Error((await response.json()).detail || 'Unknown error');

      const glbBlob = await response.blob();
      const newURL = URL.createObjectURL(glbBlob);

      setGlbURL((prevUrl) => {
        if (prevUrl) setTimeout(() => URL.revokeObjectURL(prevUrl), 10000);
        return newURL;
      });

      if (saveToHistory) {
        setHistory(prev => {
          const cIdx = historyIndexRef.current;
          if (JSON.stringify(currentSteps) !== JSON.stringify(prev[cIdx])) {
            const newHist = prev.slice(0, cIdx + 1);
            newHist.push(currentSteps);
            setHistoryIndex(newHist.length - 1);
            return newHist;
          }
          return prev;
        });
      }
    } catch(error) {
      console.error('Update error:', error);
    }
  }

  const scheduleUpdate = (newSteps: Step[]) => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = setTimeout(async () => { await update3DModel(newSteps); }, REFRESH_TIME);
  };

  const handleUpdateStep = (index: number, updatedStep: Step) => {
    const oldStep = steps[index];
    const requiresRecompile = oldStep.code !== updatedStep.code || oldStep.isExecuted !== updatedStep.isExecuted || JSON.stringify(oldStep.parameters) !== JSON.stringify(updatedStep.parameters);

    const newSteps = [...steps];
    newSteps[index] = { ...updatedStep, isModified: true };
    setSteps(newSteps);
    if (requiresRecompile) scheduleUpdate(newSteps);
  };

  const handleDeleteStep = (index: number) => {
    const newSteps = steps.filter((_, i) => i !== index);
    setSteps(newSteps);
    scheduleUpdate(newSteps);
  };

  const handleInsertStep = (index: number) => {
    const newStep: Step = {
      id: generateId(),
      name: `Step ${steps.length + 1}`,
      description: "Custom modification step.",
      parameters: {},
      code: `def step_${steps.length + 1}(self):\n    pass`,
      isModified: true,
      isExecuted: true
    };
    const newSteps = [...steps];
    newSteps.splice(index, 0, newStep);
    setSteps(newSteps);
    scheduleUpdate(newSteps);
  };

  const handleAIAction = async (mode: 'generate_plan' | 'update_code') => {
    setIsGenerating(true);
    try {
      let compositeImage = null;
      let sketchData = null;
      
      if (viewerRef.current) {
        compositeImage = await viewerRef.current.getCompositeImage();
        sketchData = viewerRef.current.getSketchData();
      }

      const endpoint = mode === 'generate_plan' ? '/generate_plan' : '/update_code';
      const response = await fetch(`http://127.0.0.1:8000${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: chatInput, 
          steps: steps, 
          image: compositeImage, 
          sketch_data: sketchData 
        }),
      });

      if (!response.ok) throw new Error(`Failed to ${mode}`);
      const data = await response.json();
      
      if (Array.isArray(data)) {
        if (viewerRef.current) viewerRef.current.clearSketch();
        setIsDrawMode(false);
        setHasSketch(false);

        if (mode === 'update_code') {
          const updatedMap = new Map<string, Step>(data.map((s: Step) => [s.id, s]));
          let finalSteps = steps.map(s => {
            if (updatedMap.has(s.id)) {
              const updated = updatedMap.get(s.id)!;
              updatedMap.delete(s.id);
              return { ...updated, isExecuted: s.isExecuted, isModified: false }; 
            }
            return { ...s, isModified: false }; 
          });

          const remainingNewSteps = Array.from(updatedMap.values()).map(s => ({ ...s, isExecuted: true, isModified: false }));
          
          finalSteps = [...finalSteps, ...remainingNewSteps];
          
          setSteps(finalSteps);
          await update3DModel(finalSteps, true);
        } else {
          const finalSteps = data.map((s: Step) => ({
            ...s, id: s.id || generateId(), isExecuted: s.isExecuted !== undefined ? s.isExecuted : true, isModified: false
          }));
          setSteps(finalSteps);
          await update3DModel(finalSteps, true);
        }
      }
      setChatInput('');
    } catch (error) {
      console.error(error);
      alert('Error communicating with AI.');
    } finally {
      setIsGenerating(false);
    }
  };

  const canSubmit = isGenerating || (!chatInput.trim() && !hasSketch);

  return (
    <main className="flex flex-col h-screen p-4 md:p-6 bg-zinc-50 dark:bg-zinc-950 font-sans overflow-hidden">
      <header className="mb-4 shrink-0 flex justify-between items-center">
        <h1 className="text-3xl font-extrabold text-zinc-900 dark:text-white tracking-tight">CadQuery Agent</h1>
      </header>
      
      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        <div className="flex flex-col w-full lg:w-1/2 h-full bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          <div className="px-4 py-3 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700 flex justify-between items-center shrink-0">
            <h2 className="text-sm font-bold text-zinc-600 dark:text-zinc-300 uppercase tracking-wide">Planning Dashboard</h2>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 bg-zinc-50 dark:bg-zinc-950 relative">
            <InsertDivider onInsert={() => handleInsertStep(0)} />
            {steps.length > 0 ? (
              steps.map((step, idx) => (
                <React.Fragment key={step.id}>
                  <StepCard step={step} onUpdate={(updated) => handleUpdateStep(idx, updated)} onDelete={() => handleDeleteStep(idx)} />
                  <InsertDivider onInsert={() => handleInsertStep(idx + 1)} />
                </React.Fragment>
              ))
            ) : (<div className="text-center py-10 text-zinc-400 text-sm">No steps defined. Add a step or use AI.</div>)}
          </div>

          <div className="p-4 bg-white dark:bg-zinc-900 border-t border-zinc-200 dark:border-zinc-700 shrink-0">
            <div className="flex flex-col gap-3">
              <input 
                type="text" value={chatInput} onChange={(e) => setChatInput(e.target.value)} disabled={isGenerating}
                placeholder="Ask AI to modify the model..."
                className="w-full px-4 py-3 bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-black dark:focus:ring-white transition-all text-zinc-900 dark:text-white"
              />
              <div className="flex gap-3">
                <button type="button" onClick={() => handleAIAction('update_code')} disabled={canSubmit} className="flex-1 px-4 py-2 bg-white hover:bg-zinc-100 dark:bg-zinc-800 dark:hover:bg-zinc-600 text-black dark:text-white border border-zinc-300 dark:border-zinc-600 rounded-lg disabled:opacity-50 transition-all">
                  {isGenerating ? 'Thinking...' : 'Update'}
                </button>
                <button type="button" onClick={() => handleAIAction('generate_plan')} disabled={canSubmit} className="flex-1 px-4 py-2 bg-black hover:bg-zinc-800 dark:bg-white dark:hover:bg-zinc-200 text-white dark:text-black rounded-lg disabled:opacity-50 transition-all">
                  {isGenerating ? 'Thinking...' : 'Regenerate'}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col w-full lg:w-1/2 min-w-0 bg-zinc-100 dark:bg-black rounded-xl shadow-inner border border-zinc-200 dark:border-zinc-800 overflow-hidden relative items-center justify-center">
          <div className="absolute top-4 right-4 z-20 flex gap-2">
            <button onClick={() => setIsDrawMode(!isDrawMode)} className={`px-3 py-1.5 rounded-lg text-sm border transition-all ${isDrawMode ? 'bg-red-500 text-white border-red-600' : 'bg-white dark:bg-zinc-800 text-zinc-700 dark:text-zinc-200 border-zinc-300 dark:border-zinc-700'}`}>
              {isDrawMode ? '✏️ Drawing Active' : '✏️ Annotate'}
            </button>
            <button onClick={() => viewerRef.current?.clearSketch()} className="px-3 py-1.5 rounded-lg text-sm bg-white dark:bg-zinc-800 text-white border border-zinc-200 dark:border-zinc-600 transition-all">
              Clear
            </button>
          </div>

          <div className="w-full h-full relative">
            <ModelViewer 
              ref={viewerRef} 
              src={glbURL} 
              isDrawMode={isDrawMode} 
              onSketchChange={setHasSketch} 
            />
          </div>
        </div>
      </div>
    </main>
  );
}