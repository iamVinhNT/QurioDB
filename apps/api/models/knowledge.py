"""knowledge.py — Local Markdown authoring, immutable publication and durable jobs."""

import datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint

from .base import Base


def utcnow():
    return datetime.datetime.now(datetime.UTC).replace(tzinfo=None)


class KnowledgeBase(Base):
    __tablename__ = "knowledge_bases"

    id = Column(String, primary_key=True)
    userId = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    databaseId = Column(String, ForeignKey("databases.id"), nullable=False, index=True)
    name = Column(String, nullable=False)
    description = Column(Text, default="", nullable=False)
    enabledForSql = Column(Boolean, default=False, nullable=False)
    archived = Column(Boolean, default=False, nullable=False)
    created_on = Column(DateTime, default=utcnow)


class KnowledgeDocument(Base):
    __tablename__ = "knowledge_documents"

    id = Column(String, primary_key=True)
    knowledgeBaseId = Column(String, ForeignKey("knowledge_bases.id"), nullable=False, index=True)
    title = Column(String, nullable=False)
    kind = Column(String, default="design", nullable=False)
    bodyMarkdown = Column(Text, default="", nullable=False)
    definitionData = Column(JSON, default=dict, nullable=False)
    version = Column(Integer, default=1, nullable=False)
    activeRevisionId = Column(String, nullable=True, index=True)
    requestedRevisionId = Column(String, nullable=True)
    archived = Column(Boolean, default=False, nullable=False)
    changed_on = Column(DateTime, default=utcnow, onupdate=utcnow)


class KnowledgeRevision(Base):
    __tablename__ = "knowledge_revisions"
    __table_args__ = (UniqueConstraint("documentId", "version", "contentHash", name="uq_knowledge_revision_snapshot"),)

    id = Column(String, primary_key=True)
    documentId = Column(String, ForeignKey("knowledge_documents.id"), nullable=False, index=True)
    version = Column(Integer, nullable=False)
    title = Column(String, nullable=False)
    kind = Column(String, nullable=False)
    bodyMarkdown = Column(Text, nullable=False)
    definitionData = Column(JSON, default=dict, nullable=False)
    contentHash = Column(String, nullable=False)
    userId = Column(String, nullable=False)
    created_on = Column(DateTime, default=utcnow)


class KnowledgeIndexJob(Base):
    __tablename__ = "knowledge_index_jobs"

    id = Column(String, primary_key=True)
    revisionId = Column(String, ForeignKey("knowledge_revisions.id"), nullable=False, unique=True)
    status = Column(String, default="queued", nullable=False, index=True)
    mode = Column(String, default="lexical", nullable=False)
    error = Column(String, nullable=True)
    created_on = Column(DateTime, default=utcnow)
    changed_on = Column(DateTime, default=utcnow, onupdate=utcnow)
