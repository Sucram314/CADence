'use client';

import React, { useRef, useState, useEffect, forwardRef, useImperativeHandle, Suspense } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Environment, Line } from '@react-three/drei';
import { GLTFLoader } from 'three-stdlib';
import * as THREE from 'three';
import { fitStrokeToShape, FittedShape, SketchData } from '@/scripts/shapeFitting';

export type { FittedShape, ShapeType, SketchData } from '@/scripts/shapeFitting';

interface ModelViewerProps {
  src: string;
  isDrawMode: boolean;
  onSketchChange?: (hasSketch: boolean) => void;
}

export interface ModelViewerRef {
  getCompositeImage: () => Promise<string | null>;
  getSketchData: () => SketchData | null;
  clearSketch: () => void;
}

const disposeScene = (scene: THREE.Object3D) => {
  scene.traverse((child: any) => {
    if (child.isMesh) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) child.material.forEach((m: THREE.Material) => m.dispose());
        else child.material.dispose();
      }
    }
  });
};

function GLTFModel({ url }: { url: string }) {
  const [model, setModel] = useState<THREE.Group | null>(null);

  useEffect(() => {
    if (!url) return;
    let isMounted = true;
    const loader = new GLTFLoader();

    loader.load(
      url,
      (gltf) => {
        if (!isMounted) return disposeScene(gltf.scene);
        setModel(gltf.scene);
      },
      undefined,
      (error) => console.error("Error loading GLTF:", error)
    );
    return () => { isMounted = false; };
  }, [url]);

  useEffect(() => {
    return () => { if (model) disposeScene(model); };
  }, [model]);

  if (!model) return null;
  return <primitive object={model} />;
}

function ThreeScene({
  url, captureRef, raycastRef, strokes, currentStroke
}: {
  url: string; captureRef: any; raycastRef: any; strokes: THREE.Vector3[][]; currentStroke: THREE.Vector3[] | null;
}) {
  const { gl, scene, camera } = useThree();

  useEffect(() => {
    captureRef.current = () => {
      gl.render(scene, camera);
      return gl.domElement.toDataURL('image/jpeg', 0.8);
    };

    raycastRef.current = (offsetX: number, offsetY: number, width: number, height: number) => {
      const pointer = new THREE.Vector2((offsetX / width) * 2 - 1, -(offsetY / height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(pointer, camera);
      const intersects = raycaster.intersectObject(scene, true);
      const hits = intersects.filter(i => (i.object as THREE.Mesh).isMesh);
      return hits.length > 0 ? hits[0] : null;
    };
  }, [gl, scene, camera, captureRef, raycastRef]);

  return (
    <Suspense fallback={null}>
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 5]} intensity={1} />
      <Environment preset="city" />
      <GLTFModel url={url} />

      {/* depthTest={false} forces the lines to render perfectly ON TOP of the model, bypassing Z-fighting! */}
      {strokes.map((pts, i) => pts.length > 1 && (
        <Line key={i} points={pts} color="#ef4444" lineWidth={4} depthTest={false} />
      ))}

      {currentStroke && currentStroke.length > 1 && (
        <Line points={currentStroke} color="#ef4444" lineWidth={4} depthTest={false} />
      )}
    </Suspense>
  );
}

const ModelViewer = forwardRef<ModelViewerRef, ModelViewerProps>(({ src, isDrawMode, onSketchChange }, ref) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const capture3DRef = useRef<(() => string) | null>(null);
  const raycastRef = useRef<((x: number, y: number, w: number, h: number) => THREE.Intersection | null) | null>(null);

  // `strokes` holds the RENDERED points for each finished stroke. Once a stroke
  // is lifted, these are replaced with the idealized shape's points (a 2-point
  // line, a sampled circle ring, or 4 rectangle corners) instead of the raw
  // freehand path.
  const [strokes, setStrokes] = useState<THREE.Vector3[][]>([]);
  const [currentStroke, setCurrentStroke] = useState<THREE.Vector3[] | null>(null);

  // Raw freehand data for the stroke currently being drawn, plus the surface
  // normals sampled at each point (used to fit + orient the shape's plane).
  const currentRawPointsRef = useRef<THREE.Vector3[]>([]);
  const currentRawNormalsRef = useRef<THREE.Vector3[]>([]);
  // One FittedShape per completed stroke - this is what getSketchData() returns.
  const shapesRef = useRef<FittedShape[]>([]);

  const [isDrawing, setIsDrawing] = useState(false);

  const clearSketch = () => {
    setStrokes([]);
    setCurrentStroke(null);
    currentRawPointsRef.current = [];
    currentRawNormalsRef.current = [];
    shapesRef.current = [];
    if (onSketchChange) onSketchChange(false);
  };

  useImperativeHandle(ref, () => ({
    getCompositeImage: async () => {
      if (strokes.length === 0 && (!currentStroke || currentStroke.length === 0)) return null;
      if (!capture3DRef.current) return null;
      return capture3DRef.current();
    },
    getSketchData: () => {
      if (shapesRef.current.length === 0) return null;
      return shapesRef.current;
    },
    clearSketch
  }));

  const startDrawing = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDrawMode || !containerRef.current || !raycastRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;

    const hit = raycastRef.current(e.nativeEvent.offsetX, e.nativeEvent.offsetY, clientWidth, clientHeight);
    if (hit) {
      setIsDrawing(true);
      const p = hit.point.clone();
      currentRawPointsRef.current = [p];
      currentRawNormalsRef.current = hit.face ? [hit.face.normal.clone()] : [];
      setCurrentStroke([p]);
      if (onSketchChange) onSketchChange(true);
    }
  };

  const draw = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDrawing || !isDrawMode || !containerRef.current || !raycastRef.current) return;
    const { clientWidth, clientHeight } = containerRef.current;

    const hit = raycastRef.current(e.nativeEvent.offsetX, e.nativeEvent.offsetY, clientWidth, clientHeight);
    if (hit) {
      const p = hit.point.clone();
      if (hit.face) {
        const n = hit.face.normal.clone();
        currentRawNormalsRef.current.push(n.clone());
      }
      currentRawPointsRef.current.push(p);
      setCurrentStroke(prev => prev ? [...prev, p] : [p]);
    }
  };

  const stopDrawing = () => {
    if (isDrawing && currentStroke && currentStroke.length > 1) {
      const shape = fitStrokeToShape(currentRawPointsRef.current, currentRawNormalsRef.current);
      if (shape) {
        shapesRef.current.push(shape);
        const renderPoints = shape.points.map((p: [number, number, number]) => new THREE.Vector3(p[0], p[1], p[2]));
        setStrokes(prev => [...prev, renderPoints]);
      }
    }
    setCurrentStroke(null);
    currentRawPointsRef.current = [];
    currentRawNormalsRef.current = [];
    setIsDrawing(false);
  };

  return (
    <div ref={containerRef} className="relative w-full h-full">
      <Canvas
        camera={{ position: [20, 20, 20], fov: 50 }}
        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
      >
        <ThreeScene
          url={src} captureRef={capture3DRef} raycastRef={raycastRef}
          strokes={strokes} currentStroke={currentStroke}
        />
        <OrbitControls enabled={!isDrawMode} />
      </Canvas>

      {isDrawMode && (
        <div
          onPointerDown={startDrawing}
          onPointerMove={draw}
          onPointerUp={stopDrawing}
          onPointerOut={stopDrawing}
          className="absolute top-0 left-0 w-full h-full z-10 cursor-crosshair touch-none"
        />
      )}
    </div>
  );
});

ModelViewer.displayName = 'ModelViewer';
export default ModelViewer;