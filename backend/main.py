from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from starlette.background import BackgroundTask
import uvicorn
import cadquery as cq
import tempfile
import os
import traceback
import json
import re
import base64
from google import genai
from google.genai.types import GenerateContentConfig
from typing import Dict, Union, List, Optional, Any

from prompts import *

import dotenv
dotenv.load_dotenv() 

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:8000"], 
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
    isExecuted: Optional[bool] = True

class ChatPayload(BaseModel):
    prompt: str
    steps: List[StepData]
    image: Optional[str] = None 
    sketch_data: Optional[Any] = None

class UpdatePayload(BaseModel):
    steps: List[StepData]

client = genai.Client()

def build_executable_script(steps: List[StepData]) -> str:
    script = "import cadquery as cq\n\nclass CadModel:\n    def __init__(self):\n        self.model = cq.Workplane('XY')\n"
    for step in steps:
        if step.isExecuted:
            match = re.search(r"def\s+([a-zA-Z0-9_]+)\s*\(", step.code)
            if match:
                for k, v in step.parameters.items():
                    val = f'"{v}"' if isinstance(v, str) else str(v)
                    script += f"        self.{k} = {val}\n"
                script += f"        self.{match.group(1)}()\n"
    script += "\n"
    for step in steps:
        for line in step.code.split('\n'):
            script += "\n" if line.strip() == '' else f"    {line}\n"
        script += "\n"
    script += "result = CadModel()\nif result.model is not None:\n    show_object(result.model)\n"
    return script

@app.post("/generate_plan")
async def generate_plan(payload: ChatPayload):
    config = GenerateContentConfig(system_instruction=PLANNING_INSTRUCTION, temperature=0.2)
    try:
        contents = [f"Current Plan:\n{json.dumps([s.model_dump() for s in payload.steps], indent=2)}\n\nUser Request: {payload.prompt}"]
        response = client.models.generate_content(model="gemini-2.5-flash", contents=contents, config=config)
        text = response.text.removeprefix("```json").removesuffix("```").strip()
        return json.loads(text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/update_code")
async def update_code(payload: ChatPayload):
    config = GenerateContentConfig(system_instruction=UPDATING_INSTRUCTION, temperature=0.1)

    try:
        contents = [f"Current Plan:\n{json.dumps([s.model_dump() for s in payload.steps], indent=2)}\n\nUser Request: {payload.prompt}"]
        
        if payload.sketch_data:
            contents.append(f"Sketch Data:\n{json.dumps(payload.sketch_data, indent=2)}")
            if payload.image:
                data = base64.b64decode(payload.image.removeprefix("data:image/jpeg;base64,"))
                contents.append(genai.types.Part.from_bytes(data=data, mime_type="image/jpeg"))

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=contents,
            config=config
        )
        
        text = response.text.removeprefix("```json").removesuffix("```").strip()

        return json.loads(text)

    except Exception as e:
        print(traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/update")
async def update_model(payload: UpdatePayload):
    exported_objects = []
    def show_object(obj, *args, **kwargs): exported_objects.append(obj)
    exec_env = { "cadquery": cq, "cq": cq, "show_object": show_object }

    try:
        compiled_script = build_executable_script(payload.steps)
        exec(compiled_script, exec_env)
    except Exception as e:
        error_msg = "".join(traceback.format_exception_only(type(e), e))
        raise HTTPException(status_code=400, detail=f"Code Error: {error_msg}")

    if not exported_objects: raise HTTPException(status_code=400, detail="No object found to export.")
    
    final_shape = exported_objects[-1]
    fd, path = tempfile.mkstemp(suffix=".glb")
    os.close(fd) 

    try:
        if isinstance(final_shape, cq.Assembly): assy = final_shape
        else: assy = cq.Assembly(final_shape)
        assy.save(path)
    except Exception as e:
        os.remove(path)
        raise HTTPException(status_code=500, detail=f"Export Error: {str(e)}")

    return FileResponse(path, media_type="model/gltf-binary", filename="model.glb", background=BackgroundTask(os.remove, path))

if __name__ == "__main__":
    uvicorn.run("main:app", reload=True)