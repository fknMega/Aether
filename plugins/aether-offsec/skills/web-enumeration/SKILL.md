---
name: web-enumeration
description: >-
  Enumerating a web service on an authorized lab/CTF/owned target — directory
  and vhost brute-forcing (gobuster / ffuf / feroxbuster), tech fingerprinting
  (whatweb / nikto), and hunting the common CTF web bugs. Use when a scan
  turns up port 80/443/8080/8000/etc, or {{OWNER}} asks you to "enumerate the
  website", "find hidden directories", "fuzz for endpoints", or "look at the
  web app".
---

# Web enumeration

Authorized lab/CTF/owned target only. Tools driven via `Bash`; some
(`gobuster`, `ffuf`, `feroxbuster`, `nikto`, `whatweb`) may need installing —
if a command is missing, say so and fall back to what is present (`curl`, and
`nmap`'s `http-*` NSE scripts). Wordlists usually live under
`/opt/homebrew/share/seclists` or `~/wordlists` once SecLists is installed;
`raft-*` and `directory-list-*` are the common directory lists,
`subdomains-top1million-*` for vhosts.

## Fingerprint first

```bash
whatweb -a3 http://TARGET/           # stack, CMS, versions, headers
curl -sI http://TARGET/              # server header, redirects, cookies
curl -s http://TARGET/robots.txt     # free hints
```
Note the CMS/framework and version — a known WordPress/Joomla/Drupal/etc
version is often the whole foothold. Check `/`, view source, and any login page.

## Directory & file brute-forcing

```bash
# feroxbuster recurses on its own — good default.
feroxbuster -u http://TARGET/ -w WORDLIST -x php,txt,html,bak -o ferox.txt
# or ffuf (fast, scriptable):
ffuf -u http://TARGET/FUZZ -w WORDLIST -e .php,.txt,.html -mc 200,204,301,302,307,401,403 -o ffuf.json
# or gobuster:
gobuster dir -u http://TARGET/ -w WORDLIST -x php,txt,html -t 40 -o gobuster.txt
```
Chase interesting hits (`/admin`, `/dev`, `/backup`, `/api`, uploads, `.git`).
Recurse into directories that themselves return listings or new paths.

## Virtual hosts & subdomains

Many CTF boxes serve different content by `Host:` header. If the box has a
domain (from the TLS cert, a redirect, or nmap), add it to `/etc/hosts` and
fuzz vhosts:
```bash
ffuf -u http://TARGET/ -H "Host: FUZZ.box.htb" -w SUBDOMAINS -fs <default-size>
```
`-fs`/`-fw` filter out the default response so only real vhosts surface.

## Bugs to check by hand

- **Parameters**: fuzz GET/POST params with ffuf; test each for LFI/RFI
  (`../../etc/passwd`, `php://filter`), SQLi (feed to `sqlmap` — see
  **exploitation-foothold**), SSTI (`{{7*7}}`), and command injection.
- **Uploads**: any upload form → try a web shell in the language the stack runs.
- **Auth**: default creds, weak creds (→ **password-attacks**), and logic flaws.
- **Exposed source**: `/.git/`, `.bak`, `~` backups, and editor swap files leak
  code and creds constantly on CTF boxes.

Every URL, endpoint, vhost, and credential goes in the engagement log as a node.
