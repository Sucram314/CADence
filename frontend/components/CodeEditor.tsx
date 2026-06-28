import Editor from '@monaco-editor/react';

interface CodeEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
}

export default function CodeEditor({ value, onChange }: CodeEditorProps) {
  return (
    <Editor
      height="50vh"
      defaultLanguage="python"
      defaultValue="import cadquery as cq"
      value={value}
      onChange={onChange}
      theme="vs-dark"
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        automaticLayout: true,
      }}
    />
  );
}
