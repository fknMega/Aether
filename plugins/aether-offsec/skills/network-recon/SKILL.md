---
name: network-recon
description: >-
  Port scanning and service enumeration with nmap (and rustscan / masscan) on
  an authorized lab, CTF, or owned target. Use whenever {{OWNER}} gives you an
  IP or host to "scan", "nmap", "find open ports", "enumerate services", or
  when you are starting recon on an HTB box. Covers the full-port-then-deep
  pattern, version and default-script scans, UDP, and reading the results.
---

# Network recon with nmap

For an authorized lab/CTF/owned target only (see **htb-methodology** for scope).
`nmap` and `ncat`/`nc` are installed; `rustscan`, `masscan` may be too. Run
these through `Bash`. Write output files into the workspace so you can re-read
them.

## The pattern: fast full sweep, then deep on what's open

Don't waste a slow scriptscan on all 65535 ports. Sweep fast for what's open,
then go deep on just those.

```bash
# 1) All TCP ports, fast. -p- is every port; --min-rate keeps it quick on a lab.
nmap -p- --min-rate 2000 -T4 -Pn -oN nmap-allports.txt TARGET
# (-Pn: skip host discovery — HTB boxes often drop pings and look "down".)

# 2) Deep scan just the open ports: versions + default scripts + OS guess.
PORTS=$(grep -oP '^\d+(?=/tcp\s+open)' nmap-allports.txt | paste -sd, -)
nmap -sC -sV -O -p"$PORTS" -Pn -oN nmap-deep.txt TARGET
#   -sV service/version   -sC default NSE scripts   -O OS detection
```

If `rustscan` is present it front-runs step 1 nicely:
`rustscan -a TARGET --ulimit 5000 -- -sC -sV -oN nmap-deep.txt`.

## Go deeper when a port warrants it

- **UDP** (slow — top ports only): `nmap -sU --top-ports 50 -Pn -oN nmap-udp.txt TARGET`.
  Watch for 53/DNS, 161/SNMP, 69/TFTP, 500/IKE.
- **Targeted NSE scripts** by service, e.g.
  `nmap -p445 --script "smb-enum-shares,smb-os-discovery,smb-vuln*" TARGET`,
  `nmap -p80,443 --script "http-title,http-enum,http-headers" TARGET`.
- **Version-string is a lead.** Feed every `product/version` nmap reports
  straight into `searchsploit` and a web search for that version's CVEs before
  you move on. An unenumerated version is an unfinished port.

## Reading the results

Each open port is a node on the worklist, `pending` until enumerated. Note the
service, the exact version, and the obvious next tool: 80/443 → web-enumeration;
445/139 → SMB enum; 21 → FTP anon; 22 → creds later, not now; 3306/5432/1433/
27017 → database enum; 25/110/143 → mail. Do not stop at "found open ports" —
that is the start of the work, not the end of it.
