# cx & qx

Natural language shell tools, powered by LLMs.

- **cx** — Natural language to shell commands
- **qx** — Context-aware conversational queries

```bash
$ cx find all typescript files that import express

⏳ Thinking... (bedrock)

  ⚡ Running: find . -name "*.ts" -type f
  ⚡ Running: grep -l "import.*express" $(find . -name "*.ts")

▶ Suggested command:
  grep -rl "import.*express" --include="*.ts" .

Run this command? [y/N]: y
```

## Features

- **Natural language input** — describe what you want in plain English
- **Multi-provider support** — AWS Bedrock, OpenRouter, Ollama, or any OpenAI-compatible API
- **Tool calling** — LLM investigates your system before suggesting commands
- **Safe by default** — always prompts for confirmation before execution (cx)
- **Conversation memory** — maintains context for follow-up questions (qx)

## Installation

```bash
git clone <repo>
cd cx
npm install
npm run build
npm link      # Installs both cx and qx globally
```

## Configuration

Config lives at `~/.cx/config.json`. On first run, a default config is created.

```json
{
  "provider": "bedrock",
  "bedrock": {
    "model": "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "region": "us-east-1"
  },
  "openai": {
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKey": "your-api-key-here",
    "model": "anthropic/claude-3.5-sonnet"
  },
  "local": {
    "baseUrl": "http://localhost:11434/v1",
    "model": "llama3.2"
  }
}
```

### Providers

| Provider | `provider` value | Requirements |
|----------|------------------|--------------|
| AWS Bedrock | `"bedrock"` | AWS credentials configured (`aws configure`) |
| OpenRouter | `"openai"` | API key from [openrouter.ai](https://openrouter.ai) |
| Ollama | `"local"` | Ollama running locally (`ollama serve`) |
| LM Studio | `"local"` | LM Studio server running |

### Provider Examples

**AWS Bedrock (Claude):**
```json
{
  "provider": "bedrock",
  "bedrock": {
    "model": "anthropic.claude-3-5-sonnet-20241022-v2:0",
    "region": "us-east-1"
  }
}
```

**OpenRouter:**
```json
{
  "provider": "openai",
  "openai": {
    "baseUrl": "https://openrouter.ai/api/v1",
    "apiKey": "sk-or-v1-...",
    "model": "anthropic/claude-3.5-sonnet"
  }
}
```

**Ollama (local):**
```json
{
  "provider": "local",
  "local": {
    "baseUrl": "http://localhost:11434/v1",
    "model": "llama3.2"
  }
}
```

---

## cx — Command Mode

### Usage

```bash
cx <natural language description>
```

### Examples

```bash
# File operations
cx find all files larger than 100mb in my home directory
cx delete all node_modules folders recursively
cx compress this folder into a tar.gz

# System info
cx what processes are using the most memory
cx show disk usage sorted by size
cx what's listening on port 3000

# Git operations
cx show commits from last week by author john
cx find all branches that contain the word feature

# Text processing
cx find all TODO comments in this project
cx count lines of code by file type
cx replace all tabs with spaces in python files
```

## How It Works

1. You describe what you want in natural language
2. The LLM may use the **bash tool** to investigate your system:
   - List directories
   - Check file contents
   - Examine system state
3. After gathering context, it suggests a command
4. You confirm (`y`) or abort (`n`)
5. If confirmed, the command runs with full terminal output

## Tool Calling

The LLM has access to a `bash` tool for system investigation. This allows it to:

- Explore your file structure before suggesting `find` commands
- Check what's running before suggesting `kill` commands  
- Read config files to understand your setup
- Verify paths and filenames exist

Investigation commands are shown in gray:
```
  ⚡ Running: ls -la
  ⚡ Running: cat package.json | head -20
```

Tool output is truncated at 8KB and times out after 30 seconds.

---

## qx — Query Mode

`qx` is a context-aware conversational interface. Unlike `cx` which generates commands, `qx` maintains a conversation history for follow-up questions and complex discussions.

```bash
$ qx what is the capital of china
⏳ Thinking... (bedrock)

Beijing (北京) is the capital of China.

$ qx what is its population
⏳ Thinking... (bedrock)

Beijing has a population of approximately 21.5 million people.
```

### Features

- **Conversation memory** — maintains context across queries
- **System investigation** — can run bash commands to explore your system
- **History management** — archive, list, and restore past conversations

### Usage

```bash
qx <question or query>      # Ask a question
qx --show                   # Show current conversation
qx --clear                  # Archive and start fresh
qx --list                   # List past conversations
qx --restore <guid>         # Restore a previous conversation
```

### Examples

```bash
# General questions with follow-ups
qx what is 2+2
qx multiply that by 10
qx explain how you calculated that

# System exploration
qx what files are in this directory
qx show me the contents of package.json
qx explain what this project does

# Conversation management
qx --show                   # See full conversation so far
qx --clear                  # Start a new conversation
qx --list                   # See archived conversations
qx --restore a3f2           # Restore by GUID prefix (like Docker)
```

### Storage

- **Active conversation:** `~/.cx/active_message.json`
- **Archived history:** `~/.cx/history/`

Conversations are automatically archived when you run `--clear`, so you can always restore them later.

### GUID Prefix Matching

Like Docker, you can restore conversations using any unique prefix of the GUID:

```bash
qx --list
#   a3f2b1c8  12/02/2025, 11:24:54 AM
#   "what is the capital of china"

qx --restore a3f2           # ✓ Works if prefix is unique
qx --restore a              # ✗ Ambiguous if multiple match
```

## License

MIT

