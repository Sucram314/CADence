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

const REFRESH_TIME = 2000;

export default function Home() {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [glbURL, setGlbURL] = useState<string>('');

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

      const glbBlob = await response.blob();

      if(glbURL !== ''){
        URL.revokeObjectURL(glbURL);
      }

      const newURL = URL.createObjectURL(glbBlob);
      
      setGlbURL(newURL);

    } catch(error) {
      console.error(error);
    }
  }

  const handleEditorChange = (value: string | undefined) => {
    const newValue = value || '';

    if(timeout.current) clearTimeout(timeout.current);

    timeout.current = setTimeout(()=>{
      update(newValue);
    }, REFRESH_TIME);
  };

  return (
    <main style={{ padding: '20px' }}>
      <h1>CADQuery</h1>
      <div style={{ border: '1px solid #ccc', marginTop: '10px', float: 'left', width: '50%'}}>
        <CodeEditor value={"import cadquery as cq"} onChange={handleEditorChange} />
      </div>

      <div style={{ float: 'right', width: '50%', padding: '10px' }}>
        {glbURL && (
          <ModelViewer src={glbURL} />
        )}
      </div>
    </main>
  );
}
