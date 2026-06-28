'use strict';
'use client';

import { useState, useRef } from 'react';
import dynamic from 'next/dynamic';

const CodeEditor = dynamic(() => import('@/components/CodeEditor'), {
  ssr: false,
});

const ModelViewer = dynamic(() => import('@/components/ModelViewer'), {
  ssr: false,
});

export default function Home() {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [glbUrl, setGlbUrl] = useState<string>('');

  const update = async (code: string) => {
    try {
      const response = await fetch('http://127.0.0.1:8000/update', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({code: code}),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Unknown error');
      }

      // Read the GLB binary
      const glbBlob = await response.blob();
      
      // Create a URL for the 3D Viewer
      const glbUrl = URL.createObjectURL(glbBlob);
      
      setGlbUrl(glbUrl);

    } catch(error) {
      console.error(error);
      alert("An error occurred.");
    }
  }

  const handleEditorChange = (value: string | undefined) => {
    const newValue = value || '';

    if(timeout.current) clearTimeout(timeout.current);

    timeout.current = setTimeout(()=>{
      update(newValue);
    }, 3000);
  };

  return (
    <main style={{ padding: '20px' }}>
      <h1>CADQuery</h1>
      <div style={{ border: '1px solid #ccc', marginTop: '10px' }}>
        <CodeEditor value={"import cadquery as cq"} onChange={handleEditorChange} />
      </div>

      {glbUrl && (
        <ModelViewer src={glbUrl} />
      )}
    </main>
  );
}
