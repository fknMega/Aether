---
name: htb-methodology
description: >-
  The end-to-end workflow for owning a HackTheBox / CTF / authorized-lab
  machine — recon → enumerate → foothold → privilege-escalate → loot →
  document. Use this the moment {{OWNER}} points you at a lab box (an HTB IP,
  a CTF target, a range he owns) and asks you to "get a shell", "root this
  box", "pop it", "find the flags", or otherwise run an offensive engagement.
  This is the map; the other offsec skills are the detail for each phase.
---

# Owning a lab box, start to finish

**Scope first, always.** This skill and its tools are for a target {{OWNER}}
has designated authorized — a HackTheBox machine (typically `10.10.10.0/24` or
`10.129.0.0/16` reachable over the HTB VPN), a CTF box, a lab range, or
infrastructure he owns or holds written authorization to test. If the target's
authorization is genuinely unclear, ask him to confirm scope before you touch
it. Never point these tools at an OSINT case subject or a third party's
production systems.

## Keep an engagement log

Open a notes file in the workspace at the start (`Write`), named for the box,
and keep it live the whole way through — like the OSINT worklist. Record: open
ports and versions, every URL/vhost/endpoint found, credentials and hashes,
each finding with the exact command that produced it, and the two flags
(`user.txt`, `root.txt`) once you have them. This is what the write-up is built
from.

## The loop

1. **Recon the host.** Full TCP port sweep, then a versioned/script scan of
   what's open. → skill **network-recon**. Don't act on a service until you
   know its version.
2. **Enumerate every service.** Each open port is a lead. Web → skill
   **web-enumeration**. SMB/FTP/DNS/SNMP/LDAP/databases → enumerate for
   anonymous access, shares, users, and version-specific bugs. Exhaust one
   service before moving to the next, but list them all first.
3. **Get a foothold.** Turn an enumerated weakness into code execution — a
   known exploit, a web vuln, default/weak creds, an exposed admin panel. →
   skill **exploitation-foothold**. Catch the shell, then upgrade it to a
   proper TTY before you do anything fiddly.
4. **Grab the user flag** and stabilise: who am I, what can I read, what creds
   are lying around.
5. **Escalate to root/SYSTEM.** Enumerate the box from the inside, find the
   privesc path, take it. → skill **privilege-escalation**.
6. **Loot and document.** Grab `root.txt`, sweep for creds/keys worth pivoting
   on, and write the box up: the path in order, each finding with its evidence
   and the command that produced it, and remediation notes where they apply.

## Working discipline

- **Enumerate harder before you exploit.** On a lab box, "I'm stuck" almost
  always means a service wasn't enumerated fully — a missed vhost, an untried
  wordlist, a version whose CVE you didn't check. Go back and look before you
  reach for something exotic.
- **Every credential is a skeleton key.** A password found in one place gets
  sprayed at every service and every user — reuse is the whole game.
- **Note footprint, but a lab box expects noise.** Loud scanning against an HTB
  target is fine; the same restraint that governs OSINT footprint doesn't
  constrain an authorized lab engagement. Still confirm before anything
  destructive on {{OWNER}}'s own workstation.
- **Confirm the target once at the start** if scope is unclear, then work it
  end-to-end without stopping to re-ask on every step — same autonomy as an
  OSINT case.
