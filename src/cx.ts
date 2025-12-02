#!/usr/bin/env node

import { ChatBedrockConverse } from "@langchain/aws";
import { ChatOpenAI } from "@langchain/openai";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { createInterface } from "readline";
import { spawn, execSync, spawnSync } from "child_process";
import { platform, homedir } from "os";
import { readFileSync, existsSync, mkdirSync, writeFileSync, unlinkSync, chmodSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Config types
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

const CONFIG_DIR = join(homedir(), ".cx");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");

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

function loadConfig(): Config {
  if (!existsSync(CONFIG_PATH)) {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true });
    }
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
        model: bedrockConfig.model || "anthropic.claude-3-5-sonnet-20241022-v2:0",
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

// Define the bash tool
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
      // Limit output to prevent token overflow
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
      "Execute a bash command to investigate the system. Use this to explore files, check system state, list directories, etc. Returns the command output.",
    schema: z.object({
      command: z
        .string()
        .describe("The bash command to execute for investigation"),
    }),
  }
);

// Scripts directory for persistent scripts
const SCRIPTS_DIR = join(CONFIG_DIR, "scripts");

function ensureScriptsDir() {
  if (!existsSync(SCRIPTS_DIR)) {
    mkdirSync(SCRIPTS_DIR, { recursive: true });
  }
}

