'use client';

import { useEffect, useRef } from 'react';
import '@google/model-viewer';

interface ModelViewerProps {
  src: string;
}

export default function ModelViewer({ src }: ModelViewerProps) {
  const viewerRef = useRef(null);

  useEffect(() => {
    const viewer = viewerRef.current as any;
    if (!viewer) return;

    const handleLoad = () => {
      viewer.model.materials.forEach((material: any) => {
        material.pbrMetallicRoughness.setBaseColorFactor([0.5, 0.5, 0.5, 1]);
      });
    };

    viewer.addEventListener('load', handleLoad);
    return () => viewer.removeEventListener('load', handleLoad);
  }, []);

  return (
    <model-viewer
      ref={viewerRef}
      src={src}
      camera-controls
      auto-rotate
      style={{ width: '100%', height: '400px' }}
      shadow-intensity="2"
      exposure="0.5"
      tone-mapping="neutral"
      environment-image="neutral"
    />
  );
}