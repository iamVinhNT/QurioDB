"""rag_graph.py — Typed local schema and reviewed knowledge relationships."""

from sqlalchemy import Column, ForeignKey, Index, JSON, String

from .base import Base


class GraphNode(Base):
    __tablename__ = "rag_graph_nodes"

    id = Column(String, primary_key=True)
    databaseId = Column(String, ForeignKey("databases.id"), nullable=False, index=True)
    nodeType = Column(String, nullable=False)
    schemaName = Column(String, nullable=True)
    tableName = Column(String, nullable=True)
    columnName = Column(String, nullable=True)
    label = Column(String, nullable=False)
    payloadJson = Column(JSON, default=dict, nullable=False)
    schemaSourceId = Column(String, nullable=True, index=True)
    snapshotHash = Column(String, nullable=True)
    revisionId = Column(String, ForeignKey("knowledge_revisions.id"), nullable=True, index=True)


class GraphEdge(Base):
    __tablename__ = "rag_graph_edges"

    id = Column(String, primary_key=True)
    databaseId = Column(String, ForeignKey("databases.id"), nullable=False, index=True)
    sourceId = Column(String, ForeignKey("rag_graph_nodes.id"), nullable=False, index=True)
    targetId = Column(String, ForeignKey("rag_graph_nodes.id"), nullable=False, index=True)
    relation = Column(String, nullable=False)
    payloadJson = Column(JSON, default=dict, nullable=False)


class GraphEvidence(Base):
    __tablename__ = "rag_graph_evidence"

    id = Column(String, primary_key=True)
    edgeId = Column(String, ForeignKey("rag_graph_edges.id"), nullable=False, index=True)
    revisionId = Column(String, ForeignKey("knowledge_revisions.id"), nullable=True, index=True)
    schemaSourceId = Column(String, nullable=True, index=True)
    snapshotHash = Column(String, nullable=True)
    section = Column(String, nullable=False, default="")

    __table_args__ = (Index("ix_graph_evidence_origin", "schemaSourceId", "snapshotHash"),)
