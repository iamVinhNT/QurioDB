"""knowledge_access.py — Owner checks and authoritative publication visibility."""


from models import Db, KnowledgeBase, KnowledgeDocument, KnowledgeRevision


class KnowledgeError(ValueError):
    def __init__(self, detail: str, status: int = 422):
        super().__init__(detail)
        self.detail, self.status = detail, status


def require_user(user_id):
    if not user_id:
        raise KnowledgeError("Authentication required", 401)
    return user_id


def require_base(session, base_id, user_id):
    require_user(user_id)
    base = session.get(KnowledgeBase, base_id)
    if not base or base.userId != user_id or base.archived or not session.get(Db, base.databaseId):
        raise KnowledgeError("Knowledge base not found", 404)
    return base


def require_document(session, document_id, user_id):
    document = session.get(KnowledgeDocument, document_id)
    if not document or document.archived:
        raise KnowledgeError("Document not found", 404)
    base = require_base(session, document.knowledgeBaseId, user_id)
    return document, base


def active_revisions(session, user_id, database_id=None, base_id=None):
    """No missing-principal bypass; shared connections retain the existing policy."""
    query = session.query(KnowledgeRevision).join(
        KnowledgeDocument, KnowledgeDocument.activeRevisionId == KnowledgeRevision.id,
    ).join(KnowledgeBase, KnowledgeBase.id == KnowledgeDocument.knowledgeBaseId).join(
        Db, Db.id == KnowledgeBase.databaseId,
    ).filter(
        KnowledgeBase.userId == (user_id or ""), KnowledgeBase.archived.is_(False),
        KnowledgeBase.enabledForSql.is_(True), KnowledgeDocument.archived.is_(False),
    )
    if database_id:
        query = query.filter(KnowledgeBase.databaseId == database_id)
    if base_id:
        query = query.filter(KnowledgeBase.id == base_id)
    return query


def active_source_ids(session, user_id, database_id=None, base_id=None):
    return {f"knowledge:{revision.id}" for revision in eligible_revisions(session, user_id, database_id, base_id)}


def check_version(document, expected_version):
    if document.version != expected_version:
        raise KnowledgeError("Document changed. Reload before saving or publishing.", 409)


def resource(row, exclude=()):
    result = {}
    for column in row.__table__.columns:
        if column.name in exclude:
            continue
        value = getattr(row, column.name)
        result[column.name] = value.isoformat() if hasattr(value, "isoformat") else value
    return result


def eligible_revisions(session, user_id, database_id=None, base_id=None):
    """Revalidate live bindings so a successful DROP/rename sync revokes stale evidence."""
    from services.knowledge_graph import validate_bindings
    result = []
    for revision in active_revisions(session, user_id, database_id, base_id):
        document = session.get(KnowledgeDocument, revision.documentId)
        base = session.get(KnowledgeBase, document.knowledgeBaseId)
        try:
            validate_bindings(session, base.databaseId, revision.definitionData)
        except KnowledgeError:
            continue
        result.append(revision)
    return result
