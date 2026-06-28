'use client';

import '@google/model-viewer';

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': any;
    }
  }
}

interface ModelViewerProps {
  src: string;
}

export default function ModelViewer({ src }: ModelViewerProps) {
  return (
    <model-viewer
      src={src}
      camera-controls
      auto-rotate
      style={{ width: '100%', height: '400px' }}
    />
  );
}
