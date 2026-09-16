"""
test_ai_mongodb_query.py

Focused tests for the structured, read-only MongoDB AI query contract.
"""

import re

import pytest

from services.ai.mongodb_query import (
    MongoQueryPolicy,
    MongoQueryPolicyError,
    MongoQueryRenderer,
    MongoQuerySpec,
    build_mongodb_field_allowlist,
    redact_mongo_sensitive_payload,
    redact_mongo_sensitive_text,
)


@pytest.mark.parametrize(
    ("value", "expected_fragments"),
    [
        (
                "Show orders mongodb://user:uri-secret@example.test/db password=assignment-secret refreshToken: camel-secret client-secret=kebab-secret privateKey=json-secret connectionString=connection-secret uri=uri-secret useful text",
                ["Show orders", "useful text", "[redacted-uri]", "password=[redacted]", "refreshToken: [redacted]", "client-secret=[redacted]", "privateKey=[redacted]", "connectionString=[redacted]", "uri=[redacted]"],

        ),
        (
            '{"refreshToken":"json-token","clientSecret":"json-client","safe":"keep"}',
            ['"refreshToken":[redacted]', '"clientSecret":[redacted]', '"safe":"keep"'],
        ),
    ],
)
def test_redact_mongo_sensitive_text_uses_shared_sensitive_key_variants(value, expected_fragments):
    redacted = redact_mongo_sensitive_text(value)

    assert all(fragment in redacted for fragment in expected_fragments)
    assert all(secret not in redacted for secret in ("uri-secret", "assignment-secret", "camel-secret", "kebab-secret", "json-secret", "connection-secret"))


def test_redact_mongo_sensitive_payload_recurses_through_arrays_and_shared_variants():
    payload = {
        "safe": "keep",
        "refreshToken": "token-secret",
        "profiles": [
            {"clientSecret": "client-secret", "displayName": "Ada"},
            {"private-key": "private-secret", "uri": "uri-secret"},
        ],
    }

    redacted = redact_mongo_sensitive_payload(payload)

    assert redacted == {
        "safe": "keep",
        "[redacted-key]": "[redacted]",
        "profiles": [
            {"[redacted-key]": "[redacted]", "displayName": "Ada"},
            {"[redacted-key]": "[redacted]", "[redacted-key]": "[redacted]"},
        ],
    }


@pytest.mark.parametrize("operation", ["find", "findOne", "aggregate", "countDocuments", "distinct"])
def test_mongo_query_spec_accepts_supported_read_operations(operation):
    payload = {"operation": operation, "collection": "orders"}
    if operation == "aggregate":
        payload["pipeline"] = [{"$match": {"status": "paid"}}]
    if operation == "distinct":
        payload["field"] = "status"

    spec = MongoQuerySpec.from_payload(payload)

    assert spec.operation == operation
    assert spec.collection == "orders"


def test_mongo_query_spec_rejects_missing_collection_and_unknown_operation():
    with pytest.raises(ValueError, match="collection"):
        MongoQuerySpec.from_payload({"operation": "find"})

    with pytest.raises(ValueError, match="Unsupported MongoDB operation"):
        MongoQuerySpec.from_payload({"operation": "updateOne", "collection": "orders"})

    with pytest.raises(ValueError, match="database"):
        MongoQuerySpec.from_payload(
            {"operation": "find", "collection": "orders", "database": 7}
        )


