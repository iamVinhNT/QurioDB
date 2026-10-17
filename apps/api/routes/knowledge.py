"""knowledge.py — Authenticated Markdown knowledge and publication endpoints."""

from fastapi import APIRouter, Depends, Query

from schemas.knowledge import (BaseCreate, BasePatch, DocumentCreate, DocumentPatch, JobOut,
                               Page, PreviewRequest, PublishRequest, ResourceOut, LegacyImportRequest)
from services.knowledge_service import knowledge_service
from services.knowledge_publish import knowledge_publisher
from utils.auth_middleware import get_current_user

router = APIRouter(tags=["knowledge"])


def principal(user=Depends(get_current_user)):
    from services.knowledge_access import require_user
    return require_user(user.get("userId"))


@router.get("/knowledge-bases", response_model=Page)
def list_bases(databaseId: str | None = None, search: str = "", page: int = Query(1, ge=1),
               pageSize: int = Query(30, ge=1, le=100), user_id=Depends(principal)):
    return knowledge_service.list_bases(user_id, databaseId, search, page, pageSize)


@router.post("/knowledge-bases", response_model=ResourceOut, status_code=201)
def create_base(data: BaseCreate, user_id=Depends(principal)):
    return knowledge_service.create_base(data, user_id)


@router.get("/knowledge-bases/{base_id}", response_model=ResourceOut)
def get_base(base_id: str, user_id=Depends(principal)):
    return knowledge_service.get_base(base_id, user_id)


@router.patch("/knowledge-bases/{base_id}", response_model=ResourceOut)
def patch_base(base_id: str, data: BasePatch, user_id=Depends(principal)):
    return knowledge_service.patch_base(base_id, data, user_id)


@router.delete("/knowledge-bases/{base_id}", response_model=ResourceOut)
def archive_base(base_id: str, user_id=Depends(principal)):
    return knowledge_service.archive_base(base_id, user_id)


@router.get("/knowledge-bases/{base_id}/documents", response_model=Page)
def list_documents(base_id: str, search: str = "", kind: str | None = None, state: str | None = None,
                   page: int = Query(1, ge=1), pageSize: int = Query(30, ge=1, le=100), user_id=Depends(principal)):
    return knowledge_service.list_documents(base_id, user_id, search, kind, state, page, pageSize)


@router.post("/knowledge-bases/{base_id}/documents", response_model=ResourceOut, status_code=201)
def create_document(base_id: str, data: DocumentCreate, user_id=Depends(principal)):
    return knowledge_service.create_document(base_id, data, user_id)


@router.get("/knowledge-documents/{document_id}", response_model=ResourceOut)
def get_document(document_id: str, user_id=Depends(principal)):
    return knowledge_service.get_document(document_id, user_id)


@router.patch("/knowledge-documents/{document_id}", response_model=ResourceOut)
def save_document(document_id: str, data: DocumentPatch, user_id=Depends(principal)):
    return knowledge_service.save_document(document_id, data, user_id)


@router.delete("/knowledge-documents/{document_id}", response_model=ResourceOut)
def archive_document(document_id: str, user_id=Depends(principal)):
    return knowledge_service.remove_document(document_id, user_id, archive=True)


@router.post("/knowledge-documents/{document_id}/unpublish", response_model=ResourceOut)
def unpublish(document_id: str, user_id=Depends(principal)):
    return knowledge_service.remove_document(document_id, user_id)


@router.get("/knowledge-documents/{document_id}/revisions", response_model=list[ResourceOut])
def revisions(document_id: str, user_id=Depends(principal)):
    return knowledge_service.revisions(document_id, user_id)


@router.get("/knowledge-documents/{document_id}/revisions/{revision_id}", response_model=ResourceOut)
def revision(document_id: str, revision_id: str, user_id=Depends(principal)):
    from services.knowledge_preview import revision_sections
    result = knowledge_service.get_revision(document_id, revision_id, user_id)
    result["sections"] = revision_sections(result)
    return result


@router.post("/knowledge-documents/{document_id}/publish", response_model=JobOut, status_code=202)
def publish(document_id: str, data: PublishRequest, user_id=Depends(principal)):
    return knowledge_publisher.publish(document_id, data, user_id)


@router.get("/knowledge-jobs/{job_id}", response_model=JobOut)
def get_job(job_id: str, user_id=Depends(principal)):
    return knowledge_publisher.get_job(job_id, user_id)


@router.post("/knowledge-bases/{base_id}/preview-context")
def preview_context(base_id: str, data: PreviewRequest, user_id=Depends(principal)):
    from services.knowledge_preview import preview_knowledge
    return preview_knowledge(base_id, data, user_id)


@router.post("/knowledge-bases/{base_id}/import-legacy", response_model=ResourceOut, status_code=201)
def import_legacy(base_id: str, data: LegacyImportRequest, user_id=Depends(principal)):
    from services.knowledge_service import import_legacy_source
    return import_legacy_source(base_id, data.sourceId, user_id)