// Helper for script confirmation prompt
function askScriptConfirmation(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

// Define the claude-code tool for creating and executing complex scripts
const claudeCodeTool = tool(
  async ({ script, language, args, name, save, execute }) => {
    ensureScriptsDir();

    // Determine file extension and interpreter based on language
    const langConfig: Record<string, { ext: string; interpreter: string[] }> = {
      bash: { ext: ".sh", interpreter: ["/bin/bash"] },
      sh: { ext: ".sh", interpreter: ["/bin/sh"] },
      zsh: { ext: ".zsh", interpreter: ["/bin/zsh"] },
      python: { ext: ".py", interpreter: ["python3"] },
      python3: { ext: ".py", interpreter: ["python3"] },
      node: { ext: ".js", interpreter: ["node"] },
      javascript: { ext: ".js", interpreter: ["node"] },
      typescript: { ext: ".ts", interpreter: ["npx", "tsx"] },
      ruby: { ext: ".rb", interpreter: ["ruby"] },
      perl: { ext: ".pl", interpreter: ["perl"] },
      php: { ext: ".php", interpreter: ["php"] },
      lua: { ext: ".lua", interpreter: ["lua"] },
      awk: { ext: ".awk", interpreter: ["awk", "-f"] },
    };

    const config = langConfig[language.toLowerCase()] || { ext: "", interpreter: [language] };
    
    // Generate script path - always save to scripts dir for review
    const scriptName = name || `script_${Date.now()}`;
    const scriptPath = join(SCRIPTS_DIR, `${scriptName}${config.ext}`);

    // Write the script
    writeFileSync(scriptPath, script, { encoding: "utf-8" });
    
    // Make executable if it's a shell script
    if (["bash", "sh", "zsh"].includes(language.toLowerCase())) {
      chmodSync(scriptPath, "755");
    }

    // Display script content for review
    console.log(`\n\x1b[36m  ┌─ 📝 Script: ${scriptName}${config.ext} (${language}) ─────────────────────\x1b[0m`);
    const lines = script.split("\n");
    const maxLines = 50; // Limit display for very long scripts
    const displayLines = lines.slice(0, maxLines);
    for (let i = 0; i < displayLines.length; i++) {
      const lineNum = String(i + 1).padStart(3, " ");
      console.log(`\x1b[90m  │ \x1b[33m${lineNum}\x1b[90m │\x1b[0m ${displayLines[i]}`);
    }
    if (lines.length > maxLines) {
      console.log(`\x1b[90m  │ ... (${lines.length - maxLines} more lines)\x1b[0m`);
    }
    console.log(`\x1b[36m  └──────────────────────────────────────────────────────────\x1b[0m`);
    console.log(`\x1b[90m  📁 Saved to: ${scriptPath}\x1b[0m\n`);

    // If execute is false or not specified, just save and return
    if (!execute) {
      const runCmd = `${config.interpreter.join(" ")} ${scriptPath}${args?.length ? " " + args.join(" ") : ""}`;
      return `Script saved to: ${scriptPath}\n\nTo run it:\n  ${runCmd}`;
    }

    // Ask for confirmation before executing
    const confirmed = await askScriptConfirmation(`\x1b[33m  Execute this script? [y/N]:\x1b[0m `);
    
    if (!confirmed) {
      const runCmd = `${config.interpreter.join(" ")} ${scriptPath}${args?.length ? " " + args.join(" ") : ""}`;
      return `Script saved but not executed (user declined).\n\nTo run it later:\n  ${runCmd}`;
    }

    console.log(`\x1b[90m  🚀 Executing: ${config.interpreter.join(" ")} ${scriptPath} ${args?.join(" ") || ""}\x1b[0m\n`);

    try {
      // Build command array
      const cmdArgs = [...config.interpreter.slice(1), scriptPath, ...(args || [])];
      
      const result = spawnSync(config.interpreter[0], cmdArgs, {
        encoding: "utf-8",
        timeout: 120000, // 2 minutes for complex scripts
        maxBuffer: 1024 * 1024 * 10, // 10MB buffer for larger outputs
        env: process.env,
        cwd: process.cwd(),
      });

      // Clean up temp script if not saving
      if (!save) {
        try {
          unlinkSync(scriptPath);
        } catch {
          // Ignore cleanup errors
        }
      }

      const output = (result.stdout || "") + (result.stderr ? `\nSTDERR:\n${result.stderr}` : "");
      const trimmed = output.trim();

      if (result.status !== 0) {
        return `Script exited with code ${result.status}:\n${trimmed}`;
      }

      // Limit output to prevent token overflow
      if (trimmed.length > 16000) {
        return trimmed.slice(0, 16000) + "\n... (output truncated)";
      }

      const savedInfo = save ? `\n\n[Script saved to: ${scriptPath}]` : "";
      return (trimmed || "(no output)") + savedInfo;
    } catch (error) {
      if (error instanceof Error) {
        return `Script execution error: ${error.message}`;
      }
      return "Unknown error during script execution";
    }
  },
  {
    name: "claude_code",
    description: `Create and execute complex multi-line scripts. Use this instead of bash when you need to:
- Write scripts with multiple commands, loops, conditionals, or functions
- Use languages other than bash (python, node, ruby, etc.)
- Pass arguments to the script
- Optionally save scripts for later reuse

The script will be written to a file and executed with the appropriate interpreter.`,
    schema: z.object({
      script: z
        .string()
        .describe("The complete script content to execute. Can be multi-line with any complexity."),
      language: z
        .string()
        .describe("The scripting language: bash, sh, zsh, python, python3, node, javascript, typescript, ruby, perl, php, lua, awk"),
      args: z
        .array(z.string())
        .optional()
        .describe("Optional array of arguments to pass to the script"),
      name: z
        .string()
        .optional()
        .describe("Optional name for the script. Defaults to a timestamp-based name."),
      save: z
        .boolean()
        .optional()
        .describe("If true, keep the script in ~/.cx/scripts/ after execution. Defaults to true."),
      execute: z
        .boolean()
        .optional()
        .describe("If true, execute the script immediately (with user confirmation). If false, just save it. Defaults to false - script is saved and user can run it via the final COMMAND."),
    }),
  }
);

function getSystemPrompt(): string {
  const osType = platform();
  const shell = process.env.SHELL || "/bin/bash";
  const cwd = process.cwd();

  return `You are a command-line expert assistant. Your job is to help users construct and execute shell commands.

ENVIRONMENT:
- OS: ${osType}
- Shell: ${shell}
- Current directory: ${cwd}

AVAILABLE TOOLS:
1. **bash** - Execute simple commands for investigation (ls, cat, grep, etc.)
2. **claude_code** - Create complex scripts. Use this when you need:
   - Multi-line scripts with loops, conditionals, or functions
   - Scripts in languages other than bash (python, node, ruby, etc.)
   - Scripts that need arguments passed to them
   
   IMPORTANT: By default, claude_code SAVES the script but does NOT execute it.
   The script content is displayed for user review. Set execute:true only if you
   need the output for further investigation (user will be prompted to confirm).

WORKFLOW:
1. When the user describes what they want to do, you may need to investigate the system first
2. Use the bash tool for quick exploration: list files, check paths, examine file contents
3. Use claude_code to CREATE scripts - they will be saved to ~/.cx/scripts/
4. The user can review the script content before it's run
5. Provide the FINAL command to run the script for the user to confirm

RESPONSE FORMAT:
After any investigation, your final response MUST end with the command in this exact format:

COMMAND: <the complete command to run>

For complex operations, create a script with claude_code and then return the run command:
COMMAND: ~/.cx/scripts/<script_name>.sh [args]
or
COMMAND: python3 ~/.cx/scripts/<script_name>.py [args]

RULES:
- Always investigate when the request involves specific files, paths, or system state
- Use bash tool calls for simple exploration, claude_code for complex scripting
- The COMMAND line should contain a single, complete, ready-to-execute command
- If you cannot determine a valid command, explain why instead of providing COMMAND
- For dangerous operations (rm -rf, etc), still provide the command - the user will confirm`;
}

async function getCommandFromLLM(
  naturalLanguage: string,
  config: Config
): Promise<string | null> {
  const model = createModel(config);
  
  if (!model.bindTools) {
    throw new Error("Model does not support tool calling");
  }
  
  const modelWithTools = model.bindTools([bashTool, claudeCodeTool]);

  const messages = [
    new SystemMessage(getSystemPrompt()),
    new HumanMessage(naturalLanguage),
  ];

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
          const result = await bashTool.invoke(toolCall.args as { command: string });
          messages.push({
            role: "tool",
            content: result,
            tool_call_id: toolCall.id,
          } as never);
        } else if (toolCall.name === "claude_code") {
          const result = await claudeCodeTool.invoke(toolCall.args as {
            script: string;
            language: string;
            args?: string[];
            name?: string;
            save?: boolean;
            execute?: boolean;
          });
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

      // Extract command from response
      const commandMatch = content.match(/COMMAND:\s*(.+?)(?:\n|$)/s);
      if (commandMatch) {
        return commandMatch[1].trim();
      }

      // If no COMMAND format, check if the whole response looks like a command
      const lines = content.trim().split("\n");
      const lastLine = lines[lines.length - 1].trim();
      if (
        lastLine &&
        !lastLine.includes(" ") === false &&
        !lastLine.startsWith("I ") &&
        !lastLine.startsWith("The ") &&
        !lastLine.startsWith("You ")
      ) {
        // Might be a command, but let's be conservative
        console.log(`\n\x1b[36m${content}\x1b[0m\n`);
        return null;
      }

      // Show the response if no command was extracted
      console.log(`\n\x1b[36m${content}\x1b[0m\n`);
      return null;
    }
  }

  console.log(`\n\x1b[33mMax iterations reached without a final command.\x1b[0m`);
  return null;
}