@pytest.mark.parametrize(
    "payload, message",
    [
        ({"operation": "updateOne", "collection": "orders"}, "Unsupported MongoDB operation"),
        ({"operation": "find", "collection": "orders", "options": {"limit": 0}}, "limit"),
        ({"operation": "find", "collection": "orders", "options": {"limit": 1001}}, "limit"),
        ({"operation": "find", "collection": "orders", "options": {"maxTimeMS": 0}}, "maxTimeMS"),
        ({"operation": "find", "collection": "orders", "options": {"maxTimeMS": 30001}}, "maxTimeMS"),
        ({"operation": "find", "collection": "orders", "filter": {"$where": "this.total > 0"}}, "$where"),
        (
            {
                "operation": "aggregate",
                "collection": "orders",
                "pipeline": [{"$set": {"x": {"$function": {"body": "return 1"}}}}],
            },
            "$function",
        ),
        (
            {
                "operation": "aggregate",
                "collection": "orders",
                "pipeline": [{"$out": "archive"}],
            },
            "$out",
        ),
        (
            {
                "operation": "aggregate",
                "collection": "orders",
                "pipeline": [{"$merge": {"into": "archive"}}],
            },
            "$merge",
        ),
        (
            {
                "operation": "aggregate",
                "collection": "orders",
                "pipeline": [{"$group": {"x": {"$accumulator": {}}}}],
            },
            "$accumulator",
        ),
    ],
)
def test_mongo_query_policy_rejects_unsafe_or_unbounded_specs(payload, message):
    exception = ValueError if message.startswith("Unsupported") else MongoQueryPolicyError
    with pytest.raises(exception, match=re.escape(message)):
        spec = MongoQuerySpec.from_payload(payload)
        MongoQueryPolicy().validate(spec)


def test_mongo_query_policy_adds_bounded_limit_and_timeout():
    spec = MongoQueryPolicy().validate(
        MongoQuerySpec.from_payload({"operation": "find", "collection": "orders"})
    )

    assert spec.options["limit"] == 100
    assert spec.options["maxTimeMS"] == 30000


@pytest.mark.parametrize(
    ("operator", "value"),
    [
        ("$elemMatch", {"sku": "A-1"}),
        ("$all", [{"$elemMatch": {"sku": "A-1"}}]),
        ("$size", 1),
    ],
)
def test_mongodb_field_allowlist_keeps_safe_array_parent_for_filters(operator, value):
    allowlist = build_mongodb_field_allowlist(
        {
            "orders": [
                {"name": "items", "isArray": True},
                {"name": "items.sku"},
            ]
        }
    )

    spec = MongoQueryPolicy(
        known_collections={"orders"},
        field_allowlist=allowlist,
        array_field_allowlist={"orders": {"items"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "find",
                "collection": "orders",
                "filter": {"items": {operator: value}},
            }
        )
    )

    assert spec.filter == {"items": {operator: value}}
    assert "items" in allowlist["orders"]


def test_mongodb_field_allowlist_rejects_array_parent_with_sensitive_descendant():
    allowlist = build_mongodb_field_allowlist(
        {
            "orders": [
                {"name": "items", "isArray": True},
                {"name": "items.password"},
            ]
        }
    )

    assert "items" not in allowlist["orders"]
    assert all("password" not in path for path in allowlist["orders"])

    with pytest.raises(MongoQueryPolicyError, match="unknown field"):
        MongoQueryPolicy(
            known_collections={"orders"},
            field_allowlist=allowlist,
            array_field_allowlist={"orders": {"items"}},
        ).validate(
            MongoQuerySpec.from_payload(
                {
                    "operation": "find",
                    "collection": "orders",
                    "filter": {"items": {"$size": 1}},
                }
            )
        )


def test_mongodb_array_parent_is_not_used_for_leaf_only_projection():
    spec = MongoQueryPolicy(
        known_collections={"orders"},
        field_allowlist={"orders": {"_id", "items", "items.sku"}},
        array_field_allowlist={"orders": {"items"}},
    ).validate(MongoQuerySpec.from_payload({"operation": "find", "collection": "orders"}))

    assert spec.projection == {"_id": 1, "items.sku": 1}


def test_mongo_query_policy_rejects_unknown_collection_when_metadata_is_available():
    spec = MongoQuerySpec.from_payload({"operation": "find", "collection": "users"})

    with pytest.raises(MongoQueryPolicyError, match="unknown collection"):
        MongoQueryPolicy(known_collections={"orders"}).validate(spec)


@pytest.mark.parametrize(
    "payload",
    [
        {"operation": "find", "collection": "orders", "filter": {"customer.email": "a@example.test"}},
        {"operation": "find", "collection": "orders", "projection": {"customer.email": 1}},
        {"operation": "distinct", "collection": "orders", "field": "customer.email"},
        {
            "operation": "aggregate",
            "collection": "orders",
            "pipeline": [{"$sort": {"customer.email": 1}}],
        },
        {
            "operation": "aggregate",
            "collection": "orders",
            "pipeline": [{"$project": {"email": "$customer.email"}}],
        },
    ],
)
def test_mongo_query_policy_rejects_unknown_authoritative_field_references(payload):
    with pytest.raises(MongoQueryPolicyError, match="unknown field"):
        MongoQueryPolicy(
            known_collections={"orders"},
            field_allowlist={"orders": {"_id", "status", "items", "items.sku"}},
        ).validate(MongoQuerySpec.from_payload(payload))


