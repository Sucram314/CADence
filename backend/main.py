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
from google import genai
from google.genai.types import GenerateContentConfig

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

class CodePayload(BaseModel):
    code: str

class ChatPayload(BaseModel):
    prompt: str
    current_code: str

client = genai.Client()

system_instruction = """You are an expert CadQuery (Python) assistant.
The user will provide you with their current code and a request to modify it.

Rules:
1. You must return ONLY valid Python code.
2. Do not include markdown formatting like ```python ... ```. Just the raw code.
3. Do not include any step-by-step explanations in comments. Only use comments for major section headers.
4. You MUST output the final shape using the 'show_object(your_shape)' function.
"""

gemini_config = GenerateContentConfig(
    system_instruction=system_instruction,
    temperature=1.0,
)

@app.post("/generate")
async def generate_code(payload: ChatPayload):
    try:
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=f"Current Code:\n{payload.current_code}\n\nRequest: {payload.prompt}",
            config=gemini_config
        )
        
        new_code = response.text.strip()
        
        # Strip markdown formatting just in case the LLM ignores the rule
        if new_code.startswith("```python"):
            new_code = new_code[9:]
        if new_code.startswith("```"):
            new_code = new_code[3:]
        if new_code.endswith("```"):
            new_code = new_code[:-3]
            
        return {"code": new_code.strip()}
        
    except Exception as e:
        print(e)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/update")
async def update_model(payload: CodePayload):
    exported_objects = []

    def show_object(obj, *args, **kwargs):
        exported_objects.append(obj)

    exec_env = {
        "cadquery": cq,
        "cq": cq,
        "show_object": show_object
    }

    try:
        exec(payload.code, exec_env)
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

    return FileResponse(
        path, 
        media_type="model/gltf-binary", 
        filename="model.glb",
        background=BackgroundTask(os.remove, path) 
    )

if __name__ == "__main__":
    uvicorn.run("main:app", reload=True)