# Security policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Do not open a public GitHub issue for security vulnerabilities.

Open a GitHub issue with the title "Security" and minimal detail, then
contact the maintainer directly. Include:

- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix, if you have one

We will respond within 72 hours and aim to release a patch within 14 days
of confirmation, depending on severity and complexity.

## Scope

The following are in scope:

- Authentication bypass
- Session fixation or hijacking
- SQL injection or other injection attacks
- Remote code execution
- Privilege escalation
- Information disclosure of sensitive data
- Incorrect IP validation in proxy trust mode

The following are out of scope:

- Attacks requiring physical access to the server
- Attacks requiring existing admin credentials
- DNS spoofing at the network level (outside HexBlock's control)
- Third-party dependencies — report those to the upstream project

## Disclosure policy

We follow coordinated disclosure. We ask for a minimum 14-day embargo after
a patch is released before full public disclosure. We will credit researchers
who report valid vulnerabilities unless they prefer to remain anonymous.