@pytest.mark.parametrize(
    "payload",
    [
        {"operation": "find", "collection": "orders", "filter": {"password": "secret"}},
        {"operation": "find", "collection": "orders", "projection": {"credentials": 1}},
        {"operation": "distinct", "collection": "orders", "field": "api_key"},
        {
            "operation": "aggregate",
            "collection": "orders",
            "pipeline": [{"$group": {"_id": "$secret"}}],
        },
    ],
)
def test_mongo_query_policy_rejects_sensitive_authoritative_field_references(payload):
    with pytest.raises(MongoQueryPolicyError, match="sensitive field"):
        MongoQueryPolicy(
            known_collections={"orders"},
            field_allowlist={"orders": {"_id", "status", "password", "secret", "api_key"}},
        ).validate(MongoQuerySpec.from_payload(payload))


def test_build_mongodb_field_allowlist_suppresses_parent_with_sensitive_descendant():
    allowlist = build_mongodb_field_allowlist(
        {
            "users": [
                {"name": "profile"},
                {"name": "profile.password"},
                {"name": "profile.name"},
            ]
        }
    )

    assert allowlist == {"users": ("_id", "profile.name")}


def test_mongo_query_policy_leaf_projects_parent_alias_from_authoritative_descendants():
    spec = MongoQueryPolicy(
        known_collections={"users"},
        field_allowlist={"users": {"_id", "profile.name"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "aggregate",
                "collection": "users",
                "pipeline": [
                    {"$project": {"profile": "$profile"}},
                    {"$sort": {"profile.name": 1}},
                ],
            }
        )
    )

    assert spec.pipeline[-1] == {"$project": {"_id": 1, "profile.name": 1}}


def test_mongo_query_policy_tracks_nested_computed_object_leaf_paths():
    spec = MongoQueryPolicy(
        known_collections={"users"},
        field_allowlist={"users": {"_id", "first_name", "last_name"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "aggregate",
                "collection": "users",
                "pipeline": [
                    {
                        "$project": {
                            "profile": {
                                "name": "$first_name",
                                "label": "$last_name",
                            }
                        }
                    },
                    {"$sort": {"profile.name": 1}},
                ],
            }
        )
    )

    assert spec.pipeline[-1] == {"$project": {"_id": 1, "profile.label": 1, "profile.name": 1}}


def test_mongo_query_policy_rejects_unknown_nested_computed_object_field():
    with pytest.raises(MongoQueryPolicyError, match="unknown field"):
        MongoQueryPolicy(
            known_collections={"users"},
            field_allowlist={"users": {"_id", "first_name"}},
        ).validate(
            MongoQuerySpec.from_payload(
                {
                    "operation": "aggregate",
                    "collection": "users",
                    "pipeline": [
                        {"$project": {"profile": {"name": "$first_name"}}},
                        {"$sort": {"profile.email": 1}},
                    ],
                }
            )
        )


