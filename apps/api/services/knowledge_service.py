"""knowledge_service.py — Local Markdown drafts, version conflicts and lifecycle."""

import uuid

from sqlalchemy import update

from models import Db, KnowledgeBase, KnowledgeDocument, KnowledgeIndexJob, KnowledgeRevision, SessionLocal
from .knowledge_access import KnowledgeError, check_version, require_base, require_document, require_user, resource


class KnowledgeService:
    def __init__(self, session_factory=None):
        self.sessions = session_factory or SessionLocal

    def list_bases(self, user_id, database_id=None, search="", page=1, page_size=30):
        require_user(user_id)
        with self.sessions() as session:
            query = session.query(KnowledgeBase).join(Db, Db.id == KnowledgeBase.databaseId).filter(
                KnowledgeBase.userId == user_id, KnowledgeBase.archived.is_(False),
            )
            if database_id:
                query = query.filter(KnowledgeBase.databaseId == database_id)
            if search:
                query = query.filter(KnowledgeBase.name.ilike(f"%{search}%"))
            return self._page(query.order_by(KnowledgeBase.created_on.desc()), page, page_size)

    def create_base(self, data, user_id):
        require_user(user_id)
        with self.sessions() as session:
            if not session.get(Db, data.databaseId):
                raise KnowledgeError("Database connection not found", 404)
            row = KnowledgeBase(id=str(uuid.uuid4()), userId=user_id, **data.model_dump())
            session.add(row)
            session.commit()
            return resource(row)

    def get_base(self, base_id, user_id):
        with self.sessions() as session:
            return resource(require_base(session, base_id, user_id))

    def patch_base(self, base_id, data, user_id):
        with self.sessions() as session:
            row = require_base(session, base_id, user_id)
            for key, value in data.model_dump(exclude_none=True).items():
                setattr(row, key, value)
            session.commit()
            return resource(row)

    def archive_base(self, base_id, user_id):
        with self.sessions() as session:
            base = require_base(session, base_id, user_id)
            base.archived = True
            base.enabledForSql = False
            for document in session.query(KnowledgeDocument).filter_by(knowledgeBaseId=base_id):
                self._unpublish(session, document)
            session.commit()
            return {"id": base.id, "archived": True}

    def list_documents(self, base_id, user_id, search="", kind=None, state=None, page=1, page_size=30):
        with self.sessions() as session:
            require_base(session, base_id, user_id)
            query = session.query(KnowledgeDocument).filter_by(knowledgeBaseId=base_id, archived=False)
            if search:
                query = query.filter(KnowledgeDocument.title.ilike(f"%{search}%"))
            if kind:
                query = query.filter(KnowledgeDocument.kind == kind)
            if state == "published":
                query = query.filter(KnowledgeDocument.activeRevisionId.isnot(None))
            elif state == "draft":
                query = query.filter(KnowledgeDocument.activeRevisionId.is_(None))
            return self._page(query.order_by(KnowledgeDocument.changed_on.desc()), page, page_size, ("bodyMarkdown", "definitionData"))

    def create_document(self, base_id, data, user_id):
        with self.sessions() as session:
            require_base(session, base_id, user_id)
            row = KnowledgeDocument(id=str(uuid.uuid4()), knowledgeBaseId=base_id, **data.model_dump())
            session.add(row)
            session.commit()
            return resource(row)

    def get_document(self, document_id, user_id):
        with self.sessions() as session:
            row, base = require_document(session, document_id, user_id)
            result = resource(row)
            result["databaseId"] = base.databaseId
            job = session.query(KnowledgeIndexJob).join(KnowledgeRevision).filter(
                KnowledgeRevision.documentId == document_id,
            ).order_by(KnowledgeIndexJob.created_on.desc()).first()
            result["job"] = resource(job) if job else None
            return result

    def save_document(self, document_id, data, user_id):
        with self.sessions() as session:
            document, _ = require_document(session, document_id, user_id)
            check_version(document, data.expectedVersion)
            values = data.model_dump(exclude={"expectedVersion"})
            # A compare-and-swap also protects two HTTP requests that read the same version.
            changed = session.execute(update(KnowledgeDocument).where(
                KnowledgeDocument.id == document_id,
                KnowledgeDocument.version == data.expectedVersion,
                KnowledgeDocument.archived.is_(False),
            ).values(**values, version=data.expectedVersion + 1)).rowcount
            if not changed:
                raise KnowledgeError("Document changed. Reload before saving.", 409)
            session.commit()
        return self.get_document(document_id, user_id)

    def remove_document(self, document_id, user_id, archive=False):
        with self.sessions() as session:
            document, _ = require_document(session, document_id, user_id)
            self._unpublish(session, document)
            document.archived = archive
            session.commit()
            return {"id": document_id, "archived": archive, "activeRevisionId": None}

    def revisions(self, document_id, user_id):
        with self.sessions() as session:
            require_document(session, document_id, user_id)
            return [resource(row, ("bodyMarkdown", "definitionData")) for row in session.query(
                KnowledgeRevision,
            ).filter_by(documentId=document_id).order_by(KnowledgeRevision.created_on.desc())]

    def get_revision(self, document_id, revision_id, user_id):
        with self.sessions() as session:
            document, base = require_document(session, document_id, user_id)
            revision = session.get(KnowledgeRevision, revision_id)
            if not revision or revision.documentId != document_id:
                raise KnowledgeError("Revision not found", 404)
            return {**resource(revision), "knowledgeBaseId": base.id,
                    "active": document.activeRevisionId == revision_id}

    @staticmethod
    def _unpublish(session, document):
        document.activeRevisionId = None
        document.requestedRevisionId = None
        document.version += 1
        revision_ids = session.query(KnowledgeRevision.id).filter_by(documentId=document.id)
        session.query(KnowledgeIndexJob).filter(
            KnowledgeIndexJob.revisionId.in_(revision_ids),
            KnowledgeIndexJob.status.in_(["queued", "running"]),
        ).update({"status": "cancelled"}, synchronize_session=False)

    @staticmethod
    def _page(query, page, page_size, exclude=()):
        return {"items": [resource(row, exclude) for row in query.offset((page - 1) * page_size).limit(page_size)],
                "total": query.count(), "page": page, "pageSize": page_size}


