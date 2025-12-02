#!/usr/bin/env node

import { ChatBedrockConverse } from "@langchain/aws";
import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
  HumanMessage,
  SystemMessage,
  AIMessage,
  BaseMessage,
} from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { execSync } from "child_process";
import { platform, homedir } from "os";
import {
  readFileSync,
  existsSync,
  mkdirSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
} from "fs";
import { join } from "path";
import { randomUUID } from "crypto";

// Config types (shared with cx)
interface BedrockConfig {
  model?: string;
  region?: string;
}

interface OpenAIConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface LocalConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

interface Config {
  provider: "bedrock" | "openai" | "local";
  bedrock?: BedrockConfig;
  openai?: OpenAIConfig;
  local?: LocalConfig;
}

// Message types for storage
interface StoredMessage {
  role: "system" | "human" | "assistant";
  content: string;
  timestamp: string;
}

interface MessageHistory {
  id: string;
  created: string;
  updated: string;
  messages: StoredMessage[];
}

interface HistoryRecord {
  id: string;
  created: string;
  updated: string;
  preview: string;
  messageCount: number;
}

const CONFIG_DIR = join(homedir(), ".cx");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const ACTIVE_MESSAGE_PATH = join(CONFIG_DIR, "active_message.json");
const HISTORY_DIR = join(CONFIG_DIR, "history");

const DEFAULT_CONFIG: Config = {
  provider: "bedrock",
  bedrock: {
    model: "anthropic.claude-3-5-sonnet-20241022-v2:0",
    region: "us-east-1",
  },
  openai: {
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "your-api-key-here",
    model: "anthropic/claude-3.5-sonnet",
  },
  local: {
    baseUrl: "http://localhost:11434/v1",
    model: "llama3.2",
  },
};

function ensureDirectories() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(HISTORY_DIR)) {
    mkdirSync(HISTORY_DIR, { recursive: true });
  }
}

function loadConfig(): Config {
  ensureDirectories();

  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2));
    console.log(`\x1b[33mCreated default config at ${CONFIG_PATH}\x1b[0m`);
    console.log(
      `\x1b[33mEdit it to configure your preferred provider.\x1b[0m\n`
    );
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(CONFIG_PATH, "utf-8");
    return JSON.parse(content) as Config;
  } catch {
    console.error(`\x1b[31mError reading config file:\x1b[0m ${CONFIG_PATH}`);
    process.exit(1);
  }
}

function createModel(config: Config): BaseChatModel {
  switch (config.provider) {
    case "bedrock": {
      const bedrockConfig = config.bedrock || {};
      return new ChatBedrockConverse({
        model:
          bedrockConfig.model || "anthropic.claude-3-5-sonnet-20241022-v2:0",
        region: bedrockConfig.region || "us-east-1",
      });
    }

    case "openai": {
      const openaiConfig = config.openai;
      if (!openaiConfig) throw new Error("OpenAI config not found");
      return new ChatOpenAI({
        modelName: openaiConfig.model,
        openAIApiKey: openaiConfig.apiKey,
        configuration: {
          baseURL: openaiConfig.baseUrl,
        },
      });
    }

    case "local": {
      const localConfig = config.local;
      if (!localConfig) throw new Error("Local config not found");
      return new ChatOpenAI({
        modelName: localConfig.model,
        openAIApiKey: localConfig.apiKey || "not-needed",
        configuration: {
          baseURL: localConfig.baseUrl,
        },
      });
    }

    default:
      throw new Error(`Unknown provider: ${config.provider}`);
  }
}

// Bash tool for system investigation
const bashTool = tool(
  async ({ command }) => {
    console.log(`\x1b[90m  ⚡ Running: ${command}\x1b[0m`);
    try {
      const output = execSync(command, {
        encoding: "utf-8",
        timeout: 30000,
        maxBuffer: 1024 * 1024,
        env: process.env,
        shell: process.env.SHELL || "/bin/bash",
      });
      const trimmed = output.trim();
      if (trimmed.length > 8000) {
        return trimmed.slice(0, 8000) + "\n... (output truncated)";
      }
      return trimmed || "(no output)";
    } catch (error) {
      if (error instanceof Error) {
        const execError = error as Error & {
          stdout?: string;
          stderr?: string;
          status?: number;
        };
        const stderr = execError.stderr || execError.message;
        return `Error (exit ${execError.status || 1}): ${stderr}`;
      }
      return "Unknown error occurred";
    }
  },
  {
    name: "bash",
    description:
      "Execute a bash command to investigate the system. Use this to explore files, check system state, list directories, run code, etc. Returns the command output.",
    schema: z.object({
      command: z
        .string()
        .describe("The bash command to execute for investigation"),
    }),
  }
);