def test_mongo_query_policy_marks_array_distinct_without_model_control():
    spec = MongoQueryPolicy(
        known_collections={"orders"},
        field_allowlist={"orders": {"_id", "tags"}},
        array_field_allowlist={"orders": {"tags"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {"operation": "distinct", "collection": "orders", "field": "tags"}
        )
    )

    assert spec.distinct_is_array is True
    assert "distinct_is_array" not in spec.to_payload()


def test_mongo_query_policy_permits_id_and_array_dot_notation_with_authoritative_fields():
    spec = MongoQueryPolicy(
        known_collections={"orders"},
        field_allowlist={"orders": {"_id", "items", "items.sku"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "find",
                "collection": "orders",
                "filter": {"items.sku": "A-1", "_id": "order-1"},
                "projection": {"items.sku": 1, "_id": 0},
                "options": {"sort": {"items.sku": 1}},
            }
        )
    )

    assert spec.filter == {"items.sku": "A-1", "_id": "order-1"}
    assert spec.options["sort"] == {"items.sku": 1}


def test_mongo_query_policy_rejects_array_bracket_field_paths():
    with pytest.raises(MongoQueryPolicyError, match="dot notation"):
        MongoQueryPolicy(
            known_collections={"orders"},
            field_allowlist={"orders": {"items", "items.sku"}},
        ).validate(
            MongoQuerySpec.from_payload(
                {"operation": "find", "collection": "orders", "filter": {"items[].sku": "A-1"}}
            )
        )


def test_mongo_query_policy_validates_fields_inside_all_elem_match_filters():
    with pytest.raises(MongoQueryPolicyError, match="unknown field"):
        MongoQueryPolicy(
            known_collections={"orders"},
            field_allowlist={"orders": {"_id", "items", "items.sku"}},
        ).validate(
            MongoQuerySpec.from_payload(
                {
                    "operation": "find",
                    "collection": "orders",
                    "filter": {"items": {"$all": [{"$elemMatch": {"unknown": "x"}}]}},
                }
            )
        )


def test_mongo_query_policy_requires_authoritative_fields_for_numeric_aggregate_projection():
    with pytest.raises(MongoQueryPolicyError, match="unknown field"):
        MongoQueryPolicy(
            known_collections={"orders"},
            field_allowlist={"orders": {"_id", "status"}},
        ).validate(
            MongoQuerySpec.from_payload(
                {
                    "operation": "aggregate",
                    "collection": "orders",
                    "pipeline": [{"$project": {"unknown": 1}}],
                }
            )
        )


@pytest.mark.parametrize("operation", ["find", "findOne"])
def test_mongo_query_policy_rejects_parent_object_projection_when_only_descendants_are_authoritative(operation):
    with pytest.raises(MongoQueryPolicyError, match="leaf"):
        MongoQueryPolicy(
            known_collections={"orders"},
            field_allowlist={"orders": {"_id", "profile", "profile.name"}},
        ).validate(
            MongoQuerySpec.from_payload(
                {
                    "operation": operation,
                    "collection": "orders",
                    "projection": {"profile": 1},
                }
            )
        )


def test_mongo_query_policy_allows_explicit_parent_projection_without_sampled_descendants():
    spec = MongoQueryPolicy(
        known_collections={"orders"},
        field_allowlist={"orders": {"_id", "profile"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "find",
                "collection": "orders",
                "projection": {"profile": 1},
            }
        )
    )

    assert spec.projection == {"_id": 1, "profile": 1}


def test_mongo_query_policy_allows_group_alias_in_later_sort_stage():
    spec = MongoQueryPolicy(
        known_collections={"orders"},
        field_allowlist={"orders": {"_id", "status", "amount"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "aggregate",
                "collection": "orders",
                "pipeline": [
                    {"$group": {"_id": "$status", "total": {"$sum": "$amount"}}},
                    {"$sort": {"total": -1}},
                ],
            }
        )
    )

    assert spec.pipeline[1] == {"$sort": {"total": -1}}
    assert spec.pipeline[-1] == {"$project": {"_id": 1, "total": 1}}


def test_mongo_query_policy_rejects_unknown_field_after_group_stage():
    with pytest.raises(MongoQueryPolicyError, match="unknown field"):
        MongoQueryPolicy(
            known_collections={"orders"},
            field_allowlist={"orders": {"_id", "status", "amount"}},
        ).validate(
            MongoQuerySpec.from_payload(
                {
                    "operation": "aggregate",
                    "collection": "orders",
                    "pipeline": [
                        {"$group": {"_id": "$status", "total": {"$sum": "$amount"}}},
                        {"$sort": {"unknown": -1}},
                    ],
                }
            )
        )


def test_mongo_query_policy_tracks_project_and_set_aliases_across_stages():
    spec = MongoQueryPolicy(
        known_collections={"orders"},
        field_allowlist={"orders": {"_id", "status", "amount"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "aggregate",
                "collection": "orders",
                "pipeline": [
                    {"$project": {"status": 1, "amount": 1}},
                    {"$set": {"total": "$amount"}},
                    {"$sort": {"total": 1}},
                ],
            }
        )
    )

    assert spec.pipeline[-1] == {"$project": {"_id": 1, "status": 1, "amount": 1, "total": 1}}


@pytest.mark.parametrize(
    "replace_stage",
    [
        {"$replaceRoot": {"newRoot": "$profile"}},
        {"$replaceWith": "$profile"},
    ],
)
def test_mongo_query_policy_tracks_fields_after_replace_stages(replace_stage):
    spec = MongoQueryPolicy(
        known_collections={"users"},
        field_allowlist={"users": {"_id", "profile.name", "profile.age"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "aggregate",
                "collection": "users",
                "pipeline": [replace_stage, {"$sort": {"name": 1}}],
            }
        )
    )

    assert spec.pipeline[-1] == {"$project": {"_id": 1, "age": 1, "name": 1}}


def test_mongo_query_policy_tracks_unset_and_unwind_fields_across_stages():
    spec = MongoQueryPolicy(
        known_collections={"orders"},
        field_allowlist={"orders": {"_id", "items.sku", "items.price", "status"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "aggregate",
                "collection": "orders",
                "pipeline": [
                    {"$unwind": {"path": "$items", "includeArrayIndex": "position"}},
                    {"$unset": "status"},
                    {"$sort": {"position": 1}},
                ],
            }
        )
    )

    assert spec.pipeline[-1] == {
        "$project": {"_id": 1, "items.price": 1, "items.sku": 1, "position": 1}
    }


def test_mongo_query_policy_adds_authorized_leaf_projection_for_find():
    spec = MongoQueryPolicy(
        known_collections={"orders"},
        field_allowlist={
            "orders": {"_id", "status", "customer", "customer.id", "items", "items.sku"}
        },
    ).validate(MongoQuerySpec.from_payload({"operation": "find", "collection": "orders"}))

    assert spec.projection == {"_id": 1, "customer.id": 1, "items.sku": 1, "status": 1}


def test_mongo_query_policy_adds_authorized_final_projection_for_aggregate():
    spec = MongoQueryPolicy(
        known_collections={"orders"},
        field_allowlist={"orders": {"_id", "status", "total"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "aggregate",
                "collection": "orders",
                "pipeline": [{"$group": {"_id": "$status", "total": {"$sum": 1}}}],
            }
        )
    )

    assert spec.pipeline[-1] == {"$project": {"_id": 1, "total": 1}}


@pytest.mark.parametrize("key", ["__proto__", "prototype", "constructor"])
def test_mongo_query_policy_rejects_prototype_like_keys(key):
    spec = MongoQuerySpec.from_payload(
        {"operation": "find", "collection": "orders", "filter": {key: {"value": 1}}}
    )

    with pytest.raises(MongoQueryPolicyError, match="prototype"):
        MongoQueryPolicy().validate(spec)


@pytest.mark.parametrize("stage", ["$lookup", "$graphLookup", "$unionWith"])
def test_mongo_query_policy_rejects_cross_collection_stages(stage):
    spec = MongoQuerySpec.from_payload(
        {
            "operation": "aggregate",
            "collection": "orders",
            "pipeline": [{stage: {"from": "secrets"}}],
        }
    )

    with pytest.raises(MongoQueryPolicyError, match="cross-collection"):
        MongoQueryPolicy().validate(spec)


def test_mongo_query_policy_rejects_system_collection_and_unknown_operator():
    with pytest.raises(MongoQueryPolicyError, match="system"):
        MongoQueryPolicy().validate(
            MongoQuerySpec.from_payload({"operation": "find", "collection": "system.users"})
        )

    with pytest.raises(MongoQueryPolicyError, match="unsupported MongoDB operator"):
        MongoQueryPolicy().validate(
            MongoQuerySpec.from_payload(
                {"operation": "find", "collection": "orders", "filter": {"status": {"$unknown": 1}}}
            )
        )


def test_mongo_query_policy_rejects_credential_like_values_and_database_mismatch():
    with pytest.raises(MongoQueryPolicyError, match="credential"):
        MongoQueryPolicy().validate(
            MongoQuerySpec.from_payload(
                {
                    "operation": "find",
                    "collection": "orders",
                    "filter": {"connection": "mongodb://user:password@example.test/db"},
                }
            )
        )

    with pytest.raises(MongoQueryPolicyError, match="database"):
        MongoQueryPolicy(trusted_database="analytics").validate(
            MongoQuerySpec.from_payload(
                {"operation": "find", "collection": "orders", "database": "other"}
            )
        )


def test_mongo_query_renderer_uses_canonical_get_collection_syntax():
    spec = MongoQueryPolicy().validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "find",
                "collection": "orders",
                "database": "analytics",
                "filter": {"status": "paid", "customerId": 7},
                "projection": {"_id": 0, "status": 1},
                "options": {"limit": 25, "maxTimeMS": 1000, "sort": {"status": 1}},
            }
        )
    )

    assert (
        MongoQueryRenderer.render(spec)
        == 'db.getSiblingDB("analytics").getCollection("orders").find({"customerId":7,"status":"paid"},{"_id":0,"status":1}).sort({"status":1}).limit(25).maxTimeMS(1000)'
    )


