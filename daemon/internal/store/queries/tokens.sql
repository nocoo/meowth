-- name: InsertToken :exec
INSERT INTO tokens (id, name, prefix, token_hash, salt, created_at, created_via)
VALUES (?, ?, ?, ?, ?, ?, ?);

-- name: ListActiveTokensByPrefix :many
SELECT id, name, prefix, token_hash, salt, created_at, last_used_at, revoked_at, created_via
FROM tokens
WHERE prefix = ? AND revoked_at IS NULL;

-- name: ListAllTokensOrderedByCreatedAt :many
SELECT id, name, prefix, token_hash, salt, created_at, last_used_at, revoked_at, created_via
FROM tokens
ORDER BY created_at DESC;

-- name: CountTokens :one
SELECT COUNT(*) FROM tokens;

-- name: TouchTokenLastUsedAt :exec
UPDATE tokens SET last_used_at = ? WHERE id = ?;

-- name: RevokeToken :execrows
UPDATE tokens SET revoked_at = ?
WHERE id = ? AND revoked_at IS NULL;

-- name: GetTokenByID :one
SELECT id, name, prefix, token_hash, salt, created_at, last_used_at, revoked_at, created_via
FROM tokens
WHERE id = ?;
