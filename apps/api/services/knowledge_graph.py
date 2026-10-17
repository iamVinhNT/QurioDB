"""knowledge_graph.py — Validate reviewed bindings and project publication evidence."""

from models import GraphNode, RagSource
from schemas.knowledge import DefinitionData
from services.knowledge_access import KnowledgeError
from services.ai.retrieval.schema_graph import add_edge, node_id


def validate_bindings(session, database_id, data):
    data = DefinitionData.model_validate(data)
    objects = [*data.bindings, *[endpoint for join in data.joins for endpoint in (join.source, join.target)]]
    for binding in objects:
        identity = node_id(database_id, binding.schemaName, binding.tableName, binding.columnName, binding.catalogName)
        node = session.get(GraphNode, identity)
        source = session.get(RagSource, node.schemaSourceId) if node and node.schemaSourceId else None
        if not node or not source or source.contentHash != node.snapshotHash or source.status != "indexed":
            raise KnowledgeError(f"Unresolved or stale binding: {binding.schemaName}.{binding.tableName}")
    for join in data.joins:
        if not join.confirmed:
            raise KnowledgeError("Confirm every logical join before publishing")
        for left, right in join.columnPairs:
            for binding, column in ((join.source, left), (join.target, right)):
                node = session.get(GraphNode, node_id(database_id, binding.schemaName, binding.tableName, column, binding.catalogName))
                source = session.get(RagSource, node.schemaSourceId) if node else None
                if not node or not source or node.snapshotHash != source.contentHash or source.status != "indexed":
                    raise KnowledgeError("Logical join references an unknown column")
    for definition in data.definitions:
        if definition.kind == "metric" and (not definition.formula.strip() or not definition.grain.strip()):
            raise KnowledgeError("A metric requires its formula and grain")
        if definition.kind == "example" and (not definition.verified or not definition.sql.strip() or not definition.dialect):
            raise KnowledgeError("SQL examples require SQL, dialect and explicit verification")
    return data


def project_knowledge(session, base, revision, section="section-0"):
    data = validate_bindings(session, base.databaseId, revision.definitionData)
    document_node = f"revision:{revision.id}"
    if not session.get(GraphNode, document_node):
        session.add(GraphNode(id=document_node, databaseId=base.databaseId, nodeType="document",
                              label=revision.title, revisionId=revision.id, payloadJson={}))
    session.flush()
    for binding in data.bindings:
        target = node_id(base.databaseId, binding.schemaName, binding.tableName, binding.columnName, binding.catalogName)
        add_edge(session, base.databaseId, document_node, "DESCRIBES", target, {}, revision_id=revision.id, section=section)
    for index, definition in enumerate(data.definitions):
        concept = f"revision:{revision.id}:definition:{index}"
        if not session.get(GraphNode, concept):
            session.add(GraphNode(id=concept, databaseId=base.databaseId, nodeType=definition.kind,
                                  label=definition.name, revisionId=revision.id,
                                  payloadJson=definition.model_dump()))
        session.flush()
        add_edge(session, base.databaseId, document_node, "DEFINES", concept, {}, revision_id=revision.id, section=section)
        for binding in data.bindings:
            target = node_id(base.databaseId, binding.schemaName, binding.tableName, binding.columnName, binding.catalogName)
            add_edge(session, base.databaseId, concept, "USES_COLUMN" if binding.columnName else "EXAMPLE_FOR",
                     target, {}, revision_id=revision.id, section=section)
    for join in data.joins:
        source = node_id(base.databaseId, join.source.schemaName, join.source.tableName, catalog=join.source.catalogName)
        target = node_id(base.databaseId, join.target.schemaName, join.target.tableName, catalog=join.target.catalogName)
        payload = {"columnPairs": join.columnPairs, "role": join.role, "cardinality": join.cardinality,
                   "schemaName": join.source.schemaName}
        add_edge(session, base.databaseId, source, "LOGICAL_JOIN", target, payload, revision_id=revision.id, section=section)
