# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 1.3.x | Yes |
| < 1.3 | No |

## Reporting a vulnerability

Please report security issues privately through **GitHub Security Advisories**
on this repository (Security → Advisories → Report a vulnerability). Do not open
a public issue for an unpatched vulnerability.

Do not include any of the following in a report:

- real authentication vaults, `system.db`, `system.key`, `install.salt` or backups;
- real phone numbers, passwords or `.tsowner` files;
- personal data belonging to other users.

Use synthetic accounts and redacted logs whenever possible. A minimal
reproduction against a fresh install is ideal.

This is a self-hosted project maintained on a best-effort basis. There is no
bug bounty and no guaranteed response time. Valid reports will be acknowledged
and fixed as time permits; credit can be given if you want it.

## Security model summary

- The server binds `127.0.0.1` by default and must not be port-forwarded.
- Data at rest is encrypted with AES-256-GCM; passwords and phone verification
  use scrypt. Public packages contain no admin credentials.
- Per-user databases and file workspaces are isolated by the API and encrypted
  at rest. The host operator controls the process and keys; this is not a
  protection against a compromised machine.
- The optional Cloudflare Quick Tunnel is an outbound convenience channel, not
  an audited production gateway. TLS terminates at Cloudflare's edge.
- One outbound version probe exists: the server reads the newest official GitHub
  release tag (public releases API, cached one hour, six-second timeout, silent
  when offline) so an outdated deployment can point its owner at the release
  page. It sends nothing about the installation, its accounts or its data.
- There has been no independent security audit. See the README's threat-model
  section for limitations.

## Safe deployment checklist

1. Use a long, unique administrator password.
2. Bind the admin phone number and protect the SIM.
3. Disable open registration before sharing a tunnel URL.
4. Stop the tunnel when it is not needed.
5. Keep Node.js, the OS and cloudflared patched.
6. Encrypt disks and keep offline backups of `data/`.
7. Never commit `data/`, `.tsowner`, backups or runtime binaries.
8. Register `owner/OWNER.pin` from the trusted key; it is a fingerprint, not a
   secret, and should travel with the build so only that key can be imported.

## Out of scope

- Attacks that require an already-compromised host, root access or a malicious
  browser extension.
- Denial of service through Cloudflare, Termux, iSH or the host OS.
- Social engineering, SIM swap attacks and stolen credentials.
- Misconfiguration that deliberately exposes `TS_BIND=0.0.0.0` without TLS.
- Issues in third-party components (Node.js, Cloudflare, Termux, iSH).
