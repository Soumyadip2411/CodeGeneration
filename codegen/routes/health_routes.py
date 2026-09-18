from fastapi import APIRouter, Depends

from shared_lib.auth import current_role, current_user_id
from shared_lib.storage import health as storage_health

from config import settings


router = APIRouter()


@router.get("/api/health")
async def health(
    user_id: str = Depends(current_user_id),
    role: str = Depends(current_role),
) -> dict:
    """Lightweight health/version endpoint."""
    cosmos_ok, info = storage_health()
    return {
        "status": "ok",
        "service": settings.service_name,
        "subsystem": "codegen",
        "version": "0.1.0",
        "caller": {"user_id": user_id, "role": role},
        "shared_lib": {"cosmos": info, "cosmos_ok": cosmos_ok},
    }