function askConfirmation(question: string): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === "y" || normalized === "yes");
    });
  });
}

function executeCommand(command: string): Promise<number> {
  return new Promise((resolve) => {
    const shell = process.env.SHELL || "/bin/bash";

    const child = spawn(shell, ["-c", command], {
      stdio: "inherit",
      env: process.env,
    });

    child.on("close", (code) => {
      resolve(code ?? 0);
    });

    child.on("error", (err) => {
      console.error(`\n\x1b[31mError executing command:\x1b[0m ${err.message}`);
      resolve(1);
    });
  });
}

function showHelp(config: Config) {
  console.log(`
\x1b[36m┌─────────────────────────────────────────┐
│  \x1b[1mcx\x1b[0m\x1b[36m - Natural Language Shell Commands   │
└─────────────────────────────────────────┘\x1b[0m

\x1b[33mUsage:\x1b[0m
  cx <natural language description>

\x1b[33mExamples:\x1b[0m
  cx find all files in this directory that match prefix test
  cx show disk usage sorted by size
  cx what processes are using the most memory
  cx find large files in my home directory
  cx write a python script to parse json files and extract emails
  cx create a bash script that backs up my documents folder

\x1b[33mConfig:\x1b[0m
  ${CONFIG_PATH}
  Current provider: \x1b[1m${config.provider}\x1b[0m

\x1b[33mProviders:\x1b[0m
  • \x1b[36mbedrock\x1b[0m  - AWS Bedrock (Claude, etc.)
  • \x1b[36mopenai\x1b[0m   - OpenAI-compatible APIs (OpenRouter, etc.)
  • \x1b[36mlocal\x1b[0m    - Local models (Ollama, LM Studio, etc.)

\x1b[33mTools:\x1b[0m
  • \x1b[36mbash\x1b[0m        - Execute simple commands for investigation
  • \x1b[36mclaude_code\x1b[0m - Create & execute complex scripts (python, node, bash, etc.)

\x1b[33mScripts:\x1b[0m
  Saved scripts: ${SCRIPTS_DIR}/
  Scripts can be saved for reuse with complex operations

\x1b[33mFeatures:\x1b[0m
  • Tool calling for system investigation
  • Automatic context gathering before suggesting commands
  • Multi-language script generation (bash, python, node, ruby, etc.)
  • Script saving for frequently used operations
`);
}

async function main() {
  const config = loadConfig();
  const args = process.argv.slice(2);

  if (args.length === 0) {
    showHelp(config);
    process.exit(0);
  }

  const naturalLanguage = args.join(" ");

  console.log(`\n\x1b[90m⏳ Thinking... (${config.provider})\x1b[0m\n`);

  try {
    const command = await getCommandFromLLM(naturalLanguage, config);

    if (!command) {
      process.exit(0);
    }

    console.log(`\x1b[32m▶ Suggested command:\x1b[0m`);
    console.log(`\x1b[1m\x1b[37m  ${command}\x1b[0m\n`);

    const confirmed = await askConfirmation(
      `\x1b[33mRun this command? [y/N]:\x1b[0m `
    );

    if (confirmed) {
      console.log(
        `\n\x1b[90m─────────────────────────────────────────\x1b[0m\n`
      );
      const exitCode = await executeCommand(command);
      console.log(`\n\x1b[90m─────────────────────────────────────────\x1b[0m`);

      if (exitCode !== 0) {
        console.log(`\x1b[31m✗ Command exited with code ${exitCode}\x1b[0m`);
      } else {
        console.log(`\x1b[32m✓ Command completed successfully\x1b[0m`);
      }
      process.exit(exitCode);
    } else {
      console.log(`\n\x1b[90mAborted.\x1b[0m`);
      process.exit(0);
    }
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
