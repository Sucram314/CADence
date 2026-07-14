export interface Step {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, any>;
  code: string;
  isModified?: boolean;
  isExecuted?: boolean;
}

export interface TargetData {
  point: [number, number, number];
  normal: [number, number, number];
}

export interface SketchData {
  center: [number, number, number];
  normal: [number, number, number];
  dimensions: {
    width_x: number;
    height_y: number;
    depth_z: number;
    approx_radius: number;
  };
}