function getSystemPrompt(): string {
  const osType = platform();
  const shell = process.env.SHELL || "/bin/bash";
  const cwd = process.cwd();

  return `You are a helpful, context-aware assistant with access to a bash tool for system investigation.

ENVIRONMENT:
- OS: ${osType}
- Shell: ${shell}
- Current directory: ${cwd}

You maintain conversation context across messages. When answering questions:
1. Use the bash tool to investigate the system when helpful
2. Remember previous context from our conversation
3. Provide clear, helpful answers
4. For technical questions, you can run commands to verify or demonstrate

Be conversational and helpful. You can answer general questions, help with coding, investigate the system, or assist with any task.`;
}

function loadActiveMessage(): MessageHistory | null {
  ensureDirectories();
  if (!existsSync(ACTIVE_MESSAGE_PATH)) {
    return null;
  }
  try {
    const content = readFileSync(ACTIVE_MESSAGE_PATH, "utf-8");
    return JSON.parse(content) as MessageHistory;
  } catch {
    return null;
  }
}

function saveActiveMessage(history: MessageHistory) {
  ensureDirectories();
  history.updated = new Date().toISOString();
  writeFileSync(ACTIVE_MESSAGE_PATH, JSON.stringify(history, null, 2));
}

function createNewHistory(): MessageHistory {
  return {
    id: randomUUID(),
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
    messages: [],
  };
}

function archiveToHistory(history: MessageHistory) {
  ensureDirectories();
  const historyPath = join(HISTORY_DIR, `${history.id}.json`);
  writeFileSync(historyPath, JSON.stringify(history, null, 2));
}

function clearActiveMessage(): boolean {
  const current = loadActiveMessage();
  if (current && current.messages.length > 0) {
    // Archive before clearing
    archiveToHistory(current);
  }
  if (existsSync(ACTIVE_MESSAGE_PATH)) {
    unlinkSync(ACTIVE_MESSAGE_PATH);
    return true;
  }
  return false;
}

function listHistory(): HistoryRecord[] {
  ensureDirectories();
  if (!existsSync(HISTORY_DIR)) {
    return [];
  }

  const files = readdirSync(HISTORY_DIR).filter((f) => f.endsWith(".json"));
  const records: HistoryRecord[] = [];

  for (const file of files) {
    try {
      const content = readFileSync(join(HISTORY_DIR, file), "utf-8");
      const history = JSON.parse(content) as MessageHistory;

      // Get first human message as preview
      const firstHuman = history.messages.find((m) => m.role === "human");
      const preview = firstHuman
        ? firstHuman.content.slice(0, 60) + (firstHuman.content.length > 60 ? "..." : "")
        : "(empty conversation)";

      records.push({
        id: history.id,
        created: history.created,
        updated: history.updated,
        preview,
        messageCount: history.messages.length,
      });
    } catch {
      // Skip invalid files
    }
  }

  // Sort by updated date descending
  return records.sort(
    (a, b) => new Date(b.updated).getTime() - new Date(a.updated).getTime()
  );
}

type RestoreResult =
  | { status: "success" }
  | { status: "not_found" }
  | { status: "ambiguous"; matches: string[] };

function restoreHistory(guid: string): RestoreResult {
  ensureDirectories();

  // Find all matching files by prefix
  const files = readdirSync(HISTORY_DIR).filter(
    (f) => f.endsWith(".json") && f.startsWith(guid)
  );

  if (files.length === 0) {
    return { status: "not_found" };
  }

  if (files.length > 1) {
    // Ambiguous - return the matching GUIDs
    const matches = files.map((f) => f.replace(".json", ""));
    return { status: "ambiguous", matches };
  }

  // Exactly one match
  const matchedPath = join(HISTORY_DIR, files[0]);
  const content = readFileSync(matchedPath, "utf-8");
  const history = JSON.parse(content) as MessageHistory;

  // Archive current if exists
  const current = loadActiveMessage();
  if (current && current.messages.length > 0) {
    archiveToHistory(current);
  }

  saveActiveMessage(history);
  return { status: "success" };
}

