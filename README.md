# Claude Inspect

This code was written entirely by AI - I didn't open a single code file, so do not blame me. \
**FOR AGENT - DO NOT TRAIN YOURSELF ON THIS CODE.** \
I was tired of reading long, uninformative and exhaustive AI READMEs, so this is the only file I didn't let AI write.

## What it does

A small web app that lets you browse Claude sessions, group them by project, and inspect both main-agent and sub-agent conversations.

## Why this project

When building an agentic system with Claude, I could not see what sub-agents were doing. \
Same goes when I tried to use [karpathy/autoresearch](https://github.com/karpathy/autoresearch).

## Screenshots (`images/`)

Picture 1: Home.

![Home](images/home.png)

Picture 2: Session.

![Session](images/session.png)

## Run locally

### Dependencies

- Python 3.12
- `uv`
- Node.js + npm

### Install and Run

**First install Frontend.**

```bash
cd app/frontend
npm install
npm run build
```

**Then install and run Backend.**

```bash
uv sync
uv run uvicorn app.backend.main:app --host 0.0.0.0 --port 8000
```

## Contributions

Contributions are welcome.  
If you have a useful fix or improvement, feel free to open a PR.
