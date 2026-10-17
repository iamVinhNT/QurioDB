"""
routers.py

FastAPI router registration for QurioDB API modules.
"""

from fastapi import FastAPI

from routes.ai import ai_bp
from routes.ai_config import ai_config_bp
from routes.auth import auth_bp
from routes.connection_routes import connection_bp
from routes.dashboard_routes import dashboard_bp
from routes.execution_routes import execution_bp
from routes.import_routes import import_bp
from routes.metadata_routes import metadata_bp
from routes.rag import router as rag_router
from routes.knowledge import router as knowledge_router
from routes.rag_graph import router as graph_router
from routes.user import user_bp


def register_routers(app: FastAPI) -> None:
    """Attach all API routers to their public prefixes."""
    app.include_router(connection_bp, prefix="/api/database")
    app.include_router(metadata_bp, prefix="/api/database")
    app.include_router(execution_bp, prefix="/api/database")
    app.include_router(auth_bp, prefix="/api/auth")
    app.include_router(user_bp, prefix="/api/user")
    app.include_router(ai_bp, prefix="/api/ai")
    app.include_router(ai_config_bp, prefix="/api/ai-config")
    app.include_router(rag_router, prefix="/api/rag")
    app.include_router(knowledge_router, prefix="/api")
    app.include_router(graph_router, prefix="/api")
    app.include_router(dashboard_bp, prefix="/api/database/dashboard")
    app.include_router(import_bp, prefix="/api/database")
