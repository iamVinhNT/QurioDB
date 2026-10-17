"""
handlers.py

FastAPI request logging, health checks, and global exception handling.
"""

import logging

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse

from core.desktop_runtime import configured_startup_nonce, startup_nonce_matches

logger = logging.getLogger(__name__)


def register_handlers(app: FastAPI) -> None:
    """Register lightweight middleware, health endpoints, and error handlers."""
    from services.knowledge_access import KnowledgeError

    @app.exception_handler(KnowledgeError)
    async def knowledge_error(request: Request, exc: KnowledgeError):
        return JSONResponse(status_code=exc.status, content={"detail": exc.detail})

    @app.middleware("http")
    async def log_request_info(request: Request, call_next):
        logger.info(
            "API Request: %s %s (Origin: %s)",
            request.method,
            request.url.path,
            request.headers.get("origin"),
        )
        return await call_next(request)

    @app.get("/api/health")
    @app.get("/health")
    def health():
        logger.info("Health check requested")
        return {"status": "ok"}

    expected_desktop_nonce = configured_startup_nonce()

    @app.get("/api/desktop/health")
    def desktop_health(request: Request):
        if expected_desktop_nonce is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Desktop readiness is not configured",
            )
        provided_nonce = request.headers.get("X-QurioDB-Startup-Nonce")
        if not startup_nonce_matches(provided_nonce, expected_desktop_nonce):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Desktop readiness identity mismatch",
            )
        return {"status": "ok", "service": "quriodb-desktop"}

    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled backend error on %s %s", request.method, request.url.path)
        return JSONResponse(
            status_code=500,
            content={"error": "Internal Server Error", "message": "An unexpected error occurred."},
        )