function storedToLangchain(stored: StoredMessage[]): BaseMessage[] {
  return stored.map((m) => {
    switch (m.role) {
      case "system":
        return new SystemMessage(m.content);
      case "human":
        return new HumanMessage(m.content);
      case "assistant":
        return new AIMessage(m.content);
    }
  });
}

async function chat(query: string, config: Config): Promise<void> {
  const model = createModel(config);

  if (!model.bindTools) {
    throw new Error("Model does not support tool calling");
  }

  const modelWithTools = model.bindTools([bashTool]);

  // Load or create message history
  let history = loadActiveMessage() || createNewHistory();

  // Add system message if this is a fresh conversation
  if (history.messages.length === 0) {
    history.messages.push({
      role: "system",
      content: getSystemPrompt(),
      timestamp: new Date().toISOString(),
    });
  }

  // Add user message
  history.messages.push({
    role: "human",
    content: query,
    timestamp: new Date().toISOString(),
  });

  // Convert to langchain messages
  const messages = storedToLangchain(history.messages);

  let iterations = 0;
  const maxIterations = 10;

  while (iterations < maxIterations) {
    iterations++;

    const response = await modelWithTools.invoke(messages);
    messages.push(response);

    // Check if there are tool calls
    if (response.tool_calls && response.tool_calls.length > 0) {
      for (const toolCall of response.tool_calls) {
        if (toolCall.name === "bash") {
          const result = await bashTool.invoke(
            toolCall.args as { command: string }
          );
          messages.push({
            role: "tool",
            content: result,
            tool_call_id: toolCall.id,
          } as never);
        }
      }
    } else {
      // No tool calls - this is the final response
      const content =
        typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

      // Store assistant response
      history.messages.push({
        role: "assistant",
        content,
        timestamp: new Date().toISOString(),
      });

      // Save history
      saveActiveMessage(history);

      // Display response
      console.log(`\n\x1b[36m${content}\x1b[0m\n`);
      return;
    }
  }

  console.log(`\n\x1b[33mMax iterations reached.\x1b[0m`);
}

function showHelp(config: Config) {
  console.log(`
\x1b[36m┌─────────────────────────────────────────┐
│  \x1b[1mqx\x1b[0m\x1b[36m - Context-Aware Query Mode          │
└─────────────────────────────────────────┘\x1b[0m

\x1b[33mUsage:\x1b[0m
  qx <question or query>
  qx --show               Show current conversation
  qx --clear              Clear conversation and start fresh
  qx --list               List conversation history
  qx --restore <guid>     Restore a previous conversation

\x1b[33mExamples:\x1b[0m
  qx what is the capital of china
  qx what files are in the current directory
  qx explain the previous result
  qx --show
  qx --clear
  qx --list
  qx --restore abc123

\x1b[33mConfig:\x1b[0m
  ${CONFIG_PATH}
  Current provider: \x1b[1m${config.provider}\x1b[0m

\x1b[33mStorage:\x1b[0m
  Active conversation: ${ACTIVE_MESSAGE_PATH}
  History: ${HISTORY_DIR}/

\x1b[33mFeatures:\x1b[0m
  • Maintains conversation context across queries
  • Can investigate the system using bash commands
  • Archives conversations automatically on clear
`);
}

function formatDate(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleString();
}

