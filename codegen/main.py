"""
CodeGen backend - FastAPI service for EUC Code Generation.

Run locally::

    cd codegen_backend/codegen_backend
    python -m uvicorn main:app --host 0.0.0.0 --port 7073 --reload
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager

from dotenv import load_dotenv

load_dotenv()  # must run before shared_lib reads COSMOS_* env vars

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from shared_lib.storage import ContainerSpec, bootstrap, is_cosmos_enabled

from routes.health_routes import router as health_router
from routes.workflow_routes import router as workflow_router
from routes.file_routes import router as file_router
from routes.run_routes import router as run_router
from routes.artifact_routes import router as artifact_router


logger = logging.getLogger("codegen_backend")
logging.basicConfig(level=logging.INFO)

# Suppress Azure SDK verbose HTTP logging (headers, bodies, etc.)
logging.getLogger("azure.core.pipeline.policies.http_logging_policy").setLevel(
    logging.WARNING
)
logging.getLogger("azure.cosmos").setLevel(logging.WARNING)
logging.getLogger("azure.storage").setLevel(logging.WARNING)


# Cosmos containers owned by the codegen subsystem.
_CODEGEN_CONTAINERS = (
    ContainerSpec("codegen-workflows", "/owner_id"),
    ContainerSpec("codegen-runs", "/workflow_id"),
    ContainerSpec("codegen-files", "/workflow_id"),
    ContainerSpec("codegen-events", "/workflow_id"),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    if is_cosmos_enabled():
        try:
            ready = bootstrap(_CODEGEN_CONTAINERS)
            logger.info("[codegen] cosmos bootstrap ready=%s", ready)
        except Exception:  # noqa: BLE001
            logger.exception("[codegen] cosmos bootstrap failed")
    else:
        logger.info("[codegen] cosmos disabled - running in stub mode (in-memory)")
    yield


app = FastAPI(
    title="EY RAID - CodeGen API",
    version="0.2.0",
    description="Code Generation service - creates production code from PDD specifications.",
    lifespan=lifespan,
    openapi_tags=[
        {"name": "Health", "description": "Liveness and version checks."},
        {"name": "Workflows", "description": "CodeGen workflow CRUD + dashboard."},
        {"name": "Files", "description": "File upload/list/delete for workflows."},
        {"name": "Runs", "description": "Start, cancel, monitor generation runs + SSE progress."},
    ],
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


@app.middleware("http")
async def _request_id(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    try:
        response = await call_next(request)
    except Exception:  # noqa: BLE001
        logger.exception(
            "Unhandled error %s %s",
            request.method,
            request.url.path,
        )
        return JSONResponse(
            status_code=500,
            content={
                "ok": False,
                "error": {
                    "code": "INTERNAL_ERROR",
                    "message": "Internal server error",
                    "request_id": rid,
                },
            },
            headers={"X-Request-ID": rid},
        )

    response.headers["X-Request-ID"] = rid
    return response


logging.getLogger("uvicorn.access").setLevel(logging.WARNING)


@app.get("/")
async def root() -> dict:
    return {
        "service": "raid-codegen",
        "framework": "fastapi",
        "version": "0.2.0",
        "endpoints": [
            "/api/health",
            "/api/codegen/dashboard/summary",
            "/api/codegen/workflows",
            "/api/codegen/workflows/{workflow_id}",
            "/api/codegen/workflows/{workflow_id}/files/upload",
            "/api/codegen/workflows/{workflow_id}/files",
        ],
    }


app.include_router(health_router, tags=["Health"])
app.include_router(workflow_router, tags=["Workflows"])
app.include_router(file_router, tags=["Files"])
app.include_router(run_router, tags=["Runs"])
app.include_router(artifact_router, tags=["Artifacts"])


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=7073, reload=True)
