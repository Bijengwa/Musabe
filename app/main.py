"""FastAPI application entry point."""

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.core.config import settings
from app.routers import (
    admin,
    auth,
    branches,
    contributions,
    inventory,
    issuing,
    library,
    procurement,
    reports,
    requests,
    writeoff,
)

app = FastAPI(title=settings.app_name)

_origins = settings.cors_origin_list
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    # A wildcard origin must not be combined with credentialed requests.
    allow_credentials="*" not in _origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(branches.router)
app.include_router(requests.router)
app.include_router(procurement.router)
app.include_router(library.router)
app.include_router(inventory.router)
app.include_router(issuing.router)
app.include_router(writeoff.router)
app.include_router(contributions.router)
app.include_router(reports.router)


@app.get("/health", tags=["health"])
def health() -> dict[str, str]:
    """Return a simple liveness response."""
    return {"status": "ok"}


FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
