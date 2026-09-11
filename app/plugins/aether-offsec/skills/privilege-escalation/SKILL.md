---
name: privilege-escalation
description: >-
  Escalating from a foothold to root / SYSTEM on an authorized lab/CTF/owned
  target — enumerating the box from the inside (linpeas/winpeas patterns) and
  taking the common Linux and Windows privesc paths. Use once you have an
  initial shell and {{OWNER}} wants root / "privesc" / the root flag.
---

# Privilege escalation

Authorized lab/CTF/owned target only. You have a shell; now enumerate it
thoroughly before you try anything — the path is almost always sitting in the
enumeration output.

## Enumerate from the inside

Run an automated enumerator if you can stage one (transfer `linpeas.sh` /
`winPEASx64.exe` from your host via the reverse-shell listener, a Python
`http.server`, or `scp`), and read its highlights. By hand, the high-value
checks:

**Linux**
```bash
id; sudo -l                     # sudo rights are the #1 lab privesc
find / -perm -4000 -type f 2>/dev/null   # SUID binaries → check GTFOBins
cat /etc/crontab; ls -la /etc/cron.*     # writable/wildcarded cron jobs
uname -a                        # kernel — check for a matching exploit
getcap -r / 2>/dev/null         # capabilities
ss -tlnp                        # internal-only services worth port-forwarding
ls -la /home/*; cat ~/.*history # creds and keys left lying around
```
Map anything you find against **GTFOBins** — a SUID/sudo-allowed binary listed
there is usually an instant root.

**Windows**
```
whoami /priv                    # SeImpersonate/SeAssign → potato attacks
whoami /groups
systeminfo                      # OS build → kernel exploit matching
# service misconfigs (unquoted paths, weak perms), AlwaysInstallElevated,
# stored creds (cmdkey /list, registry), scheduled tasks.
```

## Take the path

Pick the cleanest finding — a `sudo -l` entry, a GTFOBins SUID, a writable
cron, a service misconfig, a kernel CVE — and exploit it. Reuse every
credential and SSH key you have found: password reuse across users and services
is the most common lab privesc there is. Spray found creds at `su`, `ssh`, and
every service.

## Finish

Confirm `id` shows root/SYSTEM, grab `root.txt`, then sweep for anything worth
pivoting on (creds, keys, config, other hosts on internal interfaces). Record
the full path — foothold → each escalation step → root — in the engagement log
with the command for each step, so the write-up reproduces cleanly.
