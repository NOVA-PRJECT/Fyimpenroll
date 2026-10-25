# Temporary dependency security patches

`scripts/apply-security-patches.cjs` runs after installation. It checks exact package versions and patch locations and refuses unexpected source layouts. Backend-only installations safely skip absent mobile tools. These changes retain the original upstream licenses and versions; npm audit continues to report the upstream advisories.

- `braces@3.0.3`, MIT, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm): cap parser nesting and validate supplied ASTs iteratively before recursive compile, expansion and stringify. Deep/cyclic ASTs raise a controlled SyntaxError before recursion.
- `node-forge@1.4.0`, BSD-3-Clause, [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv): require the nested DigestAlgorithm sequence to contain exactly the OID and its optional empty NULL parameter. Reject trailing nested elements.

Both advisories list no patched upstream release as of 2026-10-22. Remove each patch only after upgrading to an upstream fix and retaining the exploit regression tests. Never disable these install scripts in the mobile development/build environment. CI runs the regressions to detect an omitted patch.

The vulnerable URI decoder is upgraded to upstream 0.5.0 via a small CommonJS compatibility package in `vendor/decode-uri-component`. The old UUID dependency under xcode is overridden with 11.1.1. Expo and React Native versions are retained.
