# Remove stale stack config

Removed files that described a stack QurioDB does not use (Next.js, Prisma, tRPC, Postgres) and updated the agent context to match. Nothing in code, build or packaging referenced them.

## Files changed

- Removed `bts.jsonc` (Better-T-Stack generator output; its header says it is safe to delete).
- Removed `apps/api/database/prisma-migrations/` and `apps/api/database/prisma-schema/`; the whole `apps/api/database/` directory is gone. The metadata DB is SQLAlchemy + SQLite and is created by `apps/api/services/startup.py`.
- `AGENTS.md`: dropped the "Stale or wrong" gotcha, since every item it listed is now removed (`.codex/` no longer exists), and added a two-line product summary (what the app does and who uses it).

## Impact

- Desktop/API/UI/data: none. No runtime path imported these files.
- Agents: no longer read a config that contradicts the real stack.

## Verification

- `grep` for `bts.jsonc`, `prisma-schema`, `prisma-migrations`, `schema.prisma` and `api/database` outside the removed files found only the AGENTS.md note that this change removes (and unrelated runtime URLs in `.playwright-mcp/` logs).
- No tests were run; the change touches no executable code.