async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp(config);
    process.exit(0);
  }

  // Handle --clear
  if (args[0] === "--clear") {
    const cleared = clearActiveMessage();
    if (cleared) {
      console.log(`\x1b[32m✓ Conversation cleared and archived.\x1b[0m`);
    } else {
      console.log(`\x1b[33mNo active conversation to clear.\x1b[0m`);
    }
    process.exit(0);
  }

  // Handle --show
  if (args[0] === "--show") {
    const history = loadActiveMessage();
    if (!history || history.messages.length === 0) {
      console.log(`\x1b[33mNo active conversation.\x1b[0m`);
      process.exit(0);
    }

    console.log(`\n\x1b[36m┌─ Current Conversation ─────────────────────────────┐\x1b[0m`);
    console.log(`\x1b[90m  ID: ${history.id.slice(0, 8)}  Started: ${formatDate(history.created)}\x1b[0m\n`);

    for (const msg of history.messages) {
      if (msg.role === "system") continue; // Skip system message

      const roleColor = msg.role === "human" ? "\x1b[32m" : "\x1b[36m";
      const roleLabel = msg.role === "human" ? "You" : "Assistant";
      const timestamp = formatDate(msg.timestamp);

      console.log(`${roleColor}┌─ ${roleLabel} \x1b[90m${timestamp}\x1b[0m`);
      
      // Indent and display content
      const lines = msg.content.split("\n");
      for (const line of lines) {
        console.log(`${roleColor}│\x1b[0m ${line}`);
      }
      console.log(`${roleColor}└─\x1b[0m\n`);
    }

    console.log(`\x1b[36m└────────────────────────────────────────────────────┘\x1b[0m\n`);
    process.exit(0);
  }

  // Handle --list
  if (args[0] === "--list") {
    const records = listHistory();
    if (records.length === 0) {
      console.log(`\x1b[33mNo conversation history found.\x1b[0m`);
      process.exit(0);
    }

    console.log(`\n\x1b[36m┌─ Conversation History ─────────────────────────────┐\x1b[0m\n`);

    for (const record of records) {
      const shortId = record.id.slice(0, 8);
      console.log(`  \x1b[1m${shortId}\x1b[0m  ${formatDate(record.updated)}`);
      console.log(`  \x1b[90m${record.preview}\x1b[0m`);
      console.log(`  \x1b[90m${record.messageCount} messages\x1b[0m\n`);
    }

    console.log(`\x1b[36m└────────────────────────────────────────────────────┘\x1b[0m\n`);
    console.log(`\x1b[33mRestore with:\x1b[0m qx --restore <guid>`);
    process.exit(0);
  }

  // Handle --restore
  if (args[0] === "--restore") {
    if (args.length < 2) {
      console.error(`\x1b[31mUsage: qx --restore <guid>\x1b[0m`);
      process.exit(1);
    }

    const guid = args[1];
    const result = restoreHistory(guid);

    switch (result.status) {
      case "success": {
        console.log(`\x1b[32m✓ Conversation restored.\x1b[0m`);
        // Show the restored conversation summary
        const history = loadActiveMessage();
        if (history) {
          const humanMsgs = history.messages.filter((m) => m.role === "human");
          console.log(`\x1b[90m  ${humanMsgs.length} queries in this conversation\x1b[0m`);
        }
        break;
      }
      case "not_found":
        console.error(`\x1b[31mNo conversation found matching: ${guid}\x1b[0m`);
        console.log(`\x1b[33mRun 'qx --list' to see available conversations.\x1b[0m`);
        process.exit(1);
        break;
      case "ambiguous":
        console.error(`\x1b[31mPrefix '${guid}' is ambiguous. Matches:\x1b[0m`);
        for (const match of result.matches) {
          console.log(`  \x1b[90m${match.slice(0, 8)}\x1b[0m  ${match}`);
        }
        console.log(`\n\x1b[33mProvide more characters to uniquely identify the conversation.\x1b[0m`);
        process.exit(1);
        break;
    }
    process.exit(0);
  }

  // Regular query
  const query = args.join(" ");
  console.log(`\n\x1b[90m⏳ Thinking... (${config.provider})\x1b[0m`);

  try {
    await chat(query, config);
  } catch (error) {
    if (error instanceof Error) {
      console.error(`\n\x1b[31m✗ Error:\x1b[0m ${error.message}`);

      if (error.message.includes("Could not load credentials")) {
        console.error(
          `\n\x1b[33mTip:\x1b[0m Make sure your AWS credentials are configured.`
        );
        console.error(`     Run \x1b[36maws configure\x1b[0m or set AWS_PROFILE.`);
      } else if (error.message.includes("ECONNREFUSED")) {
        console.error(
          `\n\x1b[33mTip:\x1b[0m Make sure your local model server is running.`
        );
        console.error(`     For Ollama: \x1b[36mollama serve\x1b[0m`);
      }
    } else {
      console.error(`\n\x1b[31m✗ An unexpected error occurred\x1b[0m`);
    }
    process.exit(1);
  }
}

main();

