# Dependency advisory register — 2 November 2026

Audit executed against https://registry.npmjs.org/ with explicit owner authorization. Counts are flagged packages, not independently proven application exploits. Raw reports are local ignored scratch artifacts.

- Before: 31 packages (1 critical, 7 high, 22 moderate, 1 low).
- After selected fixes: 22 packages (0 critical, 0 high, 21 moderate, 1 low).
- Fixed pins: body-parser 2.4.0, multer 2.5.0, DOMPurify 3.4.17, node-forge 1.4.2, qs 6.17.1, fast-uri 3.1.9, decode-uri-component 0.5.1, Zod 4.6.7.
- Zod moved to v4 across the workspace; deprecated error-map usage was migrated. Request validation, builds and mobile export must remain release gates.
- Retain the braces depth/AST patch. The forge rewrite is retired on exactly 1.4.2; its RSA regression remains.

## Package reachability and disposition

| Package | Before → after installed versions | Audit disposition | Reachability / mitigation |
| --- | --- | --- | --- |
| @expo/cli | 57.0.31 → 57.0.31 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| @expo/config | 57.0.10 → 57.0.10 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| @expo/config-plugins | 57.0.10 → 57.0.10 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| @expo/fingerprint | 0.20.14 → 0.20.14 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| @expo/inline-modules | 0.1.8 → 0.1.8 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| @expo/local-build-cache-provider | 57.0.9 → 57.0.9 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| @expo/metro-config | 57.0.13 → 57.0.13 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| @expo/prebuild-config | 57.0.19 → 57.0.19 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| @nestjs/cli | 11.0.24 → 11.0.24 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| @nestjs/platform-express | 11.2.7 → 11.2.7 | No longer flagged | Runtime HTTP adapter. Its body-parser and multer dependency chains were replaced with pinned compatible fixes; the adapter major version is unchanged. |
| archiver | 5.3.2 → 5.3.2 | Residual moderate | Report/archive chain. Reports generate buffers with fixed entry paths; no application glob/archive extraction input path found. Residual package advisory retained. |
| archiver-utils | 2.1.0, 3.0.4 → 2.1.0, 3.0.4 | Residual moderate | Report/archive chain. Reports generate buffers with fixed entry paths; no application glob/archive extraction input path found. Residual package advisory retained. |
| babel-plugin-module-resolver | 5.0.3 → 5.0.3 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| body-parser | 2.3.0 → 2.4.0 | No longer flagged | API request validation/parsing; upgraded and regression-tested. |
| decode-uri-component | workspace → workspace | No longer flagged | Client URI decoding via CommonJS compatibility alias; upstream fixed version pinned. |
| deepmerge | 4.3.1 → 4.3.1 | Residual low | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| dompurify | 3.4.16 → 3.4.17 | No longer flagged | Optional PDF HTML path; drawing/text exports used. Upstream fixed version pinned. |
| exceljs | 4.4.0 → 4.4.0 | Residual moderate | Report/archive chain. Reports generate buffers with fixed entry paths; no application glob/archive extraction input path found. Residual package advisory retained. |
| expo | 57.0.30 → 57.0.30 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| expo-splash-screen | 57.0.10 → 57.0.10 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| fast-uri | 3.1.8 → 3.1.9 | No longer flagged | Tooling URI/schema validation; compatible v3 fix pinned. |
| fork-ts-checker-webpack-plugin | 9.1.0 → 9.1.0 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| glob | 13.0.6, 7.2.3, 9.3.5 → 13.0.6, 7.2.3, 9.3.5 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| minimatch | 10.2.6, 3.1.5, 5.1.9, 8.0.7 → 10.2.6, 3.1.5, 5.1.9, 8.0.7 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| multer | 2.4.0 → 2.5.0 | No longer flagged | API request validation/parsing; upgraded and regression-tested. |
| node-forge | 1.4.0 → 1.4.2 | No longer flagged | Expo certificate/build tooling; upstream fixed version pinned; RSA exploit regression retained. |
| qs | 6.16.0 → 6.17.1 | No longer flagged | API request validation/parsing; upgraded and regression-tested. |
| readdir-glob | 1.1.3 → 1.1.3 | Residual moderate | Report/archive chain. Reports generate buffers with fixed entry paths; no application glob/archive extraction input path found. Residual package advisory retained. |
| rimraf | 2.7.1 → 2.7.1 | Residual moderate | Build/configuration chain. Trusted workspace files and configuration; no API route passes user patterns into this chain. Residual advisory retained; no framework downgrade or incompatible global glob override. |
| zip-stream | 4.1.1 → 4.1.1 | Residual moderate | Report/archive chain. Reports generate buffers with fixed entry paths; no application glob/archive extraction input path found. Residual package advisory retained. |
| zod | 3.25.76 → 4.6.7 | No longer flagged | API request validation/parsing; upgraded and regression-tested. |

## Individual advisories