def test_mongo_query_renderer_uses_default_limit_for_unvalidated_spec():
    spec = MongoQuerySpec.from_payload({"operation": "find", "collection": "orders"})

    assert MongoQueryRenderer.render(spec) == 'db.getSiblingDB("test").getCollection("orders").find({}).limit(100)'


@pytest.mark.parametrize(
    "payload, expected",
    [
        (
            {"operation": "find", "collection": "orders", "database": "analytics"},
            'db.getSiblingDB("analytics").getCollection("orders").find({}).limit(100)',
        ),
        (
            {"operation": "findOne", "collection": "orders", "database": "analytics"},
            'db.getSiblingDB("analytics").getCollection("orders").findOne({})',
        ),
        (
            {
                "operation": "aggregate",
                "collection": "orders",
                "database": "analytics",
                "pipeline": [{"$match": {"status": "paid"}}],
            },
            'db.getSiblingDB("analytics").getCollection("orders").aggregate([{"$match":{"status":"paid"}}]).limit(100)',
        ),
        (
            {"operation": "countDocuments", "collection": "orders", "database": "analytics"},
            'db.getSiblingDB("analytics").getCollection("orders").countDocuments({})',
        ),
        (
            {"operation": "distinct", "collection": "orders", "database": "analytics", "field": "status"},
            'db.getSiblingDB("analytics").getCollection("orders").distinct("status",{})',
        ),
    ],
)
def test_mongo_query_renderer_qualifies_all_read_operations(payload, expected):
    spec = MongoQueryPolicy(trusted_database="analytics").validate(MongoQuerySpec.from_payload(payload))

    assert MongoQueryRenderer.render(spec) == expected


