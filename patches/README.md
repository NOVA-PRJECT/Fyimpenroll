# Dependency security patches

`scripts/apply-security-patches.cjs` runs after installation and verifies exact source layouts. Keep scripts enabled for clean installs, including mobile build environments.

- `braces@3.0.3`: keep the parser-depth cap and iterative AST guard. Deep/cyclic patterns must fail without stack exhaustion.
- `node-forge@1.4.2`: use the upstream fixes; the installer deliberately skips the old 1.4.0 RSA rewrite on this exact version. Retain valid-signature and malformed DigestAlgorithm regressions. Unexpected forge versions still require review.
- The CommonJS URI decoder wrapper now aliases upstream `decode-uri-component@0.5.1`.
- Fixed transitive dependencies are pinned in root overrides; Zod is 4.6.7 throughout the workspace.

See [the current advisory register](../docs/security/dependency-advisory-register-2026-11-02.md) for individual advisories, reachability, selected fixes, and residual low/moderate chains. Local patches are not a blanket exemption from future advisories.
