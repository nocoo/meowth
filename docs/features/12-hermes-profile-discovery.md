# Hermes profile discovery

Teams Native needs to list existing Hermes identities without reading their
prompts, configuration or credentials. `GET /v1/agents` adds an optional
`profiles: [{name}]` to the Hermes row. The default profile is explicit; valid
named directories are sorted. Discovery uses Hermes' standard and custom
`HERMES_HOME` root semantics, skips symlinks and never reads `.env`, config,
sessions or memories. Missing profiles return an empty array, not invented data.

Execution selects the returned name through Hermes' existing `--profile` custom
argument; no new mutation or execution endpoint is needed. The daemon already
passes arguments to `hermes acp`, whose CLI pre-parser accepts the profile flag
after the subcommand. Native callers must preserve that exact name and never
modify a profile. Existing clients can ignore the additive metadata.

Code: `daemon/internal/agentfactory/hermes_profiles.go`, `agentfactory.go`,
`daemon/internal/server/handlers/sessions.go`, `daemon/internal/server/openapi.yaml`,
`packages/shared/src/openapi-types.ts`.

## Atomic change plan

1. Profile discovery, wire metadata, contract generation and behavioral tests.
2. Read-only live discovery validation using the existing daemon configuration.

Changes remain in the local working tree for this integration session; no
publication or unrelated service reset is part of this work.

## 6DQ validation

- Correctness: temporary roots, sorted names, default, missing/invalid entries,
  custom/profile home resolution and HTTP serialization.
- Security: no file contents or credentials exposed; symlinks excluded.
- Reliability: a failed profile scan does not remove installed harness metadata.
- Performance: one bounded directory scan, no Python startup or model call.
- Maintainability: one discovery helper and additive OpenAPI-generated types.
- Experience: real identities usable unchanged by the consumer.

## Results

- Targeted Go factory/HTTP handler tests passed after wire assertions were added.
- The installed TypeScript 7 package lacks the compiler API needed by openapi-typescript. Contract generation succeeded with an isolated TypeScript 5.9.3 + openapi-typescript 7.13.0 tool invocation, then the repository formatter; application dependency versions were preserved.
- The rebuilt production daemon reuses port 7040 and the existing user config. A fresh authenticated discovery read returned five supported harness rows, four installed harnesses, and the actual Hermes `default` profile. No sessions were running when the daemon restarted; no profile files were changed and no model execution was needed for discovery.

- Teams Native completed real execution through Pi and the discovered Hermes default profile against an authenticated semantic CLI with generated message/contact/calendar/Knowledge data. Runs took 46.338 s and 63.459 s; actual CLI evidence, attributed note capture, and repeat-save deduplication passed. Native integration evidence is `.local/agent-live-generated/report.json` in the Teams Native workspace. No real Teams or embedding request was made by that test.
- A separate Hermes run used the real connected Teams Native account through the same CLI: 136.092 s, 16 validated citations spanning messages, contacts, and meetings, zero Teams messages sent. Evidence contains metadata only; desktop interaction remains a separate native test.