def test_mongo_query_policy_rejects_deep_and_large_aggregate_specs():
    nested = value = {}
    for _ in range(21):
        value["nested"] = {}
        value = value["nested"]

    with pytest.raises(MongoQueryPolicyError, match="nesting"):
        MongoQueryPolicy().validate(
            MongoQuerySpec.from_payload({"operation": "find", "collection": "orders", "filter": nested})
        )

    with pytest.raises(MongoQueryPolicyError, match="pipeline"):
        MongoQueryPolicy().validate(
            MongoQuerySpec.from_payload(
                {"operation": "aggregate", "collection": "orders", "pipeline": [{}] * 21}
            )
        )


@pytest.mark.parametrize("operator", ["$push", "$first", "$ifNull"])
def test_mongo_query_policy_projects_only_authorized_nested_leaves_for_computed_objects(operator):
    operand = ["$profile", None] if operator == "$ifNull" else "$profile"
    spec = MongoQueryPolicy(
        known_collections={"users"},
        field_allowlist={"users": {"_id", "profile.name"}},
    ).validate(
        MongoQuerySpec.from_payload(
            {
                "operation": "aggregate",
                "collection": "users",
                "pipeline": [
                    {"$group": {"_id": "$_id", "profile": {operator: operand}}}
                ],
            }
        )
    )

    assert spec.pipeline[-1] == {"$project": {"_id": 1, "profile.name": 1}}
    assert "profile" not in spec.pipeline[-1]["$project"]
    assert "profile.password" not in spec.pipeline[-1]["$project"]
