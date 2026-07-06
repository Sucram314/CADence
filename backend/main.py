from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
import uvicorn
import cadquery as cq
import tempfile
import os
import traceback
import json
import re
from google import genai
from google.genai.types import GenerateContentConfig
from typing import Dict, Union, List, Optional

import dotenv
dotenv.load_dotenv() 

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", 
        "http://127.0.0.1:8000"
    ], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class StepData(BaseModel):
    id: str
    name: str 
    description: str 
    parameters: Dict[str, Union[float, str]] 
    code: str 
    isModified: Optional[bool] = False

class ChatPayload(BaseModel):
    prompt: str
    steps: List[StepData]

class UpdatePayload(BaseModel):
    steps: List[StepData]

client = genai.Client()

def build_executable_script(steps: List[StepData]) -> str:
    script = "import cadquery as cq\n\nclass CadModel:\n    def __init__(self):\n        self.model = None\n"
    
    for step in steps:
        match = re.search(r"def\s+([a-zA-Z0-9_]+)\s*\(", step.code)
        if match:
            func_name = match.group(1)
            for k, v in step.parameters.items():
                val = f'"{v}"' if isinstance(v, str) else str(v)
                script += f"        self.{k} = {val}\n"
            script += f"        self.{func_name}()\n"
            
    script += "\n"
    
    for step in steps:
        lines = step.code.split('\n')
        for line in lines:
            if line.strip() == '':
                script += "\n"
            else:
                script += f"    {line}\n"
        script += "\n"
        
    script += "result = CadModel()\nif result.model is not None:\n    show_object(result.model)\n"
    return script


JSON_FORMAT_INSTRUCTION = """
OUTPUT FORMAT:
You MUST return ONLY valid JSON matching this exact structure. No markdown blocks.
{
  "steps": [
    {
      "id": "step_id_string",
      "name": "Step Name",
      "description": "Step Description",
      "parameters": { "param_name": 10.5 },
      "code": "def method_name(self):\n    shape = cq.Workplane('XY').box(...)\n    shape = shape.translate((self.x_translate, self.y_translate, self.z_translate))\n    self.model = self.model.union(shape)"
    }
  ]
}
"""

@app.post("/generate_plan")
async def generate_plan(payload: ChatPayload):
    system_instruction = f"""You are an expert CadQuery (Python) assistant generating CAD planning documents.
REGENERATE THE ENTIRE PLAN: Create a sequence of steps to build the requested model from scratch.

CRITICAL RULES FOR CODE GENERATION:
1. Generate new `id` strings for each step.
2. Each step's `code` MUST be a valid Python method starting exactly with `def method_name(self):`. 
3. `self.model` starts as `None`. The first step must initialize it.
4. Subsequent steps should modify `self.model` using boolean operations (`self.model.union(shape)` or `self.model.cut(shape)`).
5. Prefer CadQuery topological selectors when positioning objects, rather than absolute translations.
{JSON_FORMAT_INSTRUCTION}
"""
    config = GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0.2,
        response_mime_type="application/json", 
    )
    
    try:
        current_steps_json = json.dumps([step.model_dump() for step in payload.steps], indent=2)
        prompt_content = f"Current Plan:\n{current_steps_json}\n\nUser Request: {payload.prompt}"
        
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt_content,
            config=config
        )
        return json.loads(response.text)
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/update_code")
async def update_code(payload: ChatPayload):
    system_instruction = f"""You are an expert CadQuery (Python) assistant.
Your goal is to UPDATE the Python code of specific steps inside a planning document.
The user has modified the descriptions/parameters of the steps marked with `"isModified": true`. This is provided only as an indicator of what the user has modified themselves and does not necessarily mark all steps which need to be updated as described in the prompt (if one is provided). 

CRITICAL RULES:
1. Return the ENTIRE planning document in your JSON array. DO NOT omit steps which you have not updated.
2. Keep the exact same `id` strings for all steps.
3. Each step's `code` MUST be a valid Python method starting exactly with `def method_name(self):`.
4. Subsequent steps should modify `self.model` using boolean operations (`self.model.union(shape)` or `self.model.cut(shape)`).
5. Prefer CadQuery topological selectors when positioning objects, rather than absolute translations.
{JSON_FORMAT_INSTRUCTION}
"""
    config = GenerateContentConfig(
        system_instruction=system_instruction,
        temperature=0.1,
        response_mime_type="application/json",
    )
    
    try:
        current_steps_json = json.dumps([step.model_dump() for step in payload.steps], indent=2)
        prompt_content = f"Current Plan:\n{current_steps_json}\n\nUser Request: {payload.prompt}"
        
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt_content,
            config=config
        )
        return json.loads(response.text)
    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/update")
async def update_model(payload: UpdatePayload):
    exported_objects = []
    def show_object(obj, *args, **kwargs):
        exported_objects.append(obj)

    exec_env = { "cadquery": cq, "cq": cq, "show_object": show_object }

    try:
        compiled_script = build_executable_script(payload.steps)
        exec(compiled_script, exec_env)
    except Exception as e:
        error_msg = "".join(traceback.format_exception_only(type(e), e))
        raise HTTPException(status_code=400, detail=f"Code Error: {error_msg}")

    if not exported_objects:
        raise HTTPException(status_code=400, detail="No object found to export.")
    
    final_shape = exported_objects[-1]
    fd, path = tempfile.mkstemp(suffix=".glb")
    os.close(fd) 

    try:
        if isinstance(final_shape, cq.Assembly):
            assy = final_shape
        else:
            assy = cq.Assembly(final_shape)
        assy.save(path)
    except Exception as e:
        os.remove(path)
        raise HTTPException(status_code=500, detail=f"Export Error: {str(e)}")

    return FileResponse(path, media_type="model/gltf-binary", filename="model.glb", background=BackgroundTask(os.remove, path))

if __name__ == "__main__":
    uvicorn.run("main:app", reload=True)