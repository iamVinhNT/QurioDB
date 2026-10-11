"""
user_ai_config.py

SQLAlchemy model for per-user AI provider configuration in QurioDB metadata storage.
"""

import datetime

from sqlalchemy import Column, DateTime, ForeignKey, String, UniqueConstraint

from .base import Base


class UserAIConfig(Base):
    __tablename__ = "user_ai_configs"
    __table_args__ = (
        UniqueConstraint("userId", "provider", name="uq_user_ai_configs_user_provider"),
    )

    id = Column(String, primary_key=True)
    userId = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    apiKey = Column(String, nullable=False)
    provider = Column(String, default="Google")
    # Optional for built-in providers; required for Custom Provider.
    # Blank/None falls back to a built-in endpoint when one exists.
    baseUrl = Column(String, nullable=True)
    created_on = Column(DateTime, default=datetime.datetime.utcnow)
    changed_on = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)