| Advisory | Owning package | Reported title | Disposition |
| --- | --- | --- | --- |
| [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828) | body-parser | body-parser vulnerable to Denial of Service via trailing bytes after a compressed request body | Upstream package updated |
| [GHSA-333x-w4r6-6crp](https://github.com/advisories/GHSA-333x-w4r6-6crp) | fast-uri | fast-uri vulnerable to scheme injection via an unescaped first-segment colon in suffix references | Upstream package updated |
| [GHSA-3g3m-2fjr-6pw4](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4) | glob | Glob: AbortSignal cancellation bypass allows post-timeout filesystem traversal | Residual; exposure boundaries above |
| [GHSA-4487-j8r4-4g2f](https://github.com/advisories/GHSA-4487-j8r4-4g2f) | node-forge | Forge: verifyCertificateChain() removes trusted CA certificates with the same subject from the CA store | Upstream package updated |
| [GHSA-4642-5mcj-2rqw](https://github.com/advisories/GHSA-4642-5mcj-2rqw) | node-forge | Forge: ASN.1 OID first arc truncation in asn1.oidToDer | Upstream package updated |
| [GHSA-525v-9gp9-w22h](https://github.com/advisories/GHSA-525v-9gp9-w22h) | node-forge | Forge: TLS client crash when the server sends no certificate | Upstream package updated |
| [GHSA-5cwg-6vw7-rj6p](https://github.com/advisories/GHSA-5cwg-6vw7-rj6p) | node-forge | Forge: AES-GCM authentication bypass via unvalidated tagLength option | Upstream package updated |
| [GHSA-5x38-2vff-x55p](https://github.com/advisories/GHSA-5x38-2vff-x55p) | node-forge | Forge: X.509 basicConstraints bypass in verifyCertificateChain() via deprecated extension OIDs 2.5.29.10 and 2.5.29.13 | Upstream package updated |
| [GHSA-6pq8-jhm2-2vcw](https://github.com/advisories/GHSA-6pq8-jhm2-2vcw) | qs | qs : qs.stringify with arrayFormat 'comma' throws an uncaught TypeError on array elements carrying a non-callable own toString (DoS) | Upstream package updated |
| [GHSA-6wvx-3r32-xmcg](https://github.com/advisories/GHSA-6wvx-3r32-xmcg) | node-forge | Forge: Prototype Pollution in forge.http cookie handling via a malicious Set-Cookie | Upstream package updated |
| [GHSA-7wch-p9px-956x](https://github.com/advisories/GHSA-7wch-p9px-956x) | node-forge | Forge: Regular expression denial of service in PEM decoding (pem.decode) | Upstream package updated |
| [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | node-forge | node-forge RSA PKCS#1 v1.5 signature verification accepts extra nested DigestAlgorithm elements | Upstream package updated |
| [GHSA-8hrf-8g6f-7xwp](https://github.com/advisories/GHSA-8hrf-8g6f-7xwp) | node-forge | Forge: Denial of service in TLS record processing via a record interleaved with a fragmented handshake message | Upstream package updated |
| [GHSA-c6gr-qvv4-5v3f](https://github.com/advisories/GHSA-c6gr-qvv4-5v3f) | dompurify | DOMPurify: SMIL attributeName=href guard is skipped when PARSER_MEDIA_TYPE is application/xhtml+xml | Upstream package updated |
| [GHSA-cg2g-xh64-v4q7](https://github.com/advisories/GHSA-cg2g-xh64-v4q7) | dompurify | DOMPurify SAFE_FOR_TEMPLATES bypass: split template expressions survive in attached shadow root content on DOM output modes | Upstream package updated |
| [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | minimatch | minimatch has potential denial of service via globparts amplification | Residual; exposure boundaries above |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) | deepmerge | deepmerge mergeObject() allows prototype poisoning of returned objects | Residual; exposure boundaries above |
| [GHSA-h6cr-wjv9-3cpp](https://github.com/advisories/GHSA-h6cr-wjv9-3cpp) | node-forge | Forge: Denial of Service via infinite loop in BigInteger.modInverse() with negative input (incomplete fix of CVE-2026-33891) | Upstream package updated |
| [GHSA-hqq3-7jhf-c5jx](https://github.com/advisories/GHSA-hqq3-7jhf-c5jx) | node-forge | Forge: Denial of service in TLS record processing via call stack exhaustion | Upstream package updated |
| [GHSA-jc66-7q78-782g](https://github.com/advisories/GHSA-jc66-7q78-782g) | node-forge | Forge: PKCS#12 MAC forgery and constant-key PBE via zero iteration count | Upstream package updated |
| [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | zod | Zod can exhaust memory while validating oversized constrained collections | Upstream package updated |
| [GHSA-mrv2-3pqr-j5jr](https://github.com/advisories/GHSA-mrv2-3pqr-j5jr) | dompurify | DOMPurify IN_PLACE: hook that removes a parent or sibling leaves the detached subtree's event handlers armed (incomplete fix for GHSA-p98j-92pf-mc4p) | Upstream package updated |
| [GHSA-q7qp-rjg7-q26m](https://github.com/advisories/GHSA-q7qp-rjg7-q26m) | multer | multer vulnerable to Denial of Service via a pending asynchronous fileFilter after request teardown | Upstream package updated |
| [GHSA-qr28-fpjm-wq7f](https://github.com/advisories/GHSA-qr28-fpjm-wq7f) | decode-uri-component | decode-uri-component vulnerable to denial of service via quadratic replacement of percent-encoded runs | Upstream package updated |
| [GHSA-w74x-v6f9-j3xg](https://github.com/advisories/GHSA-w74x-v6f9-j3xg) | fast-uri | fast-uri vulnerable to URI scheme spoofing via percent-encoded scheme decoding | Upstream package updated |
| [GHSA-wjr9-j795-jxcr](https://github.com/advisories/GHSA-wjr9-j795-jxcr) | fast-uri | fast-uri vulnerable to host confusion via unchecked WHATWG host canonicalization | Upstream package updated |
| [GHSA-xhq7-xmqj-769h](https://github.com/advisories/GHSA-xhq7-xmqj-769h) | fast-uri | fast-uri vulnerable to improper path equivalence in relative reference normalization | Upstream package updated |

## Remaining work

Maintain the remaining advisory chains when compatible upstream releases become available. Do not downgrade Expo, Nest CLI, or ExcelJS merely to make audit output disappear. Recheck reachability when adding filesystem/archive imports or dynamic glob patterns. This register records the local audit; staging and hosted configuration were not inspected.
