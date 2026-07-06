export interface Step {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, string | number>;
  code: string;
  isModified?: boolean;
}