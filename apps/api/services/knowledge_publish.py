"""knowledge_publish.py — Durable publication with staging outside metadata transactions."""

import json
import logging
from datetime import datetime, timezone
import threading
import uuid

from sqlalchemy import update
from sqlalchemy.exc import SQLAlchemyError, IntegrityError

from models import (KnowledgeBase, KnowledgeDocument, KnowledgeRevision, KnowledgeIndexJob,
                    RagSource, RagChunk, RagEmbedding, SessionLocal)
from schemas.knowledge import DefinitionData
from services.knowledge_access import KnowledgeError, check_version, require_document, resource
from services.knowledge_embeddings import KnowledgeEmbeddingGateway
from services.knowledge_graph import project_knowledge, validate_bindings
from services.ai.retrieval.schema_graph import SchemaGraphService
from services.ai.retrieval.index_documents import build_text_document_chunks, content_hash, rough_token_count
from services.ai.retrieval.sqlite_vec_store import sqlite_vec_store


class KnowledgePublisher:
    def __init__(self, session_factory=None, gateway_factory=None, graph_service=None):
        self.sessions = session_factory or SessionLocal
        self.gateway = gateway_factory or KnowledgeEmbeddingGateway
        self.graph = graph_service or SchemaGraphService(self.sessions)
        self.stop_event = threading.Event()
        self.wake_event = threading.Event()
        self.thread = None
        self.publish_lock = threading.Lock()

    def publish(self, document_id, data, user_id):
        with self.publish_lock:
            try:
                return self._publish(document_id, data, user_id)
            except IntegrityError:
                raise KnowledgeError("Publication changed concurrently. Retry the same version.", 409) from None

    def _publish(self, document_id, data, user_id):
        with self.sessions() as session:
            document, _ = require_document(session, document_id, user_id)
            check_version(document, data.expectedVersion)
            if not document.bodyMarkdown.strip():
                raise KnowledgeError("Add Markdown content before publishing")
            fingerprint = content_hash(json.dumps([document.title, document.kind, document.bodyMarkdown,
                                                   document.definitionData, "knowledge-index-v1",
                                                   self.gateway(user_id).model, "provider-default-dimensions", data.lexicalOnly], sort_keys=True))
            revision = session.query(KnowledgeRevision).filter_by(
                documentId=document_id, version=document.version, contentHash=fingerprint,
            ).first()
            if not revision:
                revision = KnowledgeRevision(id=str(uuid.uuid4()), documentId=document_id,
                                             version=document.version, title=document.title, kind=document.kind,
                                             bodyMarkdown=document.bodyMarkdown, definitionData=document.definitionData,
                                             contentHash=fingerprint, userId=user_id)
                session.add(revision)
                session.flush()
            job = session.query(KnowledgeIndexJob).filter_by(revisionId=revision.id).first()
            if not job:
                job = KnowledgeIndexJob(id=str(uuid.uuid4()), revisionId=revision.id,
                                        mode="lexical" if data.lexicalOnly else "hybrid")
                session.add(job)
            elif job.status in {"failed", "cancelled"}:
                job.status, job.error = "queued", None
                job.mode = "lexical" if data.lexicalOnly else "hybrid"
            # A queued older draft may never reactivate after a newer save or removal.
            changed = session.execute(update(KnowledgeDocument).where(
                KnowledgeDocument.id == document_id, KnowledgeDocument.version == data.expectedVersion,
                KnowledgeDocument.archived.is_(False),
            ).values(requestedRevisionId=revision.id)).rowcount
            if not changed:
                raise KnowledgeError("Document changed. Reload before publishing.", 409)
            session.commit()
            result = resource(job)
        self.wake_event.set()
        return result

    def get_job(self, job_id, user_id):
        with self.sessions() as session:
            job = session.get(KnowledgeIndexJob, job_id)
            revision = session.get(KnowledgeRevision, job.revisionId) if job else None
            if not revision:
                raise KnowledgeError("Job not found", 404)
            require_document(session, revision.documentId, user_id)
            return resource(job)

    def process_one(self):
        with self.sessions() as session:
            job = session.query(KnowledgeIndexJob).filter_by(status="queued").order_by(KnowledgeIndexJob.created_on).first()
            if not job:
                return False
            identity = job.id
            claimed = session.execute(update(KnowledgeIndexJob).where(
                KnowledgeIndexJob.id == identity, KnowledgeIndexJob.status == "queued",
            ).values(status="running")).rowcount
            if not claimed:
                return True
            revision = session.get(KnowledgeRevision, job.revisionId)
            payload = resource(revision)
            mode = job.mode
            session.commit()
        try:
            self._build_and_activate(identity, payload, mode)
        except Exception as exc:
            # No raw driver/provider exception text is persisted into user-visible diagnostics.
            with self.sessions() as session:
                job = session.get(KnowledgeIndexJob, identity)
                if job and job.status == "running":
                    job.status = "failed"
                    job.error = exc.detail if isinstance(exc, KnowledgeError) else f"Publication failed ({type(exc).__name__}). Retry or use lexical only."
                    session.commit()
        return True

    def _build_and_activate(self, job_id, payload, mode):
        with self.sessions() as session:
            document, base = require_document(session, payload["documentId"], payload["userId"])
            database_id, base_id = base.databaseId, base.id
            if document.requestedRevisionId != payload["id"]:
                raise KnowledgeError("Publication superseded by another revision", 409)
        data = DefinitionData.model_validate(payload["definitionData"])
        schemas = {binding.schemaName for binding in data.bindings}
        schemas.update(endpoint.schemaName for join in data.joins for endpoint in (join.source, join.target))
        for schema in sorted(schemas):
            self.graph.sync(database_id, schema)
        with self.sessions() as session:
            validate_bindings(session, database_id, payload["definitionData"])
        source_id = f"knowledge:{payload['id']}"
        body = payload["bodyMarkdown"]
        if any(data.model_dump().values()):
            body += "\n\n## Reviewed definitions and bindings\n" + json.dumps(data.model_dump(), ensure_ascii=False)
        chunks = build_text_document_chunks(source_id, payload["title"], body, "knowledge_document")
        if not chunks or len(chunks) > 200:
            raise KnowledgeError("Document must contain text and produce at most 200 chunks")
        vectors, gateway = [], self.gateway(payload["userId"])
        for chunk in chunks:
            if self.stop_event.is_set():
                raise KnowledgeError("Publication interrupted. Retry after startup.")
            vector = self._cached_vector(chunk, gateway, payload["userId"]) if mode == "hybrid" else []
            if mode == "hybrid" and not vector and gateway.is_available():
                vector = gateway.embed_document(chunk["content"])
                if not vector:
                    raise KnowledgeError("Embedding failed. Retry or publish lexical only.")
            vectors.append(vector)
        if self.stop_event.is_set():
            raise KnowledgeError("Publication interrupted. Retry after startup.")
        with self.sessions() as session:
            document, base = require_document(session, payload["documentId"], payload["userId"])
            job = session.get(KnowledgeIndexJob, job_id)
            if (job.status != "running" or document.version != payload["version"] or
                    document.requestedRevisionId != payload["id"]):
                if job.status == "running":
                    job.status, job.error = "cancelled", "Publication superseded by a newer draft."
                session.commit()
                return
            revision = session.get(KnowledgeRevision, payload["id"])
            evidence_section = next((f"section-{chunk['ordinal']}" for chunk in chunks
                                     if chunk.get("objectName") == "Reviewed definitions and bindings"), "section-0")
            project_knowledge(session, base, revision, section=evidence_section)
            if not session.get(RagSource, source_id):
                source = RagSource(id=source_id, sourceType="knowledge_document", databaseId=database_id,
                                   userId=payload["userId"], title=payload["title"], uri=f"knowledge://{revision.id}",
                                   contentHash=revision.contentHash, status="indexed", accessScope="user",
                                   indexed_on=datetime.now(timezone.utc))
                session.add(source)
                session.flush()
                for chunk, vector in zip(chunks, vectors):
                    metadata = chunk["metadataJson"]
                    metadata.update(documentId=document.id, revisionId=revision.id, knowledgeBaseId=base_id,
                                    schemas=sorted(schemas),
                                    section=f"section-{chunk['ordinal']}",
                                    citation=f"knowledge:{document.id}/revision:{revision.id}#section-{chunk['ordinal']}")
                    row = RagChunk(id=str(uuid.uuid4()), sourceId=source_id, **chunk,
                                   tokenCount=rough_token_count(chunk["content"]), contentHash=content_hash(chunk["content"]))
                    session.add(row)
                    session.flush()
                    if vector:
                        session.add(RagEmbedding(id=str(uuid.uuid4()), chunkId=row.id, vectorJson=vector,
                                                 dimensions=len(vector), embeddingProvider="google", embeddingModel=gateway.model))
                        sqlite_vec_store.upsert_embedding(session, row, source, vector)
            document.activeRevisionId = revision.id
            job.status, job.mode, job.error = "succeeded", "hybrid" if any(vectors) else "lexical", None
            session.commit()

    def _cached_vector(self, chunk, gateway, user_id):
        with self.sessions() as session:
            row = session.query(RagEmbedding).join(RagChunk, RagChunk.id == RagEmbedding.chunkId).join(
                RagSource, RagSource.id == RagChunk.sourceId,
            ).filter(RagSource.userId == user_id, RagChunk.contentHash == content_hash(chunk["content"]),
                     RagEmbedding.embeddingModel == gateway.model, RagEmbedding.embeddingProvider == "google",
                     RagEmbedding.dimensions > 0).first()
            return list(row.vectorJson) if row else []

    def start(self):
        if self.thread and self.thread.is_alive():
            return
        with self.sessions() as session:
            session.query(KnowledgeIndexJob).filter_by(status="running").update({"status": "queued"})
            session.commit()
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run, name="knowledge-publisher", daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        self.wake_event.set()
        if self.thread:
            self.thread.join(timeout=12)

    def _run(self):
        while not self.stop_event.is_set():
            try:
                if self.process_one():
                    continue
            except SQLAlchemyError as exc:
                logging.getLogger(__name__).warning("Knowledge worker storage failure: %s", type(exc).__name__)
            self.wake_event.wait(timeout=1)
            self.wake_event.clear()


knowledge_publisher = KnowledgePublisher()