knowledge_service = KnowledgeService()


def import_legacy_source(base_id, source_id, user_id):
    """Create one reviewable draft from accessible legacy chunks; never auto-publish."""
    from models import RagSource, RagChunk
    from schemas.knowledge import DocumentCreate
    from services.ai.retrieval.retrieval_service import RagRetrievalService
    if not RagRetrievalService().get_source(source_id, user_id=user_id):
        raise KnowledgeError("Source not found", 404)
    with knowledge_service.sessions() as session:
        base = require_base(session, base_id, user_id)
        source = session.get(RagSource, source_id)
        if source.sourceType not in {"document", "web_page"} or source.databaseId not in (None, base.databaseId):
            raise KnowledgeError("Choose a legacy document in this connection")
        identity = str(uuid.uuid5(uuid.NAMESPACE_URL, f"knowledge:{base_id}:legacy:{source_id}"))
        existing = session.get(KnowledgeDocument, identity)
        if existing:
            if existing.archived:
                raise KnowledgeError("This source was already imported and archived", 409)
            return resource(existing)
        chunks = session.query(RagChunk).filter_by(sourceId=source_id).order_by(RagChunk.ordinal).all()
        body = f"<!-- Imported from legacy source {source.id}; reconstructed from indexed sections. Review before publishing. -->\n\n" + "\n\n".join(c.content for c in chunks)
        data = DocumentCreate(title=source.title, kind="note", bodyMarkdown=body)
        row = KnowledgeDocument(id=identity, knowledgeBaseId=base_id, **data.model_dump())
        session.add(row)
        session.commit()
        return resource(row)
