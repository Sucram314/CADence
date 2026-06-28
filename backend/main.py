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

@app.post("/update")
async def update_model(payload: CodePayload):
    exported_objects = []

    # Mock show_object
    def show_object(obj, *args, **kwargs):
        exported_objects.append(obj)

    exec_env = {
        "cq": cq,
        "show_object": show_object
    }

    try:
        exec(payload.code, exec_env)
    except Exception as e:
        error_msg = "".join(traceback.format_exception_only(type(e), e))
        raise HTTPException(status_code=400, detail=f"Code Error: {error_msg}")

    # Figure out what object to export
    if not exported_objects:
        raise HTTPException(status_code=400, detail="No object found to export.")
    
    final_shape = exported_objects[-1]

    # 1. Create a temp file with a .glb extension
    fd, path = tempfile.mkstemp(suffix=".glb")
    os.close(fd) 

    try:
        # 2. GLB export requires an Assembly. 
        # If the user didn't create one, we wrap their shape in one.
        if isinstance(final_shape, cq.Assembly):
            assy = final_shape
        else:
            assy = cq.Assembly(final_shape)
            
        # 3. Save the assembly. CadQuery automatically exports to GLTF/GLB 
        # based on the .glb file extension of our tempfile.
        assy.save(path)
    except Exception as e:
        os.remove(path)
        raise HTTPException(status_code=500, detail=f"Export Error: {str(e)}")

    # 4. Return the GLB file with the correct web media type
    return FileResponse(
        path, 
        media_type="model/gltf-binary", 
        filename="model.glb",
        background=BackgroundTask(os.remove, path) 
    )

if __name__ == "__main__":
    uvicorn.run("main:app", reload=True)