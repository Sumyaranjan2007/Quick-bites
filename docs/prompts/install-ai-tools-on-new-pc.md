# Prompt: install the same AI tools on a new Windows PC

> **Where files live and where new files go:** [`docs/FOLDER_MAP.md`](../FOLDER_MAP.md) — read it before creating, moving or saving any file. Index of all maps: [`docs/README.md`](../README.md).

Recreates, on another Windows PC, every skill, plugin and MCP server installed on the owner's PC on
17 Oct 2026 (`CLAUDE.md` §10), with the same names. Before you start, copy
`claude-custom-skills-2026-10-17.zip` from the old PC's Downloads folder to the new PC's Downloads
folder (USB stick or Drive). It holds six custom skills that exist nowhere else in this exact form.
Then open Claude Code (desktop app, Code tab) on the new PC and paste everything below the line.

---

Set up my Claude Code tools on this Windows PC exactly as listed. Everything is user-level (my Windows
user folder), not inside any project. Work step by step, show me each result, and stop to ask me if a
step fails. Never put any key or password in a file. Run each step's verify line before moving on.

**0. Prerequisites — check, and tell me what is missing (install nothing big without asking):**
Node.js 22 or newer (`node --version`), Git, Python 3.10 or newer, a full JDK 17 or newer
(`java --list-modules` must list `jdk.compiler`), and the Android SDK platform-tools (`adb`) — usually at
`%LOCALAPPDATA%\Android\Sdk`. Find the Claude Code CLI: `claude --version`; if `claude` is not on PATH,
use the bundled one at `%APPDATA%\Claude\claude-code\<newest version>\<id>\claude.exe` and call it `CLAUDE`
below. In Git Bash set `MSYS_NO_PATHCONV=1` so `/c` and `/d` arguments are not rewritten.

**1. Custom skills (from my zip):** unzip `%USERPROFILE%\Downloads\claude-custom-skills-2026-10-17.zip`
into `%USERPROFILE%\.claude\skills\` so these folders exist: `seniordev`, `ui-ux-designer`,
`less-token`, `cleancode`, `hiring-panel`, `linkedin-roast` (each holds a `SKILL.md`). Do not overwrite a
folder that already exists without asking me. Verify: list the folder.

**2. Official Expo skills plugin (24 skills + Expo's remote MCP):**
`CLAUDE plugin install expo@anthropic-plugin-directory`

**3. Callstack React Native plugins:**
`CLAUDE plugin marketplace add callstackincubator/agent-skills`, then
`CLAUDE plugin install building-react-native-apps@callstack-agent-skills` and
`CLAUDE plugin install testing-react-native-apps@callstack-agent-skills`

**4. Anthropic plugins:**
`CLAUDE plugin install frontend-design@anthropic-plugin-directory` and
`CLAUDE plugin install superpowers@anthropic-plugin-directory`

**5. Software Mansion skills (Reanimated authors):**
`CLAUDE plugin marketplace add software-mansion-labs/skills`, then `CLAUDE plugin install skills@swmansion`

Verify steps 2–5: `CLAUDE plugin list` shows `expo`, `building-react-native-apps`,
`testing-react-native-apps`, `frontend-design`, `superpowers`, `skills` — all enabled.

**6. Vercel React Native skill:**
from my home folder: `npx -y skills@latest add vercel-labs/agent-skills --skill vercel-react-native-skills --agent claude-code -g --copy -y`
Verify: `%USERPROFILE%\.claude\skills\vercel-react-native-skills\SKILL.md` exists.

**7. MCP server mobile-mcp (drives the emulator or a USB phone):**
`CLAUDE mcp add mobile-mcp --scope user -e ANDROID_HOME=<my Android SDK folder> -- cmd /c npx -y @mobilenext/mobile-mcp@latest`

**8. MCP server Context7 (current library docs):**
`CLAUDE mcp add --scope user --transport http context7 https://mcp.context7.com/mcp`

**9. REA (reverse-engineer-anything) with JADX for APKs:**
a) Download the pinned JADX bridge and check its checksum (PowerShell):
```powershell
$jar = Join-Path $HOME '.local\share\rea\android\jadx-headless-mcp-0.7.1-all.jar'
New-Item -ItemType Directory -Force (Split-Path $jar) | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/jadx-headless-mcp-0.7.1-all.jar' -OutFile $jar
(Get-FileHash -Algorithm SHA256 $jar).Hash.ToLowerInvariant()   # must be 6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75
```
If the hash differs, delete the file and stop.
b) Preview, then apply REA's setup for Claude Code (it registers the `rea` MCP server, backs up
`%USERPROFILE%\.claude.json`, and installs the `reverse-engineer-anything` skill):
`npx -y rea-agents@latest setup --client claude_code --dry-run`, show me the plan, then the same with `--yes`.
c) Give the `rea` server the JAR and JDK paths: back up `%USERPROFILE%\.claude.json`, then set
`mcpServers.rea.env` to `REA_JADX_MCP_JAR` = the JAR path above and `JAVA_HOME` = my JDK 17+ folder
(edit the JSON carefully, or `CLAUDE mcp remove rea` and re-add it with the same command plus
`-e REA_JADX_MCP_JAR=... -e JAVA_HOME=...`).
Verify: with those two variables set, `npx -y rea-agents@latest doctor` shows provider `jadx` as
configured and available.

**10. hermes-dec (reads React Native apps' compiled JS), pinned to the reviewed commit:**
`python -m pip install --user "git+https://github.com/P1sec/hermes-dec.git@2e796663e1fedb93dca51060797ebf3327b3fedb"`
Verify: `hbc-decompiler.exe` exists in my Python user `Scripts` folder (`python -m pip show -f hermes-dec`).

**11. Final check:** `CLAUDE mcp list` shows `mobile-mcp`, `context7` and `rea` as connected, plus
`plugin:expo:expo` as "needs authentication" (I sign in to Expo through `/mcp` when I first need it).
Tell me to start a new session so everything loads. Then give me a one-table summary of what was
installed and anything that failed.

Do not install anything else, do not change any project, and do not sign in to any of my accounts.
