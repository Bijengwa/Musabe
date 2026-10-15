"""FastAPI application entry point."""

from fastapi import FastAPI

from app.core.config import settings
from app.routers import (
    admin,
    auth,
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

app.include_router(auth.router)
app.include_router(admin.router)
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
