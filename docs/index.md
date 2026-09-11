---
layout: default
title: Aether — setup
---

# Setting up Aether

Aether is a desktop OSINT analyst: give it a name, an email, a handle, a domain or a photo and it opens a case,
runs the selector across the open web, and draws what it finds into a live knowledge graph. It runs on macOS and
Windows, on whichever brain you choose — Claude, ChatGPT, Gemini, or a local model through Ollama.

These pages get you from download to first case. Pick your operating system:

<p>
  <a class="btn" href="setup-macos.html">macOS guide</a>
  <a class="btn" href="setup-windows.html">Windows guide</a>
</p>

Then, whichever you are on:

- [Choosing and connecting a model](providers.html) — Claude, ChatGPT, Gemini or Ollama, and what each needs.
- [Modules, tools and access levels](modules.html) — installing the bundled command-line tools, adding your own
  modules, and deciding how much Aether may do on its own.

![The first-run screen: choose the model Aether runs on](media/guide/welcome-mac.png)

## What you need

| | macOS | Windows |
|---|---|---|
| **The app** | A `.dmg` from [Releases](https://github.com/fknMega/Aether/releases) | An `.exe` installer from [Releases](https://github.com/fknMega/Aether/releases) |
| **A model** | One of: a Claude subscription, an OpenAI key, a Gemini key (free tier), or Ollama | Same |
| **For the bundled tools** (optional) | Homebrew, plus `pipx` and Go for the tools Homebrew lacks | Python + `pipx`, Go, and Scoop for a few packages |

The search, recon, EXIF and graph tools work the moment Aether opens. The command-line tools (maigret,
subfinder, nuclei, nmap and friends) are an add-on — install the ones you want with a switch, from inside the app.

### Please don't use this to dox the innocent

Aether is for people and systems you are allowed to look into: your own exposure, people who asked you to check
theirs, lab and CTF boxes you own. It only reads what is already public. Point it at a stranger you have no
business investigating and you're the problem, not the tool.
