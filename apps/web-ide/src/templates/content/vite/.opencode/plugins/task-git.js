import { exec } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

function todoKey(todo) {
  if (typeof todo?.id === "string" && todo.id.length > 0) {
    return todo.id;
  }
  return typeof todo?.content === "string" ? todo.content : "";
}

function buildTodoStatusMap(todos) {
  const entries = [];
  for (const todo of Array.isArray(todos) ? todos : []) {
    const key = todoKey(todo);
    if (!key) continue;
    entries.push([key, todo.status]);
  }
  return new Map(entries);
}

async function loadSessionTodoStatusMap(client, sessionID) {
  const response = await client.session.todo({
    path: { id: sessionID },
  });
  return buildTodoStatusMap(response.data ?? []);
}

function normalizeSubject(subject) {
  const normalized = typeof subject === "string" ? subject.replace(/\s+/g, " ").trim() : "";
  if (!normalized) return "completed task";
  return normalized.slice(0, 96);
}

function shellQuote(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

async function runCommand(command, cwd) {
  try {
    const result = await execAsync(command, {
      cwd,
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
    });
    return {
      code: 0,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
    };
  } catch (error) {
    return {
      code: typeof error?.code === "number" ? error.code : 1,
      stdout: typeof error?.stdout === "string" ? error.stdout : "",
      stderr:
        typeof error?.stderr === "string"
          ? error.stderr
          : error instanceof Error
            ? error.message
            : String(error),
    };
  }
}

function formatFailure(message, result) {
  const parts = [message];
  if (result.stdout?.trim()) parts.push(result.stdout.trim());
  if (result.stderr?.trim()) parts.push(result.stderr.trim());
  return parts.join("\n");
}

async function commitTodo(worktree, subject) {
  if (!fs.existsSync(path.join(worktree, ".git"))) {
    return;
  }

  const addResult = await runCommand("git add .", worktree);
  if (addResult.code !== 0) {
    throw new Error(formatFailure("Failed to stage todo changes.", addResult));
  }

  const statusResult = await runCommand("git status --short", worktree);
  if (statusResult.code !== 0) {
    throw new Error(formatFailure("Failed to inspect todo changes.", statusResult));
  }
  if (!statusResult.stdout.trim()) {
    return;
  }

  const commitMessage = shellQuote(`Complete task: ${normalizeSubject(subject)}`);
  const commitResult = await runCommand(`git commit -m ${commitMessage}`, worktree);
  if (commitResult.code !== 0) {
    throw new Error(formatFailure("Failed to create the todo completion commit.", commitResult));
  }

  const remoteResult = await runCommand("git remote get-url origin", worktree);
  if (remoteResult.code !== 0) {
    return;
  }

  const branchResult = await runCommand("git branch --show-current", worktree);
  if (branchResult.code !== 0) {
    throw new Error(formatFailure("Failed to determine the current branch before pushing.", branchResult));
  }

  const branch = branchResult.stdout.trim();
  if (!branch) {
    return;
  }

  const pushResult = await runCommand(`git push -u origin ${shellQuote(branch)}`, worktree);
  if (pushResult.code !== 0) {
    throw new Error(formatFailure("Failed to push the todo completion commit to origin.", pushResult));
  }
}

export const TaskGitPlugin = async ({ client, worktree }) => {
  const todoStatusBySession = new Map();

  return {
    event: async ({ event }) => {
      if (event.type !== "todo.updated") return;
      todoStatusBySession.set(
        event.properties.sessionID,
        buildTodoStatusMap(event.properties.todos),
      );
    },
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "todowrite") return;

      const nextTodos = Array.isArray(output.args?.todos) ? output.args.todos : [];
      let previous = todoStatusBySession.get(input.sessionID);
      if (!previous) {
        previous = await loadSessionTodoStatusMap(client, input.sessionID).catch(() => new Map());
        todoStatusBySession.set(input.sessionID, previous);
      }

      const newlyCompleted = nextTodos.filter((todo) => {
        const key = todoKey(todo);
        if (!key || todo.status !== "completed") return false;
        return previous.get(key) !== "completed";
      });

      for (const todo of newlyCompleted) {
        await commitTodo(worktree, todo.content);
      }
    },
  };
};
