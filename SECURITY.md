# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**[Report a vulnerability](https://github.com/statuser-cloud/mcp/security/advisories/new)**
(Security → Advisories → Report a vulnerability). Do not open a public issue.

This covers the `@statuser/mcp` package and the hosted endpoint
`https://mcp.statuser.cloud`, which runs the same code. Include the version or
the endpoint, the steps to reproduce and what an attacker gains.

Issues in the Statuser API itself can be reported the same way — they reach
the same team.

## Supported versions

Fixes go into the latest release. Update with `npx -y @statuser/mcp@latest`;
the hosted endpoint is updated with each release.